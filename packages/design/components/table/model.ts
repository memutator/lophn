// 표의 순수 규칙: 가상 scroll 창과 개발자 ID 줄임. React·DOM을 모른다.
import { tokens } from "../../tokens.ts";
import { pixels } from "../shared.ts";

export type Density = keyof typeof tokens.table.row;

// 이 행 수를 넘으면 보이는 창만 그린다.
export const VIRTUALIZE_AFTER = 1000;
// 빠르게 scroll해도 빈 줄이 보이지 않도록 위아래로 더 그리는 행 수.
export const OVERSCAN = 8;
export const ID_PREFIX_LENGTH = 8;

export function rowPixels(density: Density): number {
  return pixels(tokens.table.row[density]);
}

export function virtualizes(total: number): boolean {
  return total > VIRTUALIZE_AFTER;
}

export interface VirtualWindow {
  // 그릴 행 [start, end).
  readonly start: number;
  readonly end: number;
  // 위·아래 자리를 지키는 행 수. 높이는 행 수 × 행 높이다.
  readonly before: number;
  readonly after: number;
}

export function virtualWindow(
  total: number,
  rowHeight: number,
  scrollTop: number,
  viewportHeight: number,
  overscan = OVERSCAN,
): VirtualWindow {
  const top = Math.max(0, scrollTop);
  const first = Math.min(total, Math.floor(top / rowHeight));
  const start = Math.max(0, first - overscan);
  const visible = Math.ceil(Math.max(0, viewportHeight) / rowHeight);
  const end = Math.min(total, first + visible + overscan);
  return { start, end, before: start, after: total - end };
}

// diagnostics에서만 보이는 ID의 앞 8자. 전체 값은 복사로만 꺼낸다.
export function shortId(id: string): string {
  return id.slice(0, ID_PREFIX_LENGTH);
}
