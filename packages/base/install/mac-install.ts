// macOS .app 안의 배치. 설치 묶음은 `Contents/Resources/`(process.resourcesPath) 안에 platform/, desktop/, extensions/,
// skills/, bin/을 둔다. Electron binary는 `Contents/MacOS/`에 있다.
import { cliScript, type HookStdoutRow, headOf } from "./linux-install.ts";

// `Contents/Resources/` 기준 launcher 위치.
export const MAC_CLI_LAUNCHER = "bin/lophn";
export const MAC_DESKTOP_BINARY = "lophn-desktop";

// launcher는 자기 위치에서 Resources를 찾는다(.app을 어디로 옮겨도 된다). Linux launcher와 같은 본문이다.
export function macCliLauncher(hookStdout: readonly HookStdoutRow[]): string {
  return cliScript(
    headOf("lophn", [
      'ROOT="$(cd "$(dirname "$0")/.." && pwd)"',
      `ELECTRON_BIN="$ROOT/../MacOS/${MAC_DESKTOP_BINARY}"`,
      'PLATFORM="$ROOT/platform"',
    ]),
    hookStdout,
  );
}
