// 계열 색 규칙. 순수 함수.
// - 색은 화면에 남은 순서가 아니라 안정된 domain 안의 엔티티 자리로 정한다. filter가 남은 계열을 다시 칠하지 않는다.
// - 8 slot을 순환하지 않고, 9번째 엔티티부터는 기타 회색 하나로 합친다.
import { tokens } from "@lophn/design";
import type { Series, Slot } from "./types.ts";

export const SLOT_COUNT = tokens.chart.series.length;
// 모든 쌍이 맞닿는 차트(산점)는 3계열까지만 그린다.
export const ALL_PAIRS_MAX = 3;
// 기타 계열의 key. 실제 엔티티 key("other"도 쓸 수 있다)와 겹치지 않도록 domain을 보고 정한다.
function otherKey(domain: readonly string[]): string {
  const taken = new Set(domain);
  let key = "other";
  for (let suffix = 1; taken.has(key); suffix += 1) key = `other~${suffix}`;
  return key;
}

export function slotOf(domain: readonly string[], key: string): Slot {
  const index = domain.indexOf(key);
  return index >= 0 && index < SLOT_COUNT ? index : "other";
}

// light 표면에서 대비가 낮아 직접 라벨이나 표 보기가 필요한 자리.

export interface ColoredSeries extends Series {
  readonly slot: Slot;
}

// 더할 수 있는 값(선, 막대)만 기타로 합친다. 모두 null인 자리만 null로 남는다.
function fold(
  series: readonly Series[],
  length: number,
): (number | null)[] {
  return Array.from({ length }, (_, index) => {
    let sum: number | null = null;
    for (const item of series) {
      const value = item.values[index];
      if (value !== null && value !== undefined) sum = (sum ?? 0) + value;
    }
    return sum;
  });
}

// 기타로 더한 합이 유한한가. 유한한 값끼리도 Number.MAX_VALUE를 넘으면 Infinity가 된다.
export function foldsFinite(
  series: readonly Series[],
  domain: readonly string[],
): boolean {
  const folded = series.filter((item) => slotOf(domain, item.key) === "other");
  let length = 0;
  for (const item of folded) length = Math.max(length, item.values.length);
  return fold(folded, length).every((value) =>
    value === null || Number.isFinite(value)
  );
}

// 검증을 마친 입력을 받는다: key는 겹치지 않고 모두 domain 안에 있다.
// 결과는 domain 순서이고 기타는 맨 끝이다.
export function colorSeries(
  series: readonly Series[],
  domain: readonly string[],
  otherLabel: string,
): ColoredSeries[] {
  const rank = (key: string) => domain.indexOf(key);
  const kept = series
    .filter((item) => slotOf(domain, item.key) !== "other")
    .sort((a, b) => rank(a.key) - rank(b.key))
    .map((item) => ({ ...item, slot: slotOf(domain, item.key) }));
  const folded = series.filter((item) => slotOf(domain, item.key) === "other");
  if (folded.length === 0) return kept;
  let length = 0;
  for (const item of series) length = Math.max(length, item.values.length);
  return [
    ...kept,
    {
      key: otherKey(domain),
      label: otherLabel,
      values: fold(folded, length),
      slot: "other",
    },
  ];
}

// 범례는 2계열부터, 직접 라벨은 4계열까지(겹치지 않을 때만).
export function labelPolicy(
  count: number,
): { legend: boolean; directLabels: boolean } {
  return { legend: count >= 2, directLabels: count >= 1 && count <= 4 };
}
