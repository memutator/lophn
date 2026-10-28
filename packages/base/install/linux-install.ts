// Linux .deb 설치 묶음의 위치와 설치 때 쓰는 script 본문.
// 묶음의 위치는 /opt/lophn/ 하나다. 순수 값이라 build 도구(tools/package-linux.ts)와 설치 검사
// (tools/verify-linux-install.ts), core 조립이 같은 값을 쓴다.

const LINUX_INSTALL_ROOT = "/opt/lophn";

// 설치 묶음 안의 위치. 모두 root 소유 읽기 전용이고 사람 데이터 root(H)와 겹치지 않는다.
type LinuxInstallLayout = {
  root: string;
  // 플랫폼 source·의존. package.json, package-lock.json, node_modules/가 함께 있다.
  platform: string;
  // 빌드된 desktop 화면(renderer dist).
  desktop: string;
  // coding agent skill 배포 원본.
  skills: string;
  // SDK package source. platform/packages/sdk로 가는 링크다. core 기동의 sdk 설치는 platform/packages를 직접 읽는다.
  sdk: string;
  // Electron main binary와 Chromium sandbox 실행 파일.
  desktopBinary: string;
  chromeSandbox: string;
};

export function linuxInstallLayout(
  root: string = LINUX_INSTALL_ROOT,
): LinuxInstallLayout {
  const base = root.replace(/\/$/, "");
  return {
    root: base,
    platform: `${base}/platform`,
    desktop: `${base}/desktop`,
    skills: `${base}/skills`,
    sdk: `${base}/sdk`,
    desktopBinary: `${base}/lophn-desktop`,
    chromeSandbox: `${base}/chrome-sandbox`,
  };
}

// 설치 실행 이름. .deb에서는 둘 다 /usr/bin에서 찾는다.
export const LINUX_LAUNCHERS = {
  desktop: "/usr/bin/lophn-desktop",
  cli: "/usr/bin/lophn",
} as const;

// launcher가 쓰는 공통 앞부분이다. H 위치만 환경에서 풀고 나머지는 고정 값이다.
// CLI는 shell main과 같은 Electron binary를 Node로 띄우므로 PATH의 node가 필요 없다.
// `ROOT=` 줄은 설치 확인(tools/verify-linux-install.ts)이 확인 대상 root로 바꾸는 자리라 그대로 둔다.
function launcherHead(layout: LinuxInstallLayout, name: string): string {
  return headOf(name, [
    `ROOT=${layout.root}`,
    'ELECTRON_BIN="$ROOT/lophn-desktop"',
    'PLATFORM="$ROOT/platform"',
  ]);
}

// 개발 실행의 launcher가 가리키는 경로다. 설치 묶음이 없어 저장소의 source와 node_modules를 쓴다.
type DevCliPaths = {
  electron: string;
  platform: string;
};

function devLauncherHead(paths: DevCliPaths): string {
  return headOf("lophn(dev)", [
    `ELECTRON_BIN="${paths.electron}"`,
    `PLATFORM="${paths.platform}"`,
  ]);
}

function headOf(name: string, paths: string[]): string {
  return [
    "#!/bin/sh",
    `# ${name}: launcher다. Electron의 Node로 CLI를 실행한다.`,
    "set -e",
    ...paths,
    'H="${LOPHN_HOME:-$HOME/.lophn}"',
    // CLI가 같은 data root를 읽게 한다.
    'LOPHN_HOME="$H"',
    "export LOPHN_HOME",
  ].join("\n");
}

// `lophn` CLI. 같은 플랫폼 daemon에 loopback으로 연결하고 data root의 user token으로 인증한다.
// lophn 자신의 코드라 권한 flag가 없다. 설치 묶음의 Electron binary를 Node로 쓴다.
export function cliLauncher(
  layout: LinuxInstallLayout,
  hookStdout: readonly HookStdoutRow[],
): string {
  return cliScript(launcherHead(layout, "lophn"), hookStdout);
}

// 개발 실행(`npm run dev`)의 `lophn`. 설치된 launcher와 같은 본문에 경로만 저장소 source로 바꾼다.
// 전역 hook command가 이 파일의 경로라서 `hook`이 터미널 hook env 없이 부르면 CLI를 띄우지 않고 끝나는 것도 같다.
export function devCliLauncher(
  paths: DevCliPaths,
  hookStdout: readonly HookStdoutRow[],
): string {
  return cliScript(devLauncherHead(paths), hookStdout);
}

// hook이 stdout에 써야 하는 글이다(`harness-hooks.ts`의 `HOOK_STDOUT`). event `*`는 그 harness의 나머지 전부다.
type HookStdoutRow = { harness: string; event: string; stdout: string };

// env 없이 일찍 끝나는 hook도 `lophn hook`과 같은 stdout을 내도록 같은 표로 `case`를 만든다. 정확한 event가 `*`보다 먼저다.
function hookStdoutCase(rows: readonly HookStdoutRow[]): string[] {
  const quoted = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
  return [...rows]
    .sort((a, b) => Number(a.event === "*") - Number(b.event === "*"))
    .map(
      (row) =>
        `    ${row.harness}:${row.event}) printf '%s\\n' ${quoted(row.stdout)} ;;`,
    );
}

function cliScript(head: string, hookStdout: readonly HookStdoutRow[]): string {
  return [
    head,
    "# 전역 hook은 lophn과 상관없는 harness 실행마다 불린다. 터미널 hook env가 없으면 CLI를 띄우지 않고 끝낸다.",
    "# harness가 stdout을 요구하는 hook(`HOOK_STDOUT`)은 같은 글만 쓰고 끝낸다.",
    'if [ "${1:-}" = hook ] && [ -z "${LPN_TERMINAL_HOOK:-}" ]; then',
    '  case "${2:-}:${3:-}" in',
    ...hookStdoutCase(hookStdout),
    "  esac",
    "  exit 0",
    "fi",
    "# CLI는 lophn 자신의 코드라 권한을 좁히지 않는다. shell main과 같은 Node runtime으로 돈다.",
    'ELECTRON_RUN_AS_NODE=1 exec "$ELECTRON_BIN" \\',
    '  "$PLATFORM/packages/coding-agent/cli/main.ts" "$@"',
    "",
  ].join("\n");
}

// Electron의 launcher는 Chromium sandbox 파일 옆의 실행 파일 그대로를 쓴다. sandbox를 끄는 flag를
// 붙이는 launcher는 만들지 않는다.
export const DESKTOP_LAUNCHER_TARGET = "/opt/lophn/lophn-desktop";

// Electron이 다시 쓰는 실행 의존성. .deb는 이 목록을 그대로 Depends에 둔다.
const LINUX_DEPENDS: readonly string[] = [
  "libgtk-3-0t64 | libgtk-3-0",
  "libnotify4",
  "libnss3",
  "libxss1",
  "libxtst6",
  "xdg-utils",
  "libatspi2.0-0t64 | libatspi2.0-0",
  "libuuid1",
  "libsecret-1-0",
  "libgbm1",
  "libasound2t64 | libasound2",
];

export function debControl(input: {
  version: string;
  installedSizeKb: number;
}): string {
  return [
    "Package: lophn",
    `Version: ${input.version}`,
    "Section: devel",
    "Priority: optional",
    "Architecture: amd64",
    `Installed-Size: ${input.installedSizeKb}`,
    `Depends: ${LINUX_DEPENDS.join(", ")}`,
    "Maintainer: lophn developers <lophn@localhost>",
    "Description: Client workspace for projects and apps with lophn",
    " Electron desktop and the platform source in one install.",
    "",
  ].join("\n");
}

export const SANDBOX_MODE = 0o4755;

// 설치 뒤 script. Chromium sandbox 파일을 root 소유·4755로 두고 그렇지 않으면 설치를 실패시킨다.
// sandbox를 끄는 대안은 안내하지 않는다. 데이터 폴더는 건드리지 않는다.
export function postinstScript(layout: LinuxInstallLayout): string {
  const sandbox = layout.chromeSandbox;
  return [
    "#!/bin/sh",
    "set -e",
    `SANDBOX=${sandbox}`,
    'chown root:root "$SANDBOX"',
    'chmod 4755 "$SANDBOX"',
    'if [ "$(stat -c \'%u:%g %a\' "$SANDBOX")" != "0:0 4755" ]; then',
    '  echo "lophn: Chromium sandbox 실행 파일을 root 소유 4755로 둘 수 없어 설치를 멈춘다." >&2',
    "  exit 1",
    "fi",
    "if command -v update-desktop-database >/dev/null 2>&1; then",
    "  update-desktop-database /usr/share/applications || true",
    "fi",
    "exit 0",
    "",
  ].join("\n");
}

// URL scheme(`lophn://`)은 등록하지 않는다. 실행 인자는 `--open-app`뿐이라 `%U`도 없다.
export function desktopEntry(): string {
  return [
    "[Desktop Entry]",
    "Name=lophn",
    "Comment=Client workspace for projects and apps with lophn",
    `Exec=${LINUX_LAUNCHERS.desktop}`,
    "Icon=lophn",
    "Type=Application",
    "Categories=Development;",
    // Electron은 X11 WM_CLASS를 앱 이름(shell main package.json의 name)으로 둔다. 이름을 바꾸면 userData 폴더가 옮겨져 이쪽을 맞춘다.
    "StartupWMClass=lophn-shell-main",
    "Terminal=false",
    "",
  ].join("\n");
}
