// Linux .deb 설치 묶음의 자리와 설치 때 쓰는 script 본문(platform/install-and-update#R2~R6, R8).
// 묶음의 위치는 /opt/lophn/ 하나다. 순수 값이라 build 도구(tools/package-linux.ts)와 설치 검사
// (tools/verify-linux-install.ts), core 조립이 같은 값을 쓴다.

import { INSTANCE_LOCK_NAME } from "./instance-lock.ts";

export const LINUX_INSTALL_ROOT = "/opt/lophn";

// 설치 묶음 안의 자리. 모두 root 소유 읽기 전용이고 사람 데이터 root(H)와 겹치지 않는다.
export type LinuxInstallLayout = {
  root: string;
  // 설치된 Deno binary. 플랫폼 process·migration·MCP·CLI가 모두 이 binary로 시작한다(R5).
  deno: string;
  // 플랫폼 source·lock·vendor. deno.json, deno.lock, vendor/, node_modules/가 함께 있다(R4).
  platform: string;
  // 빌드된 desktop 화면(renderer dist).
  desktop: string;
  // coding agent skill 배포 원본.
  skills: string;
  // SDK package source. platform/packages/sdk로 가는 링크다(설치 도구가 그 자리에서 읽는다).
  sdk: string;
  // 안내 원문. lophn-agent의 roles/lophn/guides/에서 복사한다.
  guides: string;
  // OS keychain 전달 helper(compile binary, 고정 절대 경로).
  credentialHelper: string;
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
    guides: `${base}/guides`,
    credentialHelper: `${base}/lophn-credential`,
    desktopBinary: `${base}/lophn-desktop`,
    chromeSandbox: `${base}/chrome-sandbox`,
  };
}

// 설치 실행 이름. .deb에서는 셋 모두 /usr/bin에서 찾는다(R6).
export const LINUX_LAUNCHERS = {
  desktop: "/usr/bin/lophn-desktop",
  cli: "/usr/bin/lophn",
  mcp: "/usr/bin/lophn-mcp",
} as const;

// 보호 loader의 identity는 설치된 helper의 고정 절대 경로다. core의 `codingLoaders`가 이 목록만
// child로 등록한다.
export function credentialLoaderIdentity(
  layout: LinuxInstallLayout = linuxInstallLayout(),
): string {
  return layout.credentialHelper;
}

// Deno transpile cache. 지워도 H는 그대로고 고정 의존성으로 다시 만든다(R8).
export function denoCacheDir(home: string): string {
  return `${home.replace(/\/$/, "")}/.cache/lophn/deno`;
}

const LOOPBACK = "127.0.0.1,[::1]";

// helper compile binary의 고정 권한이다. 하는 일은 소유자 전용 unix socket 하나에 연결하는 것뿐이다:
// Deno 2.9의 compile은 unix 연결에 net·read·write를 함께 요구하고(`--allow-net=unix:<경로>`는 compile
// 결과에서 맞지 않는다) 경로는 data root에 따라 달라 compile 때 하나로 정할 수 없다. 코드는 그
// socket 하나만 연다. run·ffi·sys는 없고 환경은 data root를 찾는 두 이름만 읽는다.
export const CREDENTIAL_HELPER_COMPILE_FLAGS: readonly string[] = [
  "--allow-net",
  "--allow-read",
  "--allow-write",
  "--allow-env=LOPHN_HOME,HOME",
];

// CLI·MCP launcher가 쓰는 공통 앞부분이다. H·cache 위치만 환경에서 풀고 나머지는 고정 값이다.
// 시작에 의존성 다운로드가 없도록 항상 `--cached-only --frozen`이고 system Deno는 쓰지 않는다.
function launcherHead(layout: LinuxInstallLayout, name: string): string {
  return [
    "#!/bin/sh",
    `# ${name}: 설치 묶음의 launcher다. 설치된 Deno로 cached-only 실행한다(platform#T48).`,
    "set -e",
    `ROOT=${layout.root}`,
    'H="${LOPHN_HOME:-$HOME/.lophn}"',
    // 데이터 root를 Deno process와 helper가 같은 값으로 알게 한다(coding connection loader).
    'LOPHN_HOME="$H"',
    "export LOPHN_HOME",
    'DENO_DIR="${HOME}/.cache/lophn/deno"',
    "export DENO_DIR",
    'mkdir -p "$DENO_DIR"',
  ].join("\n");
}

function denoRun(
  permissions: readonly string[],
  entry: string,
): string {
  return [
    `exec "$ROOT/deno" run --cached-only --frozen --no-prompt \\`,
    `  --config="$ROOT/platform/deno.json" \\`,
    ...permissions.map((flag) => `  ${flag} \\`),
    `  "$ROOT/platform/${entry}" "$@"`,
  ].join("\n");
}

// CLI의 환경 이름이다. token 이름은 없다(coding-agent/cli의 `CLI_ENV_NAMES`와 같은 목록).
// 제품 감지가 PATH 뒤에 읽는 home 기준 bin 폴더다(coding-agent/harnesses `DETECTION_FALLBACK_DIRS`와 같은 목록).
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

const CLI_ENV =
  "LOPHN_HOME,LOPHN_CONNECTION,LOPHN_DAEMON_URL,LOPHN_APP,LOPHN_TERMINAL_OBSERVE,HOME,DENO_DIR,PATH,XDG_RUNTIME_DIR,TMPDIR,CODEX_HOME,XDG_CONFIG_HOME,HERMES_HOME";

// `lophn` CLI. 같은 플랫폼 daemon에 loopback으로 연결하고 token은 helper로만 받는다(R6).
// 설치·감지·daemon·`sdk add --apply`가 요구하는 write·run은 정확한 경로와 파일로만 연다
// (open-issues coding-agent/mcp-server#Q9): 쓰기는 `<H>/integrations`와 instance lock 파일, 실행은 helper·
// 설치 Deno·`lophn-desktop`, 읽기는 PATH 폴더를 더한다. 선택한 제품 설정 파일·앱 source의 `deno.json`·
// `deno.lock`처럼 명령 시점에야 알 수 있는 경로는 같은 argv를 읽는 권한 계획 entry(`apps/cli/launch.ts`)가
// 사람이 고른 target·앱에서 정확한 경로로 계산해 이 실행에만 더한다. 일반 쓰기·일반 실행·폴더 단위 쓰기는 없다.
export function cliLauncher(layout: LinuxInstallLayout): string {
  return [
    launcherHead(layout, "lophn"),
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
    `READ="$ROOT/platform,$DENO_DIR,$H/run,$H/integrations,$PWD,/proc/self/stat,${CLI_FALLBACK_BINS}\${PATHDIRS:+,$PATHDIRS}"`,
    `WRITE="$H/integrations,$H/run/${INSTANCE_LOCK_NAME}"`,
    `ENVNAMES="${CLI_ENV}"`,
    "# 설치·sdk 명령만 권한 계획을 부른다. 계획은 읽기·loopback·helper 실행뿐이고 쓰기·run은 없다.",
    'EXTRA=""',
    'for arg in "$@"; do',
    '  case "$arg" in harness|connection|sdk|observe|skills) NEED=1 ;; esac',
    "done",
    'if [ -n "${NEED:-}" ]; then',
    '  EXTRA=$("$ROOT/deno" run --cached-only --frozen --no-prompt \\',
    '    --config="$ROOT/platform/deno.json" \\',
    '    --allow-read="$ROOT/platform,$DENO_DIR,$H/run,$PWD,/proc/self/stat" \\',
    '    --allow-env="$ENVNAMES" \\',
    `    --allow-net=${LOOPBACK} \\`,
    '    --allow-run="$ROOT/lophn-credential" \\',
    '    "$ROOT/platform/apps/cli/launch.ts" "$@" 2>/dev/null) || EXTRA=""',
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
    '  --allow-run="$ROOT/lophn-credential,$ROOT/deno,$ROOT/lophn-desktop" \\',
    "  $EXTRA \\",
    '  "$ROOT/platform/apps/cli/main.ts" "$@"',
    "",
  ].join("\n");
}

// `lophn-mcp` stdio 서버. 권한은 coding-agent/mcp-server의 실행 argv와 같다: write·ffi·일반 run 없음,
// helper 실행 하나만 있다.
export function mcpLauncher(layout: LinuxInstallLayout): string {
  return [
    launcherHead(layout, "lophn-mcp"),
    denoRun([
      '--allow-read="$ROOT/platform,$DENO_DIR,$H/run,/proc/self/stat"',
      "--allow-env=LOPHN_HOME,LOPHN_CONNECTION,LOPHN_DAEMON_URL,LOPHN_APP,LOPHN_MCP_TOOLSETS,LOPHN_AGENT_LABEL,DENO_DIR",
      `--allow-net=${LOOPBACK}`,
      '--allow-run="$ROOT/lophn-credential"',
    ], "apps/mcp/main.ts"),
    "",
  ].join("\n");
}

// Electron의 launcher는 Chromium sandbox 파일 옆의 실행 파일 그대로를 쓴다. sandbox를 끄는 flag를
// 붙이는 launcher는 만들지 않는다(R3).
export const DESKTOP_LAUNCHER_TARGET = "/opt/lophn/lophn-desktop";

// Electron이 다시 쓰는 실행 의존성. .deb는 이 목록을 그대로 Depends에 둔다.
export const LINUX_DEPENDS: readonly string[] = [
  "libgtk-3-0t64 | libgtk-3-0",
  "libnotify4",
  "libnss3",
  "libxss1",
  "libxtst6",
  "xdg-utils",
  "libatspi2.0-0t64 | libatspi2.0-0",
  "libuuid1",
  "libsecret-1-0",
  "libsecret-tools",
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
// sandbox를 끄는 대안은 안내하지 않는다(R3, security#R4). 데이터 폴더는 건드리지 않는다.
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
    "if command -v update-mime-database >/dev/null 2>&1; then",
    "  update-mime-database /usr/share/mime || true",
    "fi",
    "exit 0",
    "",
  ].join("\n");
}

export function desktopEntry(): string {
  return [
    "[Desktop Entry]",
    "Name=lophn",
    "Comment=Client workspace for projects and apps with lophn",
    `Exec=${LINUX_LAUNCHERS.desktop} %U`,
    "Icon=lophn",
    "Type=Application",
    "Categories=Development;",
    "MimeType=x-scheme-handler/lophn;",
    "StartupWMClass=lophn",
    "Terminal=false",
    "",
  ].join("\n");
}
