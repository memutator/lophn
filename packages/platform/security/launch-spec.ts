import { err, ok, type Result } from "../../base/mod.ts";
import {
  kindLaunchSpecSchema,
  type KindLaunchSpec,
} from "../../contracts/platform/mod.ts";

// spec은 각 팀의 모듈이 선언하고 supervisor가 여기서 거절한다.
// schema가 통과시킨 뒤에도 권한 범위를 넓히는 모양은 실행 전에 막는다.
const FORBIDDEN_FLAGS = ["--allow-all", "--allow-ffi", "-A"];

export type LaunchSpecError = {
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
  const bad = absolutePaths("allow_read", spec.allow_read) ??
    absolutePaths("allow_write", spec.allow_write) ??
    absolutePaths("allow_run", spec.allow_run);
  if (bad) return reject(bad);
  const grants = [
    ...spec.allow_read,
    ...spec.allow_write,
    ...spec.allow_net,
    ...spec.allow_run,
    ...spec.allow_env,
  ];
  if (grants.some(forbiddenFlag)) return reject("forbidden flag in permission");
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
    ...flag("allow-read", spec.allow_read),
    ...flag("allow-write", spec.allow_write),
    ...flag("allow-net", spec.allow_net),
    ...flag("allow-run", spec.allow_run),
    ...flag("allow-env", spec.allow_env),
    spec.entry,
  ];
}
