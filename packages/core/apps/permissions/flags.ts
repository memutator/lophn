import { err, ok, type Result } from "../../../base/mod.ts";
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

// 두 socket은 supervisor가 시작마다 새로 정한다. 정해진 값이 있으면 결과에 넣고, 없으면
// supervisor가 `socketFlags`로 띄울 때 더한다.
export type AppPaths = {
  bundle: string;
  data: string;
  brokerSocket?: string;
  directSocket?: string;
};

export type PlatformPorts = {
  // 앱이 닿는 loopback 표기마다 deny할 플랫폼의 실제 port와 설정 port.
  ports: readonly number[];
};

const LOOPBACK = ["localhost", "127.0.0.1", "::1"] as const;

// Unix socket HTTP의 가상 host다. Deno는 socket 위 HTTP 요청에도 이 host의 net 허락을 요구하고
// socket 듣기·연결에도 `unix:<경로>` net 허락을 요구한다(Deno 2.9.7 실측: 읽기·쓰기 허락만으로는
// Deno.serve의 unix listen이 NotCapable이다). 일반 외부 host로 넓어지지 않는다.
const SOCKET_HOST = "lophn.invalid";

// 앱 DB 파일 이름이다. 앱 process가 쓸 수 있는 곳은 이 파일과 SQLite가 곁에 만드는 파일뿐이다.
const DATABASE_FILE = "app.sqlite";
const DATABASE_SUFFIXES = ["", "-wal", "-shm", "-journal"] as const;

export function databaseFiles(data: string): string[] {
  return DATABASE_SUFFIXES.map((suffix) => `${data}/${DATABASE_FILE}${suffix}`);
}

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

// 운영 앱 flag. net.fetch·secret.use는 Deno flag가 아니다. 쓰기는 앱 DB 파일과 granted 경로뿐이다.
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
  const sockets = [app.brokerSocket, app.directSocket].filter((path) =>
    path !== undefined
  );
  const allowRead = [app.bundle, app.data, ...sockets, ...read.allow];
  const allowWrite = [
    ...databaseFiles(app.data),
    ...sockets,
    ...write.allow,
  ];
  const denyRead = [...protectedDenies, ...read.deny, ...write.deny];
  const denyWrite = [...protectedDenies, ...write.deny];
  // IPv6 host는 대괄호로 쓴다. `::1:4517`은 Deno가 빈 host로 읽어 프로세스가 시작하지 않는다
  // (Deno 2.9.7 실측).
  const denyNet = LOOPBACK.flatMap((host) =>
    platform.ports.map((port) =>
      host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`
    )
  );

  const parts = [
    flag("allow-read", allowRead),
    flag("allow-write", allowWrite),
    flag("deny-read", denyRead),
    flag("deny-write", denyWrite),
    // 앱 두 socket과 가상 host만 연다. net.fetch grant는 Deno flag가 아니라 broker가 강제하므로
    // 외부 host는 이 flag에 없다. --deny-net은 플랫폼 port를 한 번 더 막는 방어선이다.
    sockets.length === 2
      ? flag("allow-net", [
        SOCKET_HOST,
        ...sockets.map((path) => `unix:${path}`),
      ])
      : ok(undefined),
    flag("deny-net", denyNet),
  ];
  const args: string[] = [...FIXED];
  for (const part of parts) {
    if (!part.ok) return part;
    if (part.value !== undefined) args.push(part.value);
  }
  args.sort();
  return ok({ args, limits: LIMIT_KEYS });
}

// 시작마다 새로 정한 두 socket의 Deno flag. 읽기·쓰기에 더해 socket 듣기·연결과 가상 host의 net
// 허락이다. 외부 host는 넣지 않는다. 같은 flag 이름을 여러 번 주면 Deno가 합친다(Deno 2.9.7 실측).
export function socketFlags(
  sockets: { brokerSocket: string; directSocket: string },
): Result<string[]> {
  const paths = [sockets.brokerSocket, sockets.directSocket];
  const read = flag("allow-read", paths);
  if (!read.ok) return read;
  const write = flag("allow-write", paths);
  if (!write.ok) return write;
  const net = flag("allow-net", [
    SOCKET_HOST,
    ...paths.map((path) => `unix:${path}`),
  ]);
  if (!net.ok) return net;
  return ok([read.value!, write.value!, net.value!]);
}

// 이 앱이 부를 수 있는 다른 앱의 direct socket에 닿는 Deno flag다. source 앱 자식은
// 자기 두 socket만 열려 있어 target의 direct socket에 연결하면 NotCapable이다. 허락은 그 target의
// 고정 자리 socket의 읽기·쓰기·연결이고 외부 host나 broker socket은 넣지 않는다.
export function pairSocketFlags(
  directSockets: readonly string[],
): Result<string[]> {
  if (directSockets.length === 0) return ok([]);
  const read = flag("allow-read", directSockets);
  if (!read.ok) return read;
  const write = flag("allow-write", directSockets);
  if (!write.ok) return write;
  const net = flag("allow-net", directSockets.map((path) => `unix:${path}`));
  if (!net.ok) return net;
  return ok([read.value!, write.value!, net.value!]);
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
    `--allow-write=${databaseFiles(app.data).sort().join(",")}`,
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
