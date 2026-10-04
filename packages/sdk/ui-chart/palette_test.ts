import { assertEquals } from "@std/assert";
import {
  colorSeries,
  labelPolicy,
  needsLabelOrTable,
  otherKey,
  slotOf,
} from "./palette.ts";
import type { Series } from "./types.ts";

const series = (key: string, values: (number | null)[] = [1]): Series => ({
  key,
  label: key.toUpperCase(),
  values,
});

const domain = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];

Deno.test("shell/design-system#R12: 색은 domain 자리로 정해 filter와 입력 순서가 남은 계열을 다시 칠하지 않는다", () => {
  const all = colorSeries(
    domain.slice(0, 4).map((key) => series(key)),
    domain,
    "Other",
  );
  const filtered = colorSeries([series("d"), series("b")], domain, "Other");
  assertEquals(all.map((item) => [item.key, item.slot]), [
    ["a", 0],
    ["b", 1],
    ["c", 2],
    ["d", 3],
  ]);
  assertEquals(filtered.map((item) => [item.key, item.slot]), [["b", 1], [
    "d",
    3,
  ]]);
});

Deno.test("shell/design-system#R11: 8 slot을 순환하지 않고 9번째부터 기타 회색 하나로 더한다", () => {
  const colored = colorSeries(
    [
      ...domain.slice(0, 8).map((key) => series(key, [1, 1])),
      series("i", [2, null]),
      series("j", [3, null]),
    ],
    domain,
    "Other",
  );
  assertEquals(colored.length, 9);
  assertEquals(colored.map((item) => item.slot), [
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    "other",
  ]);
  assertEquals(colored[8].label, "Other");
  // 더한 값, 그리고 모두 null인 자리는 null이다.
  assertEquals(colored[8].values, [5, null]);
  assertEquals(slotOf(domain, "i"), "other");
  assertEquals(slotOf(domain, "zzz"), "other");
});

Deno.test("shell/design-system#R11: light aqua·yellow·magenta 자리만 직접 라벨 또는 표 보기가 필요하다", () => {
  assertEquals(
    [0, 1, 2, 3, 4, 5, 6, 7, "other" as const].filter(needsLabelOrTable),
    [2, 3, 4],
  );
});

Deno.test("shell/design-system#R12: 범례는 2계열부터, 직접 라벨은 4계열까지다", () => {
  assertEquals(labelPolicy(1), { legend: false, directLabels: true });
  assertEquals(labelPolicy(2), { legend: true, directLabels: true });
  assertEquals(labelPolicy(4), { legend: true, directLabels: true });
  assertEquals(labelPolicy(5), { legend: true, directLabels: false });
});

Deno.test("shell/design-system#R12: 실제 엔티티 key other와 기타 계열 key는 겹치지 않는다", () => {
  const withOther = ["other", "b", "c", "d", "e", "f", "g", "h", "i"];
  const colored = colorSeries(
    withOther.map((key) => series(key)),
    withOther,
    "Other",
  );
  assertEquals(colored.length, 9);
  assertEquals(new Set(colored.map((item) => item.key)).size, 9);
  assertEquals(colored[0].key, "other");
  assertEquals(colored[0].slot, 0);
  assertEquals(colored[8].key, "other~1");
  assertEquals(otherKey(["other", "other~1", "x"]), "other~2");
  assertEquals(otherKey(["a"]), "other");
});
