import type { Density } from "./model.ts";

// 가상 scroll이 DOM에서 읽고 쓰는 것. 테스트는 바꿔 끼우고, 제품은 DOM 값을 쓴다.
// 자리 행 높이는 px 값이 아니라 행 수 × 행 높이 token으로만 쓴다.
export interface TableViewport {
  scrollTop(scroller: HTMLElement): number;
  reserve(spacer: HTMLElement, rows: number, density: Density): void;
}

export function reservedHeight(rows: number, density: Density): string {
  if (!Number.isSafeInteger(rows) || rows < 0) {
    throw new RangeError(`invalid reserved row count ${rows}`);
  }
  return `calc(${rows} * var(--table-row-${density}))`;
}

export const domTableViewport: TableViewport = {
  scrollTop: (scroller) => scroller.scrollTop,
  reserve(spacer, rows, density) {
    spacer.style.setProperty("height", reservedHeight(rows, density));
  },
};
