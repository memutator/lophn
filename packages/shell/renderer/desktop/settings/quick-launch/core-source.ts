// QuickPrefsSource를 선언 설정 셋의 읽기·쓰기로 만든다.
import type { CoreSource } from "../../connection/connection.ts";
import { chooseSetting, readEffective } from "../declared.ts";
import {
  launchFromValue,
  type QuickPrefs,
  type QuickPrefsSource,
  quickFromValue,
  picksFromValue,
} from "./source.ts";

// packages/core/config/shell-settings.ts의 key와 같은 글자다(shell은 core를 import하지 못한다).
const KEYS = {
  quick: "shell.quick_launch",
  launch: "shell.app_launch",
  taskbar: "shell.taskbar",
  sidebarPanelsOff: "shell.sidebar_panels_off",
  trayOff: "shell.tray_off",
  trayOrder: "shell.tray_order",
} as const satisfies Record<keyof QuickPrefs, string>;

export function coreQuickPrefsSource(core: CoreSource): QuickPrefsSource {
  return {
    async read() {
      const read = await readEffective(core, Object.values(KEYS));
      if (!read.ok) return read;
      return {
        ok: true,
        value: {
          quick: quickFromValue(read.value.get(KEYS.quick)),
          launch: launchFromValue(read.value.get(KEYS.launch)),
          taskbar: read.value.get(KEYS.taskbar) !== false,
          sidebarPanelsOff: picksFromValue(
            read.value.get(KEYS.sidebarPanelsOff),
          ),
          trayOff: picksFromValue(read.value.get(KEYS.trayOff)),
          trayOrder: picksFromValue(read.value.get(KEYS.trayOrder)),
        },
      };
    },
    write: (key, value) => chooseSetting(core, KEYS[key], value),
  };
}
