import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type KindLaunchSpec,
  kindLaunchSpecSchema,
} from "../../../protocol/supervision/mod.ts";

// spec은 각 팀의 모듈이 선언하고 supervisor가 여기서 거절한다.
// schema가 통과시킨 뒤에도 권한 범위를 넓히는 모양은 실행 전에 막는다.
const FORBIDDEN_FLAGS = ["--allow-all", "--allow-ffi", "-A"];

type LaunchSpecError = {
  code: "invalid_input";
  message: string;
};

function reject(message: string): Result<never, LaunchSpecError> {
  return err({ code: "invalid_input", message });
}

function absolutePaths(name: string, values: readonly string[]) {
  for (const value of values) {
    if (!value.startsWith("/") || value.includes("*")) {
      return `${name} must be an absolute path without a wildcard`;
    }
  }
  return undefined;
}

// grant는 CLI에서 `--allow-x=a,b`의 쉼표 목록으로 합쳐진다. 한 항목 안의 쉼표는 등록하지 않은
// 항목(예: `/opt/lophn,/`의 `/`)을 끼워 넣는다. NUL·줄바꿈 같은 제어 문자도 받지 않는다.
// deno-lint-ignore no-control-regex
const UNSAFE_GRANT = /[,\u0000-\u001f\u007f]/;
// deno-lint-ignore no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

// host 없는 --allow-net은 apps supervisor(broker net/fetch)만 받는다.
// 목적지 판정은 supervisor가 요청마다 한다. supervisor는 lophn의 코드이고 앱 process가 아니다.
// 그 판정이 틀리면 supervisor가 아무 곳이나 간다. kind 문자열은 apps 모듈을 import하지 않으려고 적는다.
const NET_ANY_KINDS: readonly string[] = [
  "apps/supervisor",
];

// --allow-all은 agent runtime만 받는다. 그 process의 sandbox는 Deno 권한이 아니라 file tool 코드가 지킨다.
// 나머지 kind는 AI가 쓴 코드를 돌리므로(sandbox 경계) 여기서 막는다.
const ALLOW_ALL_KINDS: readonly string[] = [
  "lophn-agent/runtime",
];

function forbiddenFlag(value: string): boolean {
  return FORBIDDEN_FLAGS.some((flag) => value.includes(flag));
}

export function checkLaunchSpec(
  input: unknown,
): Result<KindLaunchSpec, LaunchSpecError> {
  const parsed = kindLaunchSpecSchema.safeParse(input);
  if (!parsed.success) return reject("launch spec is not valid");
  const spec = parsed.data;
  if (!spec.entry.startsWith("/")) {
    return reject("entry must be an absolute path");
  }
  if (forbiddenFlag(spec.entry)) return reject("forbidden flag in entry");
  if (CONTROL.test(spec.entry)) return reject("control character in entry");
  const bad = absolutePaths("allow_read", spec.allow_read) ??
    absolutePaths("allow_write", spec.allow_write) ??
    absolutePaths("allow_run", spec.allow_run);
  if (bad) return reject(bad);
  const grants = [
    ...spec.allow_read,
    ...spec.allow_write,
    ...spec.allow_net,
    ...spec.allow_run,
    ...spec.allow_sys,
    ...spec.allow_env,
  ];
  if (grants.some(forbiddenFlag)) return reject("forbidden flag in permission");
  if (grants.some((grant) => UNSAFE_GRANT.test(grant))) {
    return reject("permission entry must be a single item");
  }
  if (spec.net_any && !NET_ANY_KINDS.includes(spec.kind)) {
    return reject("net_any is only for the apps supervisor");
  }
  if (spec.allow_all && !ALLOW_ALL_KINDS.includes(spec.kind)) {
    return reject("allow_all is only for the agent runtime");
  }
  for (const host of spec.allow_net) {
    if (host.includes("*") || host.includes(" ")) {
      return reject("allow_net must name a host without a wildcard");
    }
  }
  return ok(spec);
}

function flag(name: string, values: readonly string[]): string[] {
  return values.length === 0 ? [] : [`--${name}=${values.join(",")}`];
}

// credential·token은 이 argv에 절대 넣지 않는다. hello frame이 한 번 전달한다.
export function launchArgv(spec: KindLaunchSpec): string[] {
  return [
    "run",
    "--cached-only",
    "--frozen",
    "--no-prompt",
    ...(spec.allow_all ? ["--allow-all"] : [
      ...flag("allow-read", spec.allow_read),
      ...flag("allow-write", spec.allow_write),
      // net_any는 host 없는 --allow-net이다. apps supervisor만 켠다.
      ...(spec.net_any ? ["--allow-net"] : flag("allow-net", spec.allow_net)),
      ...flag("allow-run", spec.allow_run),
      ...flag("allow-sys", spec.allow_sys),
      ...flag("allow-env", spec.allow_env),
    ]),
    spec.entry,
  ];
}
