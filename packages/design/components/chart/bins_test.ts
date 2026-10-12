import { assertEquals } from "@std/assert";
import { binValues } from "./bins.ts";

Deno.test("apps/sdk#R17: 분포는 nice 경계 구간마다 값을 세고 끝 값은 마지막 구간에 든다", () => {
  const bins = binValues([0, 1, 4, 5, 9, 10], 5);
  assertEquals(bins.map((bin) => [bin.start, bin.end, bin.count]), [
    [0, 2, 2],
    [2, 4, 0],
    [4, 6, 2],
    [6, 8, 0],
    [8, 10, 2],
  ]);
  assertEquals(bins.reduce((sum, bin) => sum + bin.count, 0), 6);
});

Deno.test("apps/sdk#R17: 같은 값만 있으면 한 단위 구간을 열고 값이 없으면 구간도 없다", () => {
  const bins = binValues([3, 3, 3], 4);
  assertEquals(bins.reduce((sum, bin) => sum + bin.count, 0), 3);
  assertEquals(bins[0].start, 3);
  assertEquals(binValues([], 4), []);
});
