// 창 안 shortcut. main이 창의 모든 webContents에서 키를 보고 이 이름 하나만 shell
// renderer로 보낸다. renderer는 같은 표로 팔레트 행의 키 이름을 그린다.
// 작업대 단축키(탭·칸·sidebar·팔레트·Home)는 keybindings.ts의 표가 정하고, 그중 main이 먼저 받아야
// 하는 것(menu와 겹치는 Cmd+W, page가 삼키는 키)만 이 channel로 온다. 그 payload는 binding id 글자다.
import { parseBindingId } from "../../protocol/shell/keybindings.ts";

/** main이 shell renderer로 보내는 channel. payload는 WindowShortcut(binding id) 하나다. */
export const WINDOW_SHORTCUT_CHANNEL = "shell:shortcut";

/**
 * channel로 오는 binding id(`tab.close`, `desk.nth:3`, `palette.open`, `app.panel:<app>:<surface>`).
 * 표가 아는 모양만 받는다.
 */
export type WindowShortcut = string;

export function isWindowShortcut(value: unknown): value is WindowShortcut {
  return typeof value === "string" && parseBindingId(value) !== null;
}

export interface ShortcutApi {
  subscribe(listener: (shortcut: WindowShortcut) => void): () => void;
}

/** OS 전역 단축키 하나. main만 등록하고 renderer는 키 이름을 그릴 때만 본다. */
export const GLOBAL_PALETTE_ACCELERATOR = "CommandOrControl+Shift+K";

/** main이 창 하나를 앞으로 가져온 뒤 그 shell renderer로 보내는 channel. */
export const DESKTOP_INTENT_CHANNEL = "shell:intent";

/**
 * main이 창 밖에서 일어난 일로 창에 시키는 것. `global-palette`는 전역 팔레트 키이고, `extension-settings`는
 * 꺼진 extension의 open intent가 Settings › System › Extensions를 열라는 것이다.
 * `remote-settings`는 옮겨진 로그인 시작 알림의 [Open settings]가 Settings › Remote를 열라는 것이다.
 */
const DESKTOP_INTENTS = [
  "global-palette",
  "extension-settings",
  "remote-settings",
] as const;

export type DesktopIntent = (typeof DESKTOP_INTENTS)[number];

export function isDesktopIntent(value: unknown): value is DesktopIntent {
  return (
    typeof value === "string" &&
    (DESKTOP_INTENTS as readonly string[]).includes(value)
  );
}

export interface IntentApi {
  subscribe(listener: (intent: DesktopIntent) => void): () => void;
}
