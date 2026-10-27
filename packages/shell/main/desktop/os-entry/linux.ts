// Linux 앱 바로가기. XDG applications 폴더의 `.desktop` 하나이고 Exec는 따옴표로 묶은 검증된
// lophn 실행 경로와 `--open-app <app ID>`뿐이다.
import { join } from "node:path";

import { OPEN_APP_FLAG } from "../open-intent.ts";
import type { OsEntryApp } from "./entry.ts";

export function linuxEntryPath(dataHome: string, app: string): string {
  return join(dataHome, "applications", `lophn-${app}.desktop`);
}

// Desktop Entry 값의 escape. 제어 문자는 공백으로 바꾼다.
function entryValue(text: string): string {
  return text.replaceAll("\\", "\\\\").replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: desktop entry 값에서 제어 문자를 공백으로 바꾼다.
    /[\u0000-\u001f\u007f]+/g,
    " ",
  );
}

export function linuxEntry(execPath: string, app: OsEntryApp): string {
  return [
    "[Desktop Entry]",
    "Type=Application",
    `Name=${entryValue(app.name)}`,
    `Exec="${execPath}" ${OPEN_APP_FLAG} ${app.id}`,
    "Terminal=false",
    "StartupNotify=true",
    "",
  ].join("\n");
}
