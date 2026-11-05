// Windows 설치 root(`lophn-desktop.exe`가 있는 폴더)의 배치. platform/, desktop/, extensions/, skills/는 root 바로 아래에,
// launcher는 `bin\`에 둔다. hook은 Windows에서 꺼져 있어 launcher에 hook 분기가 없다.

// 설치 root 기준 launcher 위치.
export const WIN_CLI_LAUNCHER = "bin/lophn.cmd";
export const WIN_DESKTOP_BINARY = "lophn-desktop.exe";

export function winCliLauncher(): string {
  return [
    "@echo off",
    // cmd.exe는 OEM codepage로 읽으므로 본문은 ASCII만 쓴다.
    "rem lophn launcher: runs the CLI with the Node inside Electron",
    "setlocal",
    'if not defined LOPHN_HOME set "LOPHN_HOME=%USERPROFILE%\\.lophn"',
    "set ELECTRON_RUN_AS_NODE=1",
    `"%~dp0..\\${WIN_DESKTOP_BINARY}" "%~dp0..\\platform\\packages\\cli\\main.ts" %*`,
    "",
  ].join("\r\n");
}
