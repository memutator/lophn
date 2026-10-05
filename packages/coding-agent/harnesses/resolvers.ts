// effective root·version 판정이다(coding-agent/harnesses#R4, T30). resolver는
// catalog root_resolver의 참조 adapter다. env·cwd는 인자로 받는다(architecture).
// 사람의 실제 home은 읽지 않고 home 값도 인자로만 받는다.
import { err, ok, type Result } from "../../base/mod.ts";

export type RootInputs = {
  // 사람 home이다. fixture에서는 temp dir을 준다.
  home: string;
  // process env 값이다. 없는 이름은 undefined다.
  env: { get(name: string): string | undefined };
  // project resolver의 cwd다.
  cwd?: string;
};

// catalog root_resolver를 실제 root로 풀어 준다(R4). default는 조사 문서의
// documented 값이다(home → ~/.codex·~/.hermes, $XDG_CONFIG_HOME → ~/.config).
export function rootOf(
  resolver: string,
  inputs: RootInputs,
): Result<string> {
  const home = inputs.home.replace(/\/$/, "");
  switch (resolver) {
    case "home":
      return ok(home);
    case "codex_home":
      // CODEX_HOME이 있으면 그 아래다(guides#R18). 없으면 문서 default ~/.codex다.
      return ok(
        inputs.env.get("CODEX_HOME")?.replace(/\/$/, "") ??
          `${home}/.codex`,
      );
    case "xdg_config_opencode": {
      // $XDG_CONFIG_HOME 또는 ~/.config + /opencode다(조사 9.1).
      const xdg = inputs.env.get("XDG_CONFIG_HOME")?.replace(/\/$/, "");
      return ok(
        xdg !== undefined ? `${xdg}/opencode` : `${home}/.config/opencode`,
      );
    }
    case "hermes_home":
      // HERMES_HOME이 있으면 그것이고 없으면 ~/.hermes다(조사 9.1).
      return ok(
        inputs.env.get("HERMES_HOME")?.replace(/\/$/, "") ??
          `${home}/.hermes`,
      );
    case "project":
      if (inputs.cwd === undefined || inputs.cwd === "") {
        return err({
          code: "invalid_input",
          message: "project root에는 cwd가 필요하다",
        });
      }
      return ok(inputs.cwd.replace(/\/$/, ""));
    default:
      return err({
        code: "invalid_input",
        message: "알 수 없는 root resolver다",
        details: { resolver },
      });
  }
}

// version의 대소 판정이다(R11). 검증 version minimum만큼 있을 때만
// version-sensitive event를 설치한다. 숫자 조각별로 비교하고 빠진 조각은 0이다.
export function versionAtLeast(version: string, minimum: string): boolean {
  const parse = (value: string) =>
    value.split(".").map((segment) => Number(segment) || 0);
  const left = parse(version.trim());
  const right = parse(minimum.trim());
  const size = Math.max(left.length, right.length);
  for (let index = 0; index < size; index++) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a > b;
  }
  return true;
}
