// tab·float 값의 모양. desk 규칙은 shell/desk-model.ts에 있다.

/** 탭 종류의 이름. 등록된 kind는 kinds/registry.ts가 정한다. */
type TabKind = string;

export interface TabItem {
  readonly key: string;
  readonly kind: TabKind;
  readonly title: string;
  /** terminal 탭의 시작 폴더 참조. 사람이 다시 시작할 때 쓴다. */
  readonly folder?: string;
  /** 앱 패널 탭의 앱과 panel 크기를 선언한 화면. 고르기 전에는 없다. */
  readonly app?: string;
  readonly screen?: string;
  /** 위 필드에 없는 kind의 layout 값. 이 값이 무엇인지는 그 kind의 선언이 안다. */
  readonly fields?: Readonly<Record<string, unknown>>;
  /** 문서 탭의 읽던 위치. 저장할 때 section key와 scroll offset만 남긴다. */
  readonly readPosition?: {
    readonly section: string;
    readonly scroll_offset: number;
  };
  /**
   * preview 탭. desk마다 하나이고 다음 preview가 이 자리를 바꿔 쓴다. layout 파일에 남기지 않아서
   * 다시 열면 모두 고정 탭이다.
   */
  readonly preview?: boolean;
  /** popup 같은 잠깐 떴다 사라지는 탭. 저장하지 않는다. dockFloat·reattachTab이 지운다. */
  readonly transient?: boolean;
}

/** stage(card가 서는 칸) 왼쪽 위를 (0,0)으로 한 CSS px 정수 사각형. */
export interface FloatRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** 창 bounds. OS 화면 좌표 정수 사각형이다. FloatRect와 모양은 같지만 기준이 `.content`가 아니라 화면이다. */
export interface DetachedBounds {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** detached 창 하나가 가진 탭. 배열 순서는 뗀 순서다. */
export interface DetachedItem {
  readonly tab: TabItem;
  readonly bounds: DetachedBounds;
}

/** float 층이 차지하는 칸. stage의 크기다. */
export interface FloatArea {
  readonly width: number;
  readonly height: number;
}

export const FLOAT_MIN: FloatArea = { width: 320, height: 200 };
export type FloatEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** area 안으로 당긴다. 크기는 FLOAT_MIN 이상(area가 더 작으면 area), 위치는 area 안. */
export function clampFloatRect(rect: FloatRect, area: FloatArea): FloatRect {
  const width = Math.min(
    area.width,
    Math.max(FLOAT_MIN.width, Math.round(rect.width)),
  );
  const height = Math.min(
    area.height,
    Math.max(FLOAT_MIN.height, Math.round(rect.height)),
  );
  return {
    x: Math.min(area.width - width, Math.max(0, Math.round(rect.x))),
    y: Math.min(area.height - height, Math.max(0, Math.round(rect.y))),
    width,
    height,
  };
}

/** 패널 이동. start에서 (dx,dy)만큼 옮긴 사각형을 area 안으로 가둔다. */
export function movedRect(
  start: FloatRect,
  dx: number,
  dy: number,
  area: FloatArea,
): FloatRect {
  return clampFloatRect({ ...start, x: start.x + dx, y: start.y + dy }, area);
}

/** 가장자리·모서리 resize. 반대쪽 가장자리를 고정하고 FLOAT_MIN과 area 안으로 가둔다. */
export function resizedRect(
  start: FloatRect,
  edge: FloatEdge,
  dx: number,
  dy: number,
  area: FloatArea,
): FloatRect {
  const minW = Math.min(FLOAT_MIN.width, area.width);
  const minH = Math.min(FLOAT_MIN.height, area.height);
  let left = start.x;
  let top = start.y;
  let right = start.x + start.width;
  let bottom = start.y + start.height;
  if (edge.includes("w")) left = Math.min(Math.max(left + dx, 0), right - minW);
  if (edge.includes("e")) {
    right = Math.max(Math.min(right + dx, area.width), left + minW);
  }
  if (edge.includes("n")) top = Math.min(Math.max(top + dy, 0), bottom - minH);
  if (edge.includes("s")) {
    bottom = Math.max(Math.min(bottom + dy, area.height), top + minH);
  }
  return clampFloatRect(
    { x: left, y: top, width: right - left, height: bottom - top },
    area,
  );
}

/** 상단 경로의 한 조각(Settings의 breadcrumb이 쓴다). */
export interface Crumb {
  readonly label: string;
}

/** drag 결과. overlay pointer DTO(ipc/overlay)의 drag-end·drag-cancel에 대응한다. */
export type DragOutcome =
  | { type: "drag-end"; x: number; y: number }
  | { type: "drag-cancel" };

/**
 * drag 연결. drag-end의 마지막 DTO만 적용하고 drag-cancel은 버린다.
 */
export function applyDrag<T>(start: T, last: T, outcome: DragOutcome): T {
  return outcome.type === "drag-end" ? last : start;
}
