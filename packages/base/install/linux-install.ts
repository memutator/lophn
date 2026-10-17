// Linux .deb 설치 묶음의 위치와 설치 때 쓰는 script 본문.
// 묶음의 위치는 /opt/lophn/ 하나다. 순수 값이라 build 도구(tools/package-linux.ts)와 설치 검사
// (tools/verify-linux-install.ts), core 조립이 같은 값을 쓴다.

import { INSTANCE_LOCK_NAME } from "./instance-lock.ts";

const LINUX_INSTALL_ROOT = "/opt/lophn";

// 설치 묶음 안의 위치. 모두 root 소유 읽기 전용이고 사람 데이터 root(H)와 겹치지 않는다.
type LinuxInstallLayout = {
  root: string;
  // 설치된 Deno binary. 플랫폼 process·migration·CLI가 모두 이 binary로 시작한다.
  deno: string;
  // 플랫폼 source·lock·vendor. deno.json, deno.lock, vendor/, node_modules/가 함께 있다.
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
    deno: `${base}/deno`,
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

// Deno transpile cache. 지워도 H는 그대로고 고정 의존성으로 다시 만든다.

const LOOPBACK = "127.0.0.1,[::1]";

// launcher가 쓰는 공통 앞부분이다. H·cache 위치만 환경에서 풀고 나머지는 고정 값이다.
// 시작에 의존성 다운로드가 없도록 항상 `--cached-only --frozen`이고 system Deno는 쓰지 않는다.
function launcherHead(layout: LinuxInstallLayout, name: string): string {
  return [
    "#!/bin/sh",
    `# ${name}: 설치 묶음의 launcher다. 설치된 Deno로 cached-only 실행한다.`,
    "set -e",
    `ROOT=${layout.root}`,
    'H="${LOPHN_HOME:-$HOME/.lophn}"',
    // CLI가 같은 data root를 읽게 한다.
    'LOPHN_HOME="$H"',
    "export LOPHN_HOME",
    'DENO_DIR="${HOME}/.cache/lophn/deno"',
    "export DENO_DIR",
    'mkdir -p "$DENO_DIR"',
  ].join("\n");
}

// 제품 감지가 PATH 뒤에 읽는 home 기준 bin 폴더다(coding-agent/harnesses `FALLBACK_DIRS`와 같은 목록).
const CLI_FALLBACK_BINS = [
  ".local/bin",
  ".bun/bin",
  ".npm-global/bin",
  ".pnpm-global/bin",
  ".yarn/bin",
  ".volta/bin",
  ".asdf/shims",
  ".fnm/aliases/default/bin",
  ".local/share/mise/shims",
].map((dir) => `$HOME/${dir}`).join(",");

// CLI의 환경 이름이다.
const CLI_ENV =
  "LOPHN_HOME,LOPHN_CODING_TOKEN,LOPHN_DAEMON_URL,HOME,DENO_DIR,PATH";

// `lophn` CLI. 같은 플랫폼 daemon에 loopback으로 연결하고 token은 환경 변수 `LOPHN_CODING_TOKEN`으로 받는다.
// 고정 권한은 읽기(플랫폼·cache·H/run·PATH와 감지 폴더), 환경 이름, loopback이고 쓰기는 instance lock 파일 하나다.
// 명령 시점에야 알 수 있는 권한(harness install의 전역 설정 위치, harness refresh의 제품 실행 파일)은 같은 argv를 읽는
// 권한 계획 entry(`packages/coding-agent/cli/launch-entry.ts`)가 계산해 이 실행에만 더한다. 실행은 고정으로 없다.
export function cliLauncher(layout: LinuxInstallLayout): string {
  return [
    launcherHead(layout, "lophn"),
    "# 전역 hook은 lophn과 상관없는 harness 실행마다 불린다. token이 없으면 deno를 띄우지 않고 끝낸다.",
    'if [ "${1:-}" = hook ] && [ -z "${LOPHN_CODING_TOKEN:-}" ]; then exit 0; fi',
    "# PATH의 절대 폴더만 읽기로 연다(제품 감지).",
    'PATHDIRS=""',
    "OLDIFS=$IFS",
    "IFS=:",
    "set -f",
    "for dir in $PATH; do",
    '  case "$dir" in',
    '    /*) case "$dir" in *,*) ;; *) PATHDIRS="${PATHDIRS:+$PATHDIRS,}$dir" ;; esac ;;',
    "  esac",
    "done",
    "IFS=$OLDIFS",
    `READ="$ROOT/platform,$DENO_DIR,$H/run,$PWD,/proc/self/stat,${CLI_FALLBACK_BINS}\${PATHDIRS:+,$PATHDIRS}"`,
    `WRITE="$H/run/${INSTANCE_LOCK_NAME}"`,
    `ENVNAMES="${CLI_ENV}"`,
    "# harness 명령만 권한 계획을 부른다. 계획은 harness install의 전역 설정 위치와 harness refresh의 제품 실행 파일만 준다.",
    'EXTRA=""',
    'for arg in "$@"; do',
    '  case "$arg" in harness) NEED=1 ;; esac',
    "done",
    'if [ -n "${NEED:-}" ]; then',
    '  EXTRA=$("$ROOT/deno" run --cached-only --frozen --no-prompt \\',
    '    --config="$ROOT/platform/deno.json" \\',
    // 계획도 감지가 보는 PATH 폴더와 home 기준 bin 폴더를 읽어야 refresh의 실행 파일을 찾는다(읽기만).
    '    --allow-read="$ROOT/platform,$DENO_DIR,$H/run,$PWD,/proc/self/stat,' +
    CLI_FALLBACK_BINS + '${PATHDIRS:+,$PATHDIRS}" \\',
    '    --allow-env="$ENVNAMES" \\',
    `    --allow-net=${LOOPBACK} \\`,
    '    "$ROOT/platform/packages/coding-agent/cli/launch-entry.ts" "$@" 2>/dev/null) || EXTRA=""',
    "fi",
    "# 계획의 flag는 한 줄에 하나다. 줄 단위로만 나눈다.",
    "IFS='",
    "'",
    "set -f",
    'exec "$ROOT/deno" run --cached-only --frozen --no-prompt \\',
    '  --config="$ROOT/platform/deno.json" \\',
    '  --allow-read="$READ" \\',
    '  --allow-write="$WRITE" \\',
    '  --allow-env="$ENVNAMES" \\',
    `  --allow-net=${LOOPBACK} \\`,
    "  $EXTRA \\",
    '  "$ROOT/platform/packages/coding-agent/cli/main.ts" "$@"',
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
    " Electron desktop, Deno runtime, and the platform source in one install.",
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
    "StartupWMClass=lophn",
    "Terminal=false",
    "",
  ].join("\n");
}
