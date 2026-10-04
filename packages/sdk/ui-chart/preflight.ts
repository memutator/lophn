// 그리기 전 마지막 검사. 입력 값이 모두 유한해도 기타 합산·누적 합·d3 nice 축은 넘칠 수 있다
// (Number.MAX_VALUE 두 개의 합은 Infinity다). 값을 자르거나 바꾸지 않고, 넘치면 그리지 않는다.
// 순수 함수.
import type { Bin } from "./bins.ts";
import {
  extentScale,
  plotBox,
  stackSegments,
  stackTotals,
  valueScale,
} from "./geometry.ts";
import type { ScatterPoint } from "./types.ts";

// 축 값이 유한한지는 폭과 상관이 없다. 위치 비율은 0–1이라 실제 폭에서도 유한하다.
const NOMINAL = plotBox(1000, 0, 0);

interface Scale {
  (value: number): number;
  domain(): number[];
  ticks(count: number): number[];
}

function finiteScale(scale: Scale, values: Iterable<number>): boolean {
  const [low, high] = scale.domain();
  if (![low, high, high - low].every(Number.isFinite)) return false;
  for (const tick of scale.ticks(4)) {
    if (!Number.isFinite(tick) || !Number.isFinite(scale(tick))) return false;
  }
  for (const value of values) {
    if (!Number.isFinite(value) || !Number.isFinite(scale(value))) {
      return false;
    }
  }
  return true;
}

// 선·막대(누적 포함). 기타 합산을 마친 계열을 받는다. null은 값이 없는 자리로 그대로 둔다.
export function seriesDrawable(
  series: readonly { readonly values: readonly (number | null)[] }[],
  stacked: boolean,
): boolean {
  const values: number[] = [];
  for (const item of series) {
    for (const value of item.values) if (value !== null) values.push(value);
  }
  if (!values.every(Number.isFinite)) return false;
  if (!stacked) return finiteScale(valueScale(values, NOMINAL), values);
  let length = 0;
  for (const item of series) length = Math.max(length, item.values.length);
  const ends: number[] = [];
  for (let index = 0; index < length; index += 1) {
    const column = series.map((item) => item.values[index] ?? null);
    ends.push(...stackTotals(column));
    for (const segment of stackSegments(column)) {
      ends.push(segment.start, segment.end);
    }
  }
  return finiteScale(valueScale(ends, NOMINAL), ends);
}

// 분포: 구간 경계가 유한하고 앞으로 가며, 모든 값이 어느 구간에든 들어갔다.
export function binsDrawable(count: number, bins: readonly Bin[]): boolean {
  let total = 0;
  for (const [index, bin] of bins.entries()) {
    if (![bin.start, bin.end, bin.end - bin.start].every(Number.isFinite)) {
      return false;
    }
    if (bin.end < bin.start || (index > 0 && bin.start < bins[index - 1].end)) {
      return false;
    }
    total += bin.count;
  }
  return total === count &&
    finiteScale(valueScale(bins.map((bin) => bin.count), NOMINAL), []);
}

// 산점: x·y 축이 모두 유한하다.
export function pointsDrawable(points: readonly ScatterPoint[]): boolean {
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  return finiteScale(extentScale(xs, [NOMINAL.left, NOMINAL.right]), xs) &&
    finiteScale(extentScale(ys, [NOMINAL.bottom, NOMINAL.top]), ys);
}
