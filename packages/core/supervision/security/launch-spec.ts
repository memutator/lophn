import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type KindLaunchSpec,
  kindLaunchSpecSchema,
} from "../../../protocol/supervision/mod.ts";

// spec은 각 팀의 모듈이 선언하고 supervisor가 여기서 거절한다.
// spec으로 뜨는 것은 lophn 자신의 process뿐이고(AI가 쓴 코드를 돌리는 process는 이 통로를 쓰지 않는다),
// 그 process를 좁혀도 막는 것이 없다: shell.run이 사용자 uid로 /bin/sh를 띄워 권한을 우회한다.
type LaunchSpecError = {
  code: "invalid_input";
  message: string;
};

function reject(message: string): Result<never, LaunchSpecError> {
  return err({ code: "invalid_input", message });
}

// deno-lint-ignore no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export function checkLaunchSpec(
  input: unknown,
): Result<KindLaunchSpec, LaunchSpecError> {
  const parsed = kindLaunchSpecSchema.safeParse(input);
  if (!parsed.success) return reject("launch spec is not valid");
  const spec = parsed.data;
  if (!spec.entry.startsWith("/")) {
    return reject("entry must be an absolute path");
  }
  if (CONTROL.test(spec.entry)) return reject("control character in entry");
  return ok(spec);
}

// credential·token은 이 argv에 절대 넣지 않는다. hello frame이 한 번 전달한다.
export function launchArgv(spec: KindLaunchSpec): string[] {
  return [
    "run",
    "--cached-only",
    "--frozen",
    "--no-prompt",
    "--allow-all",
    spec.entry,
  ];
}
