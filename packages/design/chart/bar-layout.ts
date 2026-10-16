// 막대 geometry와 hover 자리. 순수 함수.
import { GEOMETRY, groupLayout, stackSegments } from "./geometry.ts";
import type { ColoredSeries } from "./palette.ts";
import type { Slot } from "./types.ts";

interface BarItem {
  readonly category: number;
  readonly series: number;
  readonly slot: Slot;
  readonly value: number;
  readonly x: number;
  readonly width: number;
  readonly base: number;
  readonly end: number;
  readonly rounded: boolean;
}

type Band = (index: number) => { start: number; width: number };

// 누적 조각 하나. baseline에 닿지 않는 조각은 시작을 2px 표면 간격만큼 바깥으로 민다.
// 간격 이하 높이의 조각은 밀면 끝을 넘어 뒤집히므로 그리지 않는다. 값은 표 보기에 남는다.
function stackedItems(
  category: number,
  series: readonly ColoredSeries[],
  values: readonly (number | null)[],
  x: number,
  width: number,
  y: (value: number) => number,
): BarItem[] {
  const drawn: BarItem[] = [];
  for (const segment of stackSegments(values)) {
    const base = y(segment.start);
    const end = y(segment.end);
    const touches = segment.start === 0;
    if (!touches && Math.abs(end - base) <= GEOMETRY.gap) continue;
    const toward = end < base ? -1 : 1;
    drawn.push({
      category,
      series: segment.index,
      slot: series[segment.index].slot,
      value: values[segment.index] as number,
      x,
      width,
      base: touches ? base : base + toward * GEOMETRY.gap,
      end,
      rounded: false,
    });
  }
  // 둥근 data 끝은 그 방향에서 실제로 그린 가장 바깥 조각이 갖는다.
  const outer = (up: boolean) =>
    drawn.findLast((item) => (item.value > 0) === up);
  const ends = new Set([outer(true), outer(false)]);
  return drawn.map((item) =>
    ends.has(item) ? { ...item, rounded: true } : item
  );
}

export function barItems(
  categories: number,
  series: readonly ColoredSeries[],
  stacked: boolean,
  band: Band,
  y: (value: number) => number,
): BarItem[] {
  const items: BarItem[] = [];
  for (let category = 0; category < categories; category += 1) {
    const { start, width } = band(category);
    const values = series.map((item) => item.values[category] ?? null);
    if (stacked) {
      const barWidth = Math.min(GEOMETRY.barMax, Math.max(0, width));
      // 그릴 폭이 없으면 막대를 두지 않는다. 값은 표 보기에 남는다.
      if (barWidth <= 0) continue;
      const x = start + (width - barWidth) / 2;
      items.push(...stackedItems(category, series, values, x, barWidth, y));
      continue;
    }
    const layout = groupLayout(start, width, series.length);
    values.forEach((value, index) => {
      if (value === null || value === 0 || layout.width <= 0) return;
      items.push({
        category,
        series: index,
        slot: series[index].slot,
        value,
        x: layout.xs[index],
        width: layout.width,
        base: y(0),
        end: y(value),
        rounded: true,
      });
    });
  }
  return items;
}

interface HitBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

// 가는 막대도 hover하기 쉽도록 보이지 않는 넓은 자리를 준다. 자리끼리 겹치지 않아
// 한 자리는 언제나 한 막대의 것이다.
// - 묶음 막대: 띠 안에서 이웃 막대 사이 가운데까지, 위아래는 plot 높이 전체.
// - 누적 막대: 띠 폭 전체, 위아래는 이웃 조각 사이 가운데까지이고 양 끝 조각은 plot 끝까지.
export function barHits(
  items: readonly BarItem[],
  seriesCount: number,
  stacked: boolean,
  band: Band,
  top: number,
  bottom: number,
): HitBox[] {
  const edges = (item: BarItem) =>
    [Math.min(item.base, item.end), Math.max(item.base, item.end)] as const;
  const columns = new Map<number, BarItem[]>();
  for (const item of items) {
    columns.set(item.category, [...(columns.get(item.category) ?? []), item]);
  }
  for (const column of columns.values()) {
    column.sort((a, b) => edges(a)[0] - edges(b)[0]);
  }
  return items.map((item) => {
    const { start, width } = band(item.category);
    if (!stacked) {
      const { xs, width: bar } = groupLayout(start, width, seriesCount);
      const index = item.series;
      const left = index === 0 ? start : (xs[index - 1] + bar + xs[index]) / 2;
      const right = index === seriesCount - 1
        ? start + width
        : (xs[index] + bar + xs[index + 1]) / 2;
      return { x: left, y: top, width: right - left, height: bottom - top };
    }
    const column = columns.get(item.category)!;
    const at = column.indexOf(item);
    const above = column[at - 1];
    const below = column[at + 1];
    const upper = above ? (edges(above)[1] + edges(item)[0]) / 2 : top;
    const lower = below ? (edges(item)[1] + edges(below)[0]) / 2 : bottom;
    return { x: start, y: upper, width, height: lower - upper };
  });
}
