// Windows 앱 바로가기. 시작 메뉴 lophn 폴더의 shortcut 하나이고 target은 검증된 lophn 실행
// 경로, 인자는 `--open-app <app ID>`뿐이다. 쓰기는 Electron
// `shell.writeShortcutLink`가 한다.
import { win32 } from "node:path";

import { OPEN_APP_FLAG } from "../open-intent.ts";
import type { OsEntryApp } from "./entry.ts";

export interface ShortcutOptions {
  target: string;
  args: string;
  description: string;
  icon: string;
  iconIndex: 0;
}

export function windowsShortcutPath(appData: string, app: string): string {
  return win32.join(
    appData,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "lophn",
    `lophn-${app}.lnk`,
  );
}

export function windowsShortcut(
  execPath: string,
  app: OsEntryApp,
): ShortcutOptions {
  return {
    target: execPath,
    args: `${OPEN_APP_FLAG} ${app.id}`,
    // deno-lint-ignore no-control-regex
    description: app.name.replace(/[\u0000-\u001f\u007f]+/g, " "),
    icon: execPath,
    iconIndex: 0,
  };
}
