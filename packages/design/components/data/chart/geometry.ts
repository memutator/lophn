// mark 치수와 SVG geometry. 순수 함수. 치수는 token에서만 읽는다.
// @ts-types="@types/d3-scale"
import { scaleLinear } from "d3-scale";
import { tokens } from "../../../tokens.ts";

const px = (value: string) => Number.parseFloat(value);

export const GEOMETRY = {
  line: px(tokens.chart.line),
  gap: px(tokens.chart.gap),
  ring: px(tokens.chart.ring),
  barMax: px(tokens.chart.bar.max),
  barRadius: px(tokens.chart.bar.radius),
  point: px(tokens.chart.point),
  // 축 label 띠까지 포함한 차트 전체 높이.
  height: px(tokens.chart.height),
  // 축 글자와 plot 사이, 위 여백.
  pad: px(tokens.space[4]),
  caption: px(tokens.type.caption.line),
} as const;

// x 축 label 띠: caption 한 줄과 위 여백.
// 점의 hover 자리 반지름: 점·표면 ring·간격을 더한 만큼. 보이는 점(4px)은 그대로다.
export const POINT_HIT = GEOMETRY.point + GEOMETRY.ring + GEOMETRY.gap;

const AXIS_BAND = GEOMETRY.caption + GEOMETRY.pad;

// 글자 폭은 DOM에서 재지 않고 caption em으로 넉넉하게 어림한다. 실제보다 좁게 잡으면 글이 SVG 밖으로
// 나가므로 언제나 위쪽 한계를 쓴다: 숫자·문장 부호·공백 0.7em(tabular 숫자는 0.6em 남짓),
// 다른 ASCII 1em(W·M 같은 넓은 글자), 그 밖의 글자 2em(한자·한글·emoji 같은 넓은 글자).
const EM = px(tokens.type.caption.size);
const NARROW = new Set("0123456789 .,:;'!|-+%()/–−");

export function textWidth(text: string): number {
  let width = 0;
  for (const character of text) {
    const code = character.codePointAt(0)!;
    width += NARROW.has(character) ? 0.7 : code < 0x80 ? 1 : 2;
  }
  return Math.ceil(width * EM);
}

// 값 축 label은 모두 왼쪽 칸(0..box.left - 간격)에 들어갈 때만 둔다. 일부만 보이는 축은 읽기 어렵다.
export function valueLabelsFit(labels: readonly string[], left: number) {
  return labels.every((label) => textWidth(label) <= left - GEOMETRY.pad);
}

interface PlacedLabel {
  readonly at: number;
  readonly label: string;
  readonly x: number;
  readonly anchor: "start" | "middle" | "end";
}

// 아래 축 label: 눈금 가운데에 두되 양 끝에서는 SVG 안으로 끝을 맞춘다. SVG 폭보다 넓은 label과
// 앞 label과 겹치는 label은 두지 않는다(격자는 그대로 남는다).
export function placeBottomLabels(
  ticks: readonly { at: number; label: string }[],
  width: number,
): PlacedLabel[] {
  const placed: PlacedLabel[] = [];
  let edge = Number.NEGATIVE_INFINITY;
  for (const tick of [...ticks].sort((a, b) => a.at - b.at)) {
    const size = textWidth(tick.label);
    if (size > width) continue;
    const start = Math.min(Math.max(0, tick.at - size / 2), width - size);
    if (start < edge + GEOMETRY.pad) continue;
    const anchor = start === 0 && tick.at - size / 2 < 0
      ? "start"
      : start === width - size && tick.at + size / 2 > width
      ? "end"
      : "middle";
    const x = anchor === "start" ? 0 : anchor === "end" ? width : tick.at;
    placed.push({ ...tick, x, anchor });
    edge = start + size;
  }
  return placed;
}

// 큰 배열을 Math.min(...values)처럼 인자로 펼치면 call stack을 넘으므로 한 번씩 돈다.
export function extent(values: Iterable<number>): [number, number] | undefined {
  let low = Number.POSITIVE_INFINITY;
  let high = Number.NEGATIVE_INFINITY;
  let seen = false;
  for (const value of values) {
    seen = true;
    if (value < low) low = value;
    if (value > high) high = value;
  }
  return seen ? [low, high] : undefined;
}

export function largest(values: Iterable<number>, floor = 0): number {
  let high = floor;
  for (const value of values) if (value > high) high = value;
  return high;
}

export interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

// 값 축 글자 칸. 아주 긴 축 글자(극값)도 plot 폭의 절반을 넘겨 가져가지 않는다.
export function axisGutter(labels: Iterable<string>, width: number): number {
  let widest = 0;
  for (const label of labels) widest = Math.max(widest, textWidth(label));
  return Math.min(widest + GEOMETRY.pad, Math.max(0, width) / 2);
}

// plot의 x 범위는 언제나 0..width 안이다. 축 글자와 직접 라벨 칸이 폭보다 크면 plot이 좁아지지 SVG 밖으로 나가지 않는다.
export function plotBox(width: number, left: number, right: number): Box {
  const start = Math.min(Math.max(0, left), Math.max(0, width));
  return {
    left: start,
    right: Math.max(start, Math.min(width, width - right)),
    top: GEOMETRY.pad,
    bottom: GEOMETRY.height - AXIS_BAND,
  };
}

// 0을 언제나 넣은 nice 값 축. 값이 없으면 0–1이다.
export function valueScale(values: readonly number[], box: Box) {
  const [low, high] = extent([0, ...values.filter(Number.isFinite)])!;
  return scaleLinear()
    .domain(low === high ? [0, 1] : [low, high])
    .nice(4)
    .range([box.bottom, box.top]);
}

// 산점처럼 0이 의미 없는 축. 한 값뿐이면 그 값 둘레를 연다.
export function extentScale(
  values: readonly number[],
  range: [number, number],
) {
  const [low, high] = extent(values) ?? [0, 0];
  const domain = low === high ? [low - 1, high + 1] : [low, high];
  return scaleLinear().domain(domain).nice(4).range(range);
}

// 막대 하나의 path. data 끝은 radius로 둥글고 baseline 끝은 각지다. 위·아래로 자라는 막대 모두 된다.
export function barPath(
  x: number,
  width: number,
  base: number,
  end: number,
  radius: number,
): string {
  const height = Math.abs(end - base);
  if (height === 0 || width <= 0) return "";
  const r = Math.max(0, Math.min(radius, height, width / 2));
  const x1 = x + width;
  if (r === 0) return `M${x},${base}V${end}H${x1}V${base}Z`;
  const toward = end < base ? 1 : -1;
  return `M${x},${base}V${end + toward * r}Q${x},${end} ${x + r},${end}H${
    x1 - r
  }Q${x1},${end} ${x1},${end + toward * r}V${base}Z`;
}

// 한 범주 띠 안의 막대들: 폭은 최대 24px, 이웃 사이 2px, 묶음은 띠 가운데.
// 띠가 1px 막대와 2px 간격을 담지 못할 만큼 좁으면 간격을 없애고 띠를 똑같이 나눈다.
// 어느 경우에도 막대는 띠 [bandStart, bandStart + bandWidth] 밖으로 나가지 않는다.
export function groupLayout(
  bandStart: number,
  bandWidth: number,
  count: number,
): { xs: number[]; width: number; gap: number } {
  if (count <= 0) return { xs: [], width: 0, gap: 0 };
  const room = Math.max(0, bandWidth);
  const spaced = (room - GEOMETRY.gap * (count - 1)) / count;
  const gap = spaced >= 1 ? GEOMETRY.gap : 0;
  const width = Math.min(GEOMETRY.barMax, spaced >= 1 ? spaced : room / count);
  const total = width * count + gap * (count - 1);
  const start = bandStart + (room - total) / 2;
  return {
    xs: Array.from(
      { length: count },
      (_, index) => start + index * (width + gap),
    ),
    width,
    gap,
  };
}

interface StackSegment {
  readonly index: number;
  readonly start: number;
  readonly end: number;
  // 그 방향의 가장 바깥 조각만 둥근 data 끝을 갖는다.
  readonly outer: boolean;
}

// 계열 순서대로 쌓는다. 양수는 0에서 위로, 음수는 아래로 쌓아 접히지 않는다. null과 0은 조각이 없다.
export function stackSegments(
  values: readonly (number | null)[],
): StackSegment[] {
  const segments: { index: number; start: number; end: number }[] = [];
  let up = 0;
  let down = 0;
  values.forEach((value, index) => {
    if (value === null || value === 0) return;
    if (value > 0) {
      segments.push({ index, start: up, end: up + value });
      up += value;
    } else {
      segments.push({ index, start: down, end: down + value });
      down += value;
    }
  });
  const lastUp = segments.findLast((segment) => segment.end > 0);
  const lastDown = segments.findLast((segment) => segment.end < 0);
  return segments.map((segment) => ({
    ...segment,
    outer: segment === lastUp || segment === lastDown,
  }));
}

// 쌓은 막대의 합: 축 domain을 정할 때 쓴다.
export function stackTotals(
  values: readonly (number | null)[],
): [number, number] {
  let up = 0;
  let down = 0;
  for (const value of values) {
    if (value === null) continue;
    if (value > 0) up += value;
    else down += value;
  }
  return [down, up];
}

// 정렬된 위치 가운데 target에 가장 가까운 것의 자리. 비었으면 -1.
export function nearestIndex(
  sorted: readonly number[],
  target: number,
): number {
  if (sorted.length === 0) return -1;
  let low = 0;
  let high = sorted.length - 1;
  while (high - low > 1) {
    const middle = (low + high) >> 1;
    if (sorted[middle] < target) low = middle;
    else high = middle;
  }
  return Math.abs(sorted[low] - target) <= Math.abs(sorted[high] - target)
    ? low
    : high;
}

// 직접 라벨은 모든 쌍이 한 줄 높이 이상 떨어질 때만 둔다. 모이는 선은 범례와 tooltip으로 읽는다.
export function labelsFit(ys: readonly number[]): boolean {
  const sorted = [...ys].sort((a, b) => a - b);
  return sorted.every((y, index) =>
    index === 0 || y - sorted[index - 1] >= GEOMETRY.caption
  );
}

// 폭에 들어가는 만큼만 축 label을 둔다. 마지막(최근) 자리는 언제나 남긴다.
export function tickIndexes(count: number, span: number, label: number) {
  if (count <= 0) return [];
  const room = Math.max(1, Math.floor(span / (label + GEOMETRY.pad * 2)));
  const every = Math.max(1, Math.ceil(count / room));
  return Array.from({ length: count }, (_, index) => index).filter((index) =>
    (count - 1 - index) % every === 0
  );
}
