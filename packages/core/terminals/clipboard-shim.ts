// 화면 없는(DISPLAY·WAYLAND_DISPLAY가 모두 비어 있는) Linux 터미널의 PATH 앞에 두는 clipboard shim.
// pbcopy·xclip·xsel·wl-copy 쓰기 호출을 1 MiB 한도의 OSC 52 이스케이프 시퀀스로 변환해 /dev/tty(없으면 stdout)로 보낸다.
// 실행 시점에 DISPLAY·WAYLAND_DISPLAY가 채워져 있고 원래 바이너리가 PATH 뒤에 있으면 그 바이너리로 넘긴다.
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CLIPBOARD_SHIM_NAMES = [
  "pbcopy",
  "xclip",
  "xsel",
  "wl-copy",
] as const;

export const CLIPBOARD_SHIM_MAX_BYTES = 1024 * 1024;

/** Linux에서 X11·Wayland 표시 변수가 모두 비어 있으면 headless 세션이다. */
export function isHeadlessLinux(
  platform: NodeJS.Platform,
  env: Readonly<Record<string, string | undefined>>,
): boolean {
  if (platform !== "linux") return false;
  const display = (env.DISPLAY ?? "").trim();
  const wayland = (env.WAYLAND_DISPLAY ?? "").trim();
  return display === "" && wayland === "";
}

function shimScript(name: (typeof CLIPBOARD_SHIM_NAMES)[number]): string {
  // DISPLAY/WAYLAND_DISPLAY가 뒤늦게 생겼으면 자기 폴더를 뺀 PATH에서 실제 바이너리를 찾아 넘긴다.
  const fallback = `if [ -n "\${DISPLAY:-}" ] || [ -n "\${WAYLAND_DISPLAY:-}" ]; then
  __self_dir="$(dirname "$0")"
  __old_ifs="$IFS"
  IFS=:
  for __d in $PATH; do
    if [ "$__d" != "$__self_dir" ] && [ -x "$__d/${name}" ] && [ ! -d "$__d/${name}" ]; then
      IFS="$__old_ifs"
      exec "$__d/${name}" "$@"
    fi
  done
  IFS="$__old_ifs"
fi`;

  let modeCheck = "";
  let emitBody = `{
  printf '\\033]52;c;'
  head -c ${CLIPBOARD_SHIM_MAX_BYTES} | base64 | tr -d '\\r\\n'
  printf '\\007'
}`;

  if (name === "xclip") {
    modeCheck = `for __arg in "$@"; do
  case "$__arg" in
    -o|-out) exit 1 ;;
  esac
done`;
  } else if (name === "xsel") {
    modeCheck = `for __arg in "$@"; do
  case "$__arg" in
    -o|--output) exit 1 ;;
  esac
done`;
  } else if (name === "wl-copy") {
    modeCheck = `__text=""
__has_text=0
__skip_next=0
for __arg in "$@"; do
  if [ "$__skip_next" = 1 ]; then
    __skip_next=0
    continue
  fi
  case "$__arg" in
    -c|--clear)
      __emit_clear=1
      ;;
    -t|--type|-s|--seat)
      __skip_next=1
      ;;
    -*)
      ;;
    *)
      if [ "$__has_text" = 1 ]; then
        __text="$__text $__arg"
      else
        __text="$__arg"
        __has_text=1
      fi
      ;;
  esac
done`;
    emitBody = `if [ "\${__emit_clear:-0}" = 1 ]; then
  printf '\\033]52;c;\\007'
elif [ "$__has_text" = 1 ]; then
  {
    printf '\\033]52;c;'
    printf '%s' "$__text" | head -c ${CLIPBOARD_SHIM_MAX_BYTES} | base64 | tr -d '\\r\\n'
    printf '\\007'
  }
else
  {
    printf '\\033]52;c;'
    head -c ${CLIPBOARD_SHIM_MAX_BYTES} | base64 | tr -d '\\r\\n'
    printf '\\007'
  }
fi`;
  }

  return `#!/bin/sh
# lophn headless Linux clipboard shim (${name} -> OSC 52)
set -eu
${fallback}
${modeCheck}
if [ -w /dev/tty ] 2>/dev/null; then
  ${emitBody} > /dev/tty
else
  ${emitBody}
fi
`;
}

/** headless Linux용 clipboard shim 4종을 폴더에 쓰고 그 폴더 경로를 돌려준다. */
export function ensureClipboardShims(dir: string): string {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  for (const name of CLIPBOARD_SHIM_NAMES) {
    writeFileSync(join(dir, name), shimScript(name), { mode: 0o700 });
  }
  return dir;
}
