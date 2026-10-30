// 앱 공간 오른쪽 패널의 폭. 앱 place에는 project 창 같은 layout file이 없어, 창이 기억하는 값(localStorage)으로
// 둔다. 앱 화면 자리를 늘 이만큼 남기고, 창이 좁아 폭을 줄여야 하면 고른 값을 덮지 않고 보이는 폭만 줄인다.

/** 처음 폭. 예전 고정 폭과 같다. */
export const PANEL_WIDTH_DEFAULT = 640;
/** agent 대화가 읽히는 최소 폭. */
export const PANEL_WIDTH_MIN = 360;
/** 이보다 넓히면 표·대화가 한 줄에 너무 길어져 옆으로 흩어진다. */
const PANEL_WIDTH_MAX = 960;
/** 패널을 열고도 앱 화면이 이만큼은 남아야 옆 열이다. 아니면 덮는다. */
export const PANEL_BODY_MIN = 480;

const KEY = "lophn.app-panel.width";

/** 고른 폭을 창 폭 안으로 가둔다. 앱 화면 자리를 남길 수 없으면 최소 폭이다(그때는 패널이 덮는다). */
export function clampPanelWidth(width: number, contentWidth: number): number {
  const room = Math.min(PANEL_WIDTH_MAX, contentWidth - PANEL_BODY_MIN);
  const max = Math.max(PANEL_WIDTH_MIN, room);
  return Math.round(Math.min(max, Math.max(PANEL_WIDTH_MIN, width)));
}

/** 저장한 폭. 없거나 깨졌으면 처음 폭이다. */
export function readPanelWidth(): number {
  try {
    const saved = Number(globalThis.localStorage?.getItem(KEY));
    if (!Number.isFinite(saved) || saved <= 0) return PANEL_WIDTH_DEFAULT;
    return clampPanelWidth(saved, Number.POSITIVE_INFINITY);
  } catch {
    return PANEL_WIDTH_DEFAULT;
  }
}

/** drag가 끝난 폭. 저장을 못 해도 이 창에서는 그 폭으로 쓴다. */
export function savePanelWidth(width: number): void {
  try {
    globalThis.localStorage?.setItem(KEY, String(Math.round(width)));
  } catch {
    // 저장하지 못해도 화면은 그대로다.
  }
}
