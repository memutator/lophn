import { assert, assertEquals } from "@std/assert";
import {
  axisGutter,
  barPath,
  GEOMETRY,
  groupLayout,
  labelsFit,
  nearestIndex,
  placeBottomLabels,
  plotBox,
  stackSegments,
  stackTotals,
  textWidth,
  tickIndexes,
  valueLabelsFit,
} from "./geometry.ts";

Deno.test("shell/design-system#R13: mark 치수는 선 2px·막대 최대 24px·radius 4px·간격 2px·점 4px·높이 240px이다", () => {
  assertEquals(
    {
      line: GEOMETRY.line,
      gap: GEOMETRY.gap,
      ring: GEOMETRY.ring,
      barMax: GEOMETRY.barMax,
      barRadius: GEOMETRY.barRadius,
      point: GEOMETRY.point,
      height: GEOMETRY.height,
    },
    {
      line: 2,
      gap: 2,
      ring: 2,
      barMax: 24,
      barRadius: 4,
      point: 4,
      height: 240,
    },
  );
});

Deno.test("shell/design-system#R41: 막대는 data 끝만 둥글고 baseline은 각지며 아래로 자라도 같다", () => {
  assertEquals(
    barPath(10, 24, 100, 40, 4),
    "M10,100V44Q10,40 14,40H30Q34,40 34,44V100Z",
  );
  assertEquals(
    barPath(10, 24, 100, 160, 4),
    "M10,100V156Q10,160 14,160H30Q34,160 34,156V100Z",
  );
  // 높이가 radius보다 작으면 radius를 줄인다.
  assertEquals(barPath(0, 24, 10, 8, 4), "M0,10V10Q0,8 2,8H22Q24,8 24,10V10Z");
  assertEquals(barPath(0, 24, 10, 10, 4), "");
  assertEquals(barPath(0, 24, 10, 0, 0), "M0,10V0H24V10Z");
});

Deno.test("shell/design-system#R41: 묶음 막대는 24px을 넘지 않고 사이 2px로 띠 가운데에 놓인다", () => {
  assertEquals(groupLayout(0, 200, 2), { xs: [75, 101], width: 24, gap: 2 });
  const narrow = groupLayout(0, 20, 3);
  assertEquals(narrow.width, (20 - 4) / 3);
  assertEquals(narrow.xs[1] - narrow.xs[0], narrow.width + 2);
});

Deno.test("shell/design-system#R13: 누적 막대는 양수는 위·음수는 아래로 쌓고 바깥 조각만 data 끝이다", () => {
  assertEquals(stackSegments([3, null, -2, 0, 4, -1]), [
    { index: 0, start: 0, end: 3, outer: false },
    { index: 2, start: 0, end: -2, outer: false },
    { index: 4, start: 3, end: 7, outer: true },
    { index: 5, start: -2, end: -3, outer: true },
  ]);
  assertEquals(stackTotals([3, null, -2, 4, -1]), [-3, 7]);
});

Deno.test("shell/design-system#R13: 십자선은 가장 가까운 x를 고르고 겹치는 직접 라벨은 두지 않는다", () => {
  assertEquals(nearestIndex([0, 10, 20, 30], 14), 1);
  assertEquals(nearestIndex([0, 10, 20, 30], 16), 2);
  assertEquals(nearestIndex([0, 10, 20, 30], 99), 3);
  assertEquals(nearestIndex([], 5), -1);
  assert(labelsFit([10, 40, 80]));
  assert(!labelsFit([10, 20, 80]));
});

Deno.test("shell/design-system#R41: 축 label은 폭에 맞게 건너뛰고 마지막 자리를 남긴다", () => {
  assertEquals(tickIndexes(5, 1000, 40), [0, 1, 2, 3, 4]);
  const sparse = tickIndexes(30, 300, 40);
  assertEquals(sparse.at(-1), 29);
  assert(sparse.length <= 6);
  assertEquals(tickIndexes(0, 300, 40), []);
});

Deno.test("shell/design-system#R41: 좁은 띠의 묶음 막대는 간격을 줄여서라도 띠 안에 남는다", () => {
  const tiny = groupLayout(8, 1, 9);
  assertEquals(tiny.gap, 0);
  assert(tiny.width > 0);
  assert(tiny.xs.every((x) => x >= 8 && x + tiny.width <= 9 + 1e-9));
  // 1px 막대와 2px 간격이 들어가면 간격을 지킨다.
  const fits = groupLayout(0, 25, 9);
  assertEquals([fits.width, fits.gap], [1, 2]);
  assert(fits.xs.every((x) => x >= 0 && x + fits.width <= 25));
  assertEquals(groupLayout(0, 0, 3).width, 0);
  assertEquals(groupLayout(0, -5, 2).width, 0);
});

Deno.test("shell/design-system#R41: plot의 x 범위는 축 칸과 라벨 칸이 넓어도 0..width 안이다", () => {
  assertEquals([plotBox(640, 40, 10).left, plotBox(640, 40, 10).right], [
    40,
    630,
  ]);
  for (
    const [width, left, right] of [[32, 60, 8], [96, 30, 400], [0, 10, 10]]
  ) {
    const box = plotBox(width, left, right);
    assert(
      box.left >= 0 && box.left <= box.right && box.right <= width,
      `${width}`,
    );
  }
});

Deno.test("shell/design-system#R41: 값 축 칸은 글자 폭 + 8px이고 아주 긴 글자도 폭의 절반을 넘지 않는다", () => {
  assertEquals(axisGutter(["0", "100K"], 640), textWidth("100K") + 8);
  assertEquals(axisGutter(["9".repeat(400)], 96), 48);
  assertEquals(axisGutter([], 0), 0);
});

Deno.test("shell/design-system#R41: 글자 폭은 넓은 글자도 넉넉히 잡는다(ASCII 1em, 숫자 0.7em, 넓은 글자 2em)", () => {
  assertEquals(textWidth("WWWWWWWWWW"), 120);
  assertEquals(textWidth("2026"), 34);
  assertEquals(textWidth("日本🙂"), 72);
  assert(textWidth("Sep 26") >= 60);
});

Deno.test("shell/design-system#R41: 값 축 label은 모두 왼쪽 칸에 들어갈 때만 둔다", () => {
  assert(valueLabelsFit(["0", "100K"], 60));
  assertEquals(valueLabelsFit(["0", "0.5", "1"], 16), false);
  assertEquals(valueLabelsFit(["1".repeat(100)], 320), false);
});

Deno.test("shell/design-system#R41: 아래 축 label은 SVG 안에 들어가고 서로 겹치지 않는 것만 남긴다", () => {
  const extentOf = (label: ReturnType<typeof placeBottomLabels>[number]) => {
    const size = textWidth(label.label);
    const start = label.anchor === "start"
      ? label.x
      : label.anchor === "end"
      ? label.x - size
      : label.x - size / 2;
    return [start, start + size];
  };
  // 32px에 들어가지 않는 날짜는 두지 않는다.
  assertEquals(placeBottomLabels([{ at: 16, label: "Sep 26" }], 32), []);
  // 양 끝 label은 SVG 안으로 끝을 맞춘다.
  const edges = placeBottomLabels(
    [{ at: 2, label: "10" }, { at: 638, label: "90" }],
    640,
  );
  assertEquals(edges.map((label) => label.anchor), ["start", "end"]);
  // 촘촘한 눈금은 겹치지 않게 일부만 남긴다.
  const dense = placeBottomLabels(
    Array.from({ length: 20 }, (_, index) => ({
      at: index * 30,
      label: String(1000 * index),
    })),
    600,
  );
  assert(dense.length < 20 && dense.length > 1);
  const spans = dense.map(extentOf);
  for (const [index, [start, end]] of spans.entries()) {
    assert(start >= 0 && end <= 600);
    if (index > 0) assert(start >= spans[index - 1][1] + 8);
  }
});
