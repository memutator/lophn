// tray popup의 자리. 가로만 항목에 맞춰 재고(항목의 오른쪽 끝에 맞추되 창 밖으로 나가지 않게 당긴다), 세로는 CSS가 정한다:
// 항목이 작업 표시줄(맨 아래)이나 title bar(맨 위)에 있으므로 popup은 그 줄 바로 위·아래에 붙는다(tray.module.css의 .popup).
// 항목의 세로 자리를 재지 않는 까닭은 창 크기가 막 바뀌어 잰 값이 옛 것일 수 있어서다.
// 크기는 앱이 tray 화면 선언에 적은 값이다(범위는 선언 검사가 본다). 숫자면 고정, 범위면 앱 page가 알린 내용 크기를
// 그 범위 안으로 맞춘다(내용 크기가 오기 전에는 기본값을 범위 안으로 맞춘 값). 없는 쪽은 기본값이다. 창이 더 작으면
// 창 안으로 줄인다.
import type { TraySide } from "../../../../protocol/apps/declaration/mod.ts";

export const POPUP_WIDTH = 360;
export const POPUP_HEIGHT = 480;
const MARGIN = 8;
// 범위의 빈 끝. 선언 검사의 범위(protocol/apps/declaration/tools.ts의 TRAY_SIZE)와 같다.
const BOUNDS = {
  width: { min: 240, max: 720 },
  height: { min: 160, max: 720 },
} as const;

export interface PopupPlace {
  left: number;
  width: number;
  /** 높이. 창 높이에서 title bar, 작업 표시줄, 여백을 뺀 값을 넘지 않는다(CSS가 min으로 건다). */
  height: string;
}

export interface PopupSize {
  readonly width?: TraySide;
  readonly height?: TraySide;
}

/** popup 전체로 본 내용 크기(앱 page의 크기에 popup 머리 줄을 더한 것). */
export interface PopupContent {
  readonly width: number;
  readonly height: number;
}

function sideOf(
  side: TraySide | undefined,
  fallback: number,
  bounds: { min: number; max: number },
  content: number | undefined,
): number {
  if (side === undefined) return fallback;
  if (typeof side === "number") return side;
  const low = side.min ?? bounds.min;
  const high = side.max ?? bounds.max;
  return Math.min(high, Math.max(low, content ?? fallback));
}

export function placePopup(
  anchor: { right: number },
  viewport: { width: number },
  size: PopupSize = {},
  content?: PopupContent,
): PopupPlace {
  const width = Math.min(
    sideOf(size.width, POPUP_WIDTH, BOUNDS.width, content?.width),
    viewport.width - MARGIN * 2,
  );
  const height = sideOf(
    size.height,
    POPUP_HEIGHT,
    BOUNDS.height,
    content?.height,
  );
  const left = Math.max(
    MARGIN,
    Math.min(anchor.right - width, viewport.width - width - MARGIN),
  );
  return {
    left,
    width,
    height: `min(${height}px, calc(100vh - var(--space-10) * 2 - var(--space-4) * 2))`,
  };
}
