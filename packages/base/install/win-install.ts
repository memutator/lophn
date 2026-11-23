// Windows 설치 root(`lophn-desktop.exe`가 있는 폴더)의 배치. platform/, desktop/, extensions/, skills/는 root 바로 아래에,
// launcher는 `bin\`에 `lophn.cmd`(PowerShell·cmd용)와 `lophn`(Git Bash용 sh script)을 같이 둔다.
import { cliScript, type HookStdoutRow, headOf } from "./linux-install.ts";

// 설치 root 기준 launcher 위치.
export const WIN_CLI_LAUNCHER = "bin/lophn.cmd";
export const WIN_CLI_SH_LAUNCHER = "bin/lophn";
export const WIN_DESKTOP_BINARY = "lophn-desktop.exe";

// cmd.exe의 `echo`가 해석하는 메타문자를 `^`로 escape한다.
function cmdEchoText(text: string): string {
  return text.replace(/([&|<>^%()])/g, "^$1");
}

// env 없이 일찍 끝나는 hook도 `lophn hook`과 같은 stdout을 낸다. 정확한 event가 `*`보다 먼저다.
function cmdHookNoop(rows: readonly HookStdoutRow[]): string[] {
  const ordered = [...rows].sort(
    (a, b) => Number(a.event === "*") - Number(b.event === "*"),
  );
  const lines = [":hook_noop"];
  for (const row of ordered) {
    const cond =
      row.event === "*"
        ? `if "%~2"=="${row.harness}"`
        : `if "%~2:%~3"=="${row.harness}:${row.event}"`;
    lines.push(`${cond} (echo ${cmdEchoText(row.stdout)}& exit /b 0)`);
  }
  lines.push("exit /b 0");
  return lines;
}

export function winCliLauncher(
  hookStdout: readonly HookStdoutRow[] = [],
): string {
  return cmdLauncher(
    "lophn launcher",
    `%~dp0..\\${WIN_DESKTOP_BINARY}`,
    "%~dp0..\\platform\\packages\\cli\\main.ts",
    hookStdout,
  );
}

// Git Bash는 PATHEXT로 `.cmd`를 찾지 않아 같은 `bin\` 폴더에 확장자 없는 sh launcher를 둔다.
// `pwd -W`는 MSYS_NO_PATHCONV=1에서도 Electron이 읽는 Windows 경로를 돌려준다.
export function winCliShLauncher(
  hookStdout: readonly HookStdoutRow[] = [],
): string {
  return cliScript(
    headOf("lophn", [
      'ROOT="$(cd "$(dirname "$0")/.." && (pwd -W 2>/dev/null || pwd))"',
      `ELECTRON_BIN="$ROOT/${WIN_DESKTOP_BINARY}"`,
      'PLATFORM="$ROOT/platform"',
    ]),
    hookStdout,
  );
}

// 개발 실행(`npm run dev`)의 launcher. 저장소의 Electron binary로 저장소의 CLI를 돌린다. 경로는 cmd.exe가 읽으므로
// 저장소 경로에 ASCII 밖의 글자가 있으면 깨진다.
export function winDevCliLauncher(
  paths: {
    electron: string;
    platform: string;
  },
  hookStdout: readonly HookStdoutRow[] = [],
): string {
  return cmdLauncher(
    "lophn(dev) launcher",
    paths.electron,
    `${paths.platform}\\packages\\cli\\main.ts`,
    hookStdout,
  );
}

function cmdLauncher(
  name: string,
  electron: string,
  cli: string,
  hookStdout: readonly HookStdoutRow[],
): string {
  return [
    "@echo off",
    // cmd.exe는 OEM codepage로 읽으므로 본문은 ASCII만 쓴다.
    `rem ${name}: runs the CLI with the Node inside Electron`,
    "setlocal",
    'if "%~1"=="hook" if not defined LPN_TERMINAL_HOOK goto :hook_noop',
    'if not defined LOPHN_HOME set "LOPHN_HOME=%USERPROFILE%\\.lophn"',
    "set ELECTRON_RUN_AS_NODE=1",
    `"${electron}" "${cli}" %*`,
    "exit /b %ERRORLEVEL%",
    ...cmdHookNoop(hookStdout),
    "",
  ].join("\r\n");
}
