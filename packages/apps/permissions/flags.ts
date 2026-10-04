import { err, ok, type Result } from "../../base/mod.ts";
import {
  canonicalOrder,
  isSameOrInside,
  type ResolvedRequirement,
} from "./model.ts";

// Deno 2.9.7 probe:
// --allow-read 폴더 안의 symlink라도 --deny-read=<그 lexical 경로>가 폴더 밖 읽기를 막는다.
// --allow-read/--allow-write만으로는 Deno.symlink, Deno.link,
// node:fs의 symlink/link(동기·비동기)가 모두 NotCapable이다.
// 남는 구멍은 다른 프로세스가 grant 계산 뒤 lexical allow 경로에 link를 심는 경우다.
// 그 한계는 permissions.limit.symlink-changes로 공개한다.

export const LIMIT_KEYS = [
  "permissions.limit.not-isolated",
  "permissions.limit.granted-path-secrets",
  "permissions.limit.symlink-changes",
  "permissions.limit.cpu",
  "permissions.limit.rss",
  "permissions.limit.disk",
] as const;

export type LimitKey = (typeof LIMIT_KEYS)[number];

export type AppPaths = {
  bundle: string;
  data: string;
  brokerSocket: string;
  directSocket: string;
};

export type PlatformPorts = {
  // 앱이 닿는 loopback 표기마다 deny할 플랫폼의 실제 port와 설정 port.
  ports: readonly number[];
};

const LOOPBACK = ["localhost", "127.0.0.1", "::1"] as const;

const FIXED = [
  "--no-prompt",
  "--no-config",
  "--no-remote",
  "--no-npm",
  "--cached-only",
  "--no-lock",
  "--quiet",
] as const;

function fail(
  code: "invalid_input" | "forbidden",
  message: string,
): Result<never> {
  return err({ code, message });
}

// deno-lint-ignore no-control-regex
const ONE_ITEM = /[,\x00-\x1f\x7f]/;

function single(value: string): Result<string> {
  if (ONE_ITEM.test(value)) {
    return fail("invalid_input", "flag value cannot be one item");
  }
  return ok(value);
}

function flag(
  name: string,
  values: readonly string[],
): Result<string | undefined> {
  if (values.length === 0) return ok(undefined);
  for (const value of values) {
    const checked = single(value);
    if (!checked.ok) return checked;
  }
  return ok(`--${name}=${[...values].sort().join(",")}`);
}

function fsOf(
  requirements: readonly ResolvedRequirement[],
  kind: "fs.read" | "fs.write",
): { allow: string[]; deny: string[] } {
  const allow: string[] = [];
  const deny: string[] = [];
  for (const requirement of requirements) {
    if (requirement.kind !== kind) continue;
    allow.push(requirement.scope.path);
    deny.push(...requirement.scope.outsideLinks);
  }
  return { allow, deny };
}

export type FlagSet = {
  args: string[];
  limits: readonly LimitKey[];
};

// 운영 앱 flag. net.fetch·secret.use·document.save는 Deno flag가 아니다.
export function appFlags(
  requirements: readonly ResolvedRequirement[],
  app: AppPaths,
  platform: PlatformPorts,
  protectedDenies: readonly string[],
): Result<FlagSet> {
  const ordered = canonicalOrder(requirements);
  if (!ordered.ok) return ordered;
  for (const requirement of ordered.value) {
    if (requirement.kind !== "net.listen") continue;
    return fail("forbidden", "listen direction cannot be enforced");
  }

  const read = fsOf(ordered.value, "fs.read");
  const write = fsOf(ordered.value, "fs.write");
  const allowRead = [
    app.bundle,
    app.data,
    app.brokerSocket,
    app.directSocket,
    ...read.allow,
  ];
  const allowWrite = [
    app.data,
    app.brokerSocket,
    app.directSocket,
    ...write.allow,
  ];
  const denyRead = [...protectedDenies, ...read.deny, ...write.deny];
  const denyWrite = [...protectedDenies, ...write.deny];
  const denyNet = LOOPBACK.flatMap((host) =>
    platform.ports.map((port) => `${host}:${port}`)
  );

  const parts = [
    flag("allow-read", allowRead),
    flag("allow-write", allowWrite),
    flag("deny-read", denyRead),
    flag("deny-write", denyWrite),
    flag("deny-net", denyNet),
  ];
  const args: string[] = [...FIXED, "--allow-net=lophn.invalid"];
  for (const part of parts) {
    if (!part.ok) return part;
    if (part.value !== undefined) args.push(part.value);
  }
  args.sort();
  return ok({ args, limits: LIMIT_KEYS });
}

// migration은 외부 grant를 물려받지 않는다. bundle 읽기와 자기 DB 작업 영역만.
export function migrationFlags(
  app: Pick<AppPaths, "bundle" | "data">,
  protectedDenies: readonly string[],
): Result<FlagSet> {
  if (
    isSameOrInside(app.data, app.bundle) || isSameOrInside(app.bundle, app.data)
  ) {
    return fail("invalid_input", "bundle and data must be separate");
  }
  const args = [
    ...FIXED,
    `--allow-read=${[app.bundle, app.data].sort().join(",")}`,
    `--allow-write=${app.data}`,
  ];
  if (protectedDenies.length > 0) {
    const sorted = [...protectedDenies].sort();
    args.push(
      `--deny-read=${sorted.join(",")}`,
      `--deny-write=${sorted.join(",")}`,
    );
  }
  return ok({ args, limits: LIMIT_KEYS });
}
