// 창 안 shortcut. main이 창의 모든 webContents에서 키를 보고 이 이름 하나만 shell
// renderer로 보낸다. renderer는 같은 표로 팔레트 행의 키 이름을 그린다.
// 이 파일은 main·preload·renderer가 함께 부르므로 import가 없다.

/** main이 shell renderer로 보내는 channel. payload는 WindowShortcut 하나다. */
export const WINDOW_SHORTCUT_CHANNEL = "shell:shortcut";

/**
 * 창 안에서만 듣는 키(shell/desktop#R18). 전역 팔레트 CommandOrControl+Shift+K는
 * 전역 등록이 맡고(shell#T56) 이 표에 넣지 않는다. 전역 Ctrl+K는 어디서도 등록하지 않는다.
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
