import { assert, assertEquals } from "@std/assert";
import {
  checkBars,
  checkDistribution,
  checkGraph,
  checkScatter,
  checkTimeSeries,
} from "./validate.ts";

const days = [
  new Date("2026-09-25T00:00:00Z"),
  new Date("2026-09-26T00:00:00Z"),
];
const series = (key: string, values: unknown[] = [1, null]) => ({
  key,
  label: key,
  values,
});

Deno.test("apps/sdk#R38: 시계열은 유한 값·같은 길이·앞으로 가는 시각만 그린다", () => {
  assert(checkTimeSeries({ x: days, series: [series("a")] }).ok);
  for (
    const input of [
      { x: days, series: [series("a", [1])] },
      { x: days, series: [series("a", [1, Number.NaN])] },
      { x: days, series: [series("a", [1, Number.POSITIVE_INFINITY])] },
      { x: days, series: [series("a", [1, "2"])] },
      { x: [days[1], days[0]], series: [series("a")] },
      { x: [days[0], days[0]], series: [series("a")] },
      { x: [days[0], new Date(Number.NaN)], series: [series("a")] },
      { x: ["2026-09-25", "2026-09-26"], series: [series("a")] },
      { x: days, series: [series("a"), series("a")] },
      { x: days, series: [series("")] },
      { x: days, series: "<script>" },
    ]
  ) {
    assertEquals(checkTimeSeries(input), { ok: false, problem: "invalid" });
  }
});

Deno.test("shell/design-system#R12: domain은 모든 계열 key를 담고 겹치지 않아야 한다", () => {
  const ok = checkBars({
    categories: ["Mon", "Tue"],
    series: [series("b")],
    domain: ["a", "b"],
  });
  assert(ok.ok);
  assertEquals(ok.value.domain, ["a", "b"]);
  assert(
    !checkBars({
      categories: ["Mon", "Tue"],
      series: [series("c")],
      domain: ["a", "b"],
    }).ok,
  );
  assert(
    !checkBars({
      categories: ["Mon", "Tue"],
      series: [series("a")],
      domain: ["a", "a"],
    }).ok,
  );
  assert(!checkBars({ categories: ["Mon", "Mon"], series: [series("a")] }).ok);
});

Deno.test("apps/sdk#R38: 분포는 유한 값과 1–50 구간 수만 받는다", () => {
  assertEquals(checkDistribution({ values: [1, 2] }), {
    ok: true,
    value: { values: [1, 2], bins: 10 },
  });
  for (const bins of [0, 51, 2.5, Number.NaN]) {
    assert(!checkDistribution({ values: [1], bins }).ok);
  }
  assert(!checkDistribution({ values: [1, Number.NaN] }).ok);
});

Deno.test("shell/design-system#R12: 산점 domain이 3 엔티티를 넘으면 버리거나 합치지 않고 too-many-groups다", () => {
  const group = (key: string) => ({
    key,
    label: key,
    points: [{ x: 1, y: 2 }],
  });
  assert(checkScatter({ groups: [group("a"), group("b"), group("c")] }).ok);
  assertEquals(
    checkScatter({ groups: ["a", "b", "c", "d"].map(group) }),
    { ok: false, problem: "too-many-groups" },
  );
  assertEquals(
    checkScatter({ groups: [group("a")], domain: ["a", "b", "c", "d"] }),
    { ok: false, problem: "too-many-groups" },
  );
  assertEquals(
    checkScatter({
      groups: [{ key: "a", label: "a", points: [{ x: 1, y: Number.NaN }] }],
    }),
    { ok: false, problem: "invalid" },
  );
});

Deno.test("apps/sdk#R38: 도표는 겹치는 id·없는 node를 가리키는 edge·자기 edge를 거절한다", () => {
  const nodes = [{ id: "a", label: "A" }, { id: "b", label: "B" }];
  assert(
    checkGraph({ nodes, edges: [{ from: "a", to: "b", label: "uses" }] }).ok,
  );
  assert(
    !checkGraph({ nodes: [...nodes, { id: "a", label: "A2" }], edges: [] }).ok,
  );
  assert(!checkGraph({ nodes, edges: [{ from: "a", to: "z" }] }).ok);
  assert(!checkGraph({ nodes, edges: [{ from: "a", to: "a" }] }).ok);
  assert(!checkGraph({ nodes, edges: [{ from: "a", to: "b", label: 3 }] }).ok);
  assert(
    !checkGraph({ nodes: [{ id: "a", label: { html: "<b>" } }], edges: [] }).ok,
  );
});

Deno.test("apps/sdk#R38: 빈 자리(hole)나 undefined가 있는 배열은 어느 입력에서도 거절한다", () => {
  const hole = <T>(length = 1): T[] => new Array(length);
  const point = { x: 1, y: 1 };
  const node = { id: "a", label: "A" };
  const cases = [
    checkTimeSeries({ x: hole(), series: [series("a", [1])] }),
    checkTimeSeries({ x: [days[0]], series: [series("a", hole())] }),
    checkTimeSeries({ x: [days[0]], series: hole() }),
    checkTimeSeries({ x: days, series: [series("a", [1, undefined])] }),
    checkTimeSeries({
      x: [days[0]],
      series: [series("a", [1])],
      domain: hole(),
    }),
    checkBars({ categories: hole(), series: [series("a", [1])] }),
    checkBars({ categories: ["Only"], series: [series("a", hole())] }),
    checkDistribution({ values: hole() }),
    checkDistribution({ values: [1, undefined] }),
    checkScatter({ groups: hole() }),
    checkScatter({ groups: [{ key: "a", label: "A", points: hole() }] }),
    checkScatter({
      groups: [{ key: "a", label: "A", points: [point, undefined] }],
    }),
    checkGraph({ nodes: hole(), edges: [] }),
    checkGraph({ nodes: [node, undefined], edges: [] }),
    checkGraph({ nodes: [node], edges: hole() }),
  ];
  for (const [index, result] of cases.entries()) {
    assertEquals(result, { ok: false, problem: "invalid" }, String(index));
  }
  // null 값과 0은 hole이 아니다.
  assert(checkBars({ categories: ["Only"], series: [series("a", [null])] }).ok);
  assert(checkTimeSeries({ x: [days[0]], series: [series("a", [0])] }).ok);
});

Deno.test("apps/sdk#R38: 9번째부터 기타로 더한 합이 넘치면 입력을 거절한다", () => {
  const keys = "abcdefghij".split("");
  const overflow = keys.map((key, index) =>
    series(key, [index < 8 ? 1 : Number.MAX_VALUE])
  );
  assertEquals(checkTimeSeries({ x: [days[0]], series: overflow }), {
    ok: false,
    problem: "invalid",
  });
  assertEquals(checkBars({ categories: ["Mon"], series: overflow }), {
    ok: false,
    problem: "invalid",
  });
  // 8 slot 안의 같은 극값은 더하지 않으므로 받는다. null만 있는 자리는 null로 남는다.
  assert(
    checkBars({
      categories: ["Mon", "Tue"],
      series: keys.map((key, index) =>
        series(key, index < 8 ? [Number.MAX_VALUE, 1] : [1, null])
      ),
    }).ok,
  );
});
