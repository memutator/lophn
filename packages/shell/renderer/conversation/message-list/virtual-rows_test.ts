import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RowHeights,
  offsetsOf,
  segmentsOf,
  windowOf,
  type Segment,
} from "./virtual-rows.ts";

// 빈 칸 계산이 틀리면 안 그린 행의 높이가 어긋나 읽던 위치가 밀린다.
function height(segments: readonly Segment[], offsets: readonly number[]) {
  const gap = 10;
  let total = 0;
  for (const one of segments) {
    if (one.kind === "space") total += one.height;
    else total += offsets[one.to]! - offsets[one.from]! - gap;
  }
  // 그리는 덩어리와 빈 칸이 flex gap으로 이어진 총 높이.
  return total + (segments.length - 1) * gap;
}

test("그리는 행과 빈 칸의 높이를 이으면 전체 높이와 같다", () => {
  const keys = Array.from({ length: 20 }, (_, index) => `r${index}`);
  const heights = new RowHeights();
  keys.forEach((key, index) => heights.set(key, index === 7 ? 0 : 100));
  const offsets = offsetsOf(keys, heights, 10);
  const whole = offsets[20]! - 10;
  for (const [start, end] of [
    [0, 3],
    [5, 9],
    [10, 14],
    [17, 20],
  ] as const) {
    const segments = segmentsOf(offsets, 10, start, end, 2);
    assert.equal(height(segments, offsets), whole);
    const last = segments.at(-1)!;
    assert.deepEqual(last.kind === "rows" && last.to, 20);
  }
});

test("화면 범위는 걸치는 행만 고르고, 안 잰 행은 잰 행의 평균으로 센다", () => {
  const heights = new RowHeights();
  heights.set("a", 100);
  heights.set("b", 300);
  assert.equal(heights.estimate(), 200);
  const keys = ["a", "b", "c", "d", "e"];
  const offsets = offsetsOf(keys, heights, 0);
  assert.deepEqual(offsets, [0, 100, 400, 600, 800, 1000]);
  assert.deepEqual(windowOf(offsets, 450, 650), { start: 2, end: 4 });
});
