// tray popup의 자리. 항목 위(작업 표시줄) 또는 아래(title bar)에 붙이고 창 밖으로 나가지 않게 당긴다.
export const POPUP_WIDTH = 360;
export const POPUP_HEIGHT = 480;
const MARGIN = 8;

export interface PopupPlace {
  left: number;
  top: number;
  width: number;
  height: number;
}

export function placePopup(
  anchor: { left: number; right: number; top: number; bottom: number },
  viewport: { width: number; height: number },
  side: "above" | "below",
): PopupPlace {
  const width = Math.min(POPUP_WIDTH, viewport.width - MARGIN * 2);
  const height = Math.min(POPUP_HEIGHT, viewport.height - MARGIN * 2);
  // 항목의 오른쪽 끝에 맞춘다(tray는 창 오른쪽에 있다).
  const left = Math.max(
    MARGIN,
    Math.min(anchor.right - width, viewport.width - width - MARGIN),
  );
  const wanted =
    side === "above" ? anchor.top - MARGIN - height : anchor.bottom + MARGIN;
  const top = Math.max(
    MARGIN,
    Math.min(wanted, viewport.height - height - MARGIN),
  );
  return { left, top, width, height };
}
