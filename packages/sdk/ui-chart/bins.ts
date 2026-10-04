// 분포 차트의 구간. d3-scale의 nice 눈금을 구간 경계로 쓴다. 순수 함수.
// @ts-types="@types/d3-scale"
import { scaleLinear } from "d3-scale";
import { extent } from "./geometry.ts";

export interface Bin {
  readonly start: number;
  readonly end: number;
  readonly count: number;
}

// [start, end) 구간마다 값 수를 센다. 마지막 구간은 끝 값을 포함한다.
export function binValues(values: readonly number[], count: number): Bin[] {
  const range = extent(values);
  if (!range) return [];
  const [low, high] = range;
  // 모두 같은 값이면 그 값 하나의 구간이다. low + 1이 low와 같은 큰 수에서도 값을 잃지 않는다.
  if (low === high) return [{ start: low, end: high, count: values.length }];
  const scale = scaleLinear().domain([low, high]).nice(count);
  const [first, last] = scale.domain();
  const edges = [...new Set([first, ...scale.ticks(count), last])]
    .sort((a, b) => a - b);
  const bins = edges.slice(0, -1).map((start, index) => ({
    start,
    end: edges[index + 1],
    count: 0,
  }));
  for (const value of values) {
    const index = bins.findIndex((bin, at) =>
      value >= bin.start &&
      (value < bin.end || (at === bins.length - 1 && value <= bin.end))
    );
    if (index >= 0) bins[index].count += 1;
  }
  return bins;
}
