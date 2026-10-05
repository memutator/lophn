// 창 안 shortcut. main이 창의 모든 webContents에서 키를 보고 이 이름 하나만 shell
// renderer로 보낸다. renderer는 같은 표로 팔레트 행의 키 이름을 그린다.
// 이 파일은 main·preload·renderer가 함께 부르므로 import가 없다.

/** main이 shell renderer로 보내는 channel. payload는 WindowShortcut 하나다. */
export const WINDOW_SHORTCUT_CHANNEL = "shell:shortcut";

/**
 * 창 안에서만 듣는 키(shell/desktop#R18). 전역 팔레트 CommandOrControl+Shift+K는
 * 전역 등록이 맡고(main/desktop/global-shortcut.ts) 이 표에 넣지 않는다. 전역 Ctrl+K는
 * 어디서도 등록하지 않는다.
 */
export const WINDOW_SHORTCUTS = {
  palette: "CommandOrControl+K",
  launcher: "CommandOrControl+Shift+L",
} as const;

export type WindowShortcut = keyof typeof WINDOW_SHORTCUTS;

export function isWindowShortcut(value: unknown): value is WindowShortcut {
  return typeof value === "string" && Object.hasOwn(WINDOW_SHORTCUTS, value);
}

export interface ShortcutApi {
  subscribe(listener: (shortcut: WindowShortcut) => void): () => void;
}

/** OS 전역 단축키 하나(shell#T56). main만 등록하고 renderer는 키 이름을 그릴 때만 본다. */
export const GLOBAL_PALETTE_ACCELERATOR = "CommandOrControl+Shift+K";

/** main이 창 하나를 앞으로 가져온 뒤 그 shell renderer로 보내는 channel. */
export const DESKTOP_INTENT_CHANNEL = "shell:intent";

/**
 * main이 창 밖에서 일어난 일로 창에 시키는 것. `global-palette`는 전역 팔레트 키,
 * `things-to-confirm`은 OS notification 클릭이다. 클릭은 읽음·결정이 아니다.
 */
export const DESKTOP_INTENTS = ["global-palette", "things-to-confirm"] as const;

export type DesktopIntent = typeof DESKTOP_INTENTS[number];

export function isDesktopIntent(value: unknown): value is DesktopIntent {
  return typeof value === "string" &&
    (DESKTOP_INTENTS as readonly string[]).includes(value);
}

export interface IntentApi {
  subscribe(listener: (intent: DesktopIntent) => void): () => void;
}
