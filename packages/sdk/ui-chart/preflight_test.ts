import { assert, assertEquals } from "@std/assert";
import { binValues } from "./bins.ts";
import { extent } from "./geometry.ts";
import { colorSeries } from "./palette.ts";
import { binsDrawable, pointsDrawable, seriesDrawable } from "./preflight.ts";

const MAX = Number.MAX_VALUE;
const values = (list: (number | null)[]) => ({ values: list });
const keys = "abcdefghij".split("");

Deno.test("apps/sdk#R38: 기타로 더한 유한 값이 Infinity가 되면 그리지 않는다", () => {
  const colored = colorSeries(
    keys.map((key, index) => ({
      key,
      label: key,
      values: [index < 8 ? 1 : MAX],
    })),
    keys,
    "Other",
  );
  // 값을 자르거나 바꾸지 않으므로 합은 넘친 그대로이고, 그리기 전에 멈춘다.
  assertEquals(colored.at(-1)!.values, [Number.POSITIVE_INFINITY]);
  assertEquals(seriesDrawable(colored, false), false);
});

Deno.test("apps/sdk#R38: 누적 합이나 nice 축이 넘치면 그리지 않고, 넘치지 않는 큰 값은 그린다", () => {
  assertEquals(seriesDrawable([values([MAX]), values([MAX])], true), false);
  assertEquals(seriesDrawable([values([-MAX, MAX])], false), false);
  assert(seriesDrawable([values([MAX])], false));
  assert(seriesDrawable([values([1e300]), values([1e300])], true));
  assert(seriesDrawable([values([-1e300, null, 1e300])], false));
  assert(seriesDrawable([], false));
});

Deno.test("apps/sdk#R38: 분포는 같은 극값을 한 구간에 모두 담고 넘치는 범위는 그리지 않는다", () => {
  const constant = binValues([MAX, MAX, MAX], 10);
  assertEquals(constant, [{ start: MAX, end: MAX, count: 3 }]);
  assert(binsDrawable(3, constant));
  assertEquals(binsDrawable(2, binValues([-MAX, MAX], 10)), false);
  // 값을 하나라도 잃은 구간은 그리지 않는다.
  assertEquals(binsDrawable(4, binValues([1, 2, 3], 2)), false);
});

Deno.test("apps/sdk#R38: 산점은 같은 극값은 그리고 넘치는 x·y 범위는 그리지 않는다", () => {
  assert(pointsDrawable([{ x: MAX, y: -MAX }, { x: MAX, y: -MAX }]));
  assertEquals(pointsDrawable([{ x: -MAX, y: 1 }, { x: MAX, y: 2 }]), false);
  assertEquals(pointsDrawable([{ x: 1, y: -MAX }, { x: 2, y: MAX }]), false);
});

Deno.test("apps/sdk#R38: 수십만 개 값도 인자 펼치기 없이 범위와 구간을 계산한다", () => {
  const many = Array.from({ length: 300_000 }, (_, index) => index - 1000);
  assertEquals(extent(many), [-1000, 298_999]);
  assertEquals(extent([]), undefined);
  assert(seriesDrawable([values(many)], false));
  const bins = binValues(many, 10);
  assertEquals(bins.reduce((sum, bin) => sum + bin.count, 0), many.length);
  assert(binsDrawable(many.length, bins));
  assert(pointsDrawable(many.map((value) => ({ x: value, y: -value }))));
});
