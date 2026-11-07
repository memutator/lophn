// tray popup의 자리. 가로만 항목에 맞춰 재고(항목의 오른쪽 끝에 맞추되 창 밖으로 나가지 않게 당긴다), 세로는 CSS가 정한다:
// 항목이 작업 표시줄(맨 아래)이나 title bar(맨 위)에 있으므로 popup은 그 줄 바로 위·아래에 붙는다(tray.module.css의 .popup).
// 항목의 세로 자리를 재지 않는 까닭은 창 크기가 막 바뀌어 잰 값이 옛 것일 수 있어서다.
export const POPUP_WIDTH = 360;
export const POPUP_HEIGHT = 480;
const MARGIN = 8;

export interface PopupPlace {
  left: number;
  width: number;
  /** 높이의 상한. 창 높이에서 title bar, 작업 표시줄, 여백을 뺀 값을 넘지 않는다(CSS가 min으로 건다). */
  height: string;
}

export function placePopup(
  anchor: { right: number },
  viewport: { width: number },
): PopupPlace {
  const width = Math.min(POPUP_WIDTH, viewport.width - MARGIN * 2);
  const left = Math.max(
    MARGIN,
    Math.min(anchor.right - width, viewport.width - width - MARGIN),
  );
  return {
    left,
    width,
    height: `min(${POPUP_HEIGHT}px, calc(100vh - var(--space-10) * 2 - var(--space-4) * 2))`,
  };
}
