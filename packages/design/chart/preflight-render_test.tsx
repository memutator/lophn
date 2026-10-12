import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { one, press } from "../components/testing.ts";
import { BarChart } from "./bar-chart.tsx";
import { DistributionChart } from "./distribution-chart.tsx";
import { LineChart } from "./line-chart.tsx";
import { ScatterChart } from "./scatter-chart.tsx";
import { sized, state } from "./testing.tsx";

const MAX = Number.MAX_VALUE;
const keys = "abcdefghij".split("");
const day = [new Date("2026-09-26T00:00:00Z")];

// 그리지 못하면 plot도 표도 없이 중립 상태와 다시 시도 하나만 남는다.
function assertUnreadable(container: HTMLElement, retried: string[]) {
  assertEquals(container.querySelector("svg[data-chart]"), null);
  assertEquals(container.querySelector("table"), null);
  assertEquals(container.querySelector("button[aria-pressed]"), null);
  const message = one(container, "[data-state=empty]");
  assert(
    message.textContent?.includes(
      "This chart couldn't be drawn from its data.",
    ),
  );
  act(() => one(message, "button").click());
  assertEquals(retried, ["retry"]);
}

function assertFinite(container: HTMLElement) {
  assert(
    !/NaN|Infinity|∞/.test(container.innerHTML),
    "non-finite value reached the DOM",
  );
}

Deno.test("apps/sdk#R38: 기타 합산이 넘치는 선 차트는 Infinity를 그리지 않고 다시 시도 상태로 끝난다", () => {
  const retried: string[] = [];
  using view = sized(
    <LineChart
      {...state}
      x={day}
      series={keys.map((key, index) => ({
        key,
        label: key,
        values: [index < 8 ? 1 : MAX],
      }))}
      xLabel="Day"
      onRetry={() => retried.push("retry")}
    />,
  );
  assertFinite(view.container);
  assertUnreadable(view.container, retried);
});

Deno.test("apps/sdk#R38: 누적 합이 넘치는 막대는 그리지 않고, 넘치지 않는 극값 막대는 유한하게 그린다", () => {
  const retried: string[] = [];
  using overflow = sized(
    <BarChart
      {...state}
      stacked
      categories={["Mon"]}
      series={[{ key: "a", label: "A", values: [MAX] }, {
        key: "b",
        label: "B",
        values: [MAX],
      }]}
      xLabel="Day"
      onRetry={() => retried.push("retry")}
    />,
  );
  assertUnreadable(overflow.container, retried);
  using large = sized(
    <BarChart
      {...state}
      categories={["Mon", "Tue"]}
      series={[{ key: "a", label: "A", values: [MAX, null] }]}
      xLabel="Day"
    />,
  );
  const svg = one(large.container, "svg[data-chart=bar]");
  press(svg, "ArrowRight");
  assert(
    one(large.container, "[data-tooltip]").textContent?.startsWith("MonA"),
  );
  assertFinite(large.container);
});

Deno.test("apps/sdk#R38: 같은 극값 분포는 한 막대로, 넘치는 범위 분포와 산점은 다시 시도 상태로 그린다", () => {
  using constant = sized(
    <DistributionChart {...state} values={[MAX, MAX]} valueLabel="Size" />,
  );
  assertEquals(
    constant.container.querySelectorAll("svg[data-chart=distribution] path")
      .length,
    1,
  );
  assertFinite(constant.container);
  const retried: string[] = [];
  using spread = sized(
    <DistributionChart
      {...state}
      values={[-MAX, MAX]}
      valueLabel="Size"
      onRetry={() => retried.push("retry")}
    />,
  );
  assertUnreadable(spread.container, retried);
  const scatterRetried: string[] = [];
  using scatter = sized(
    <ScatterChart
      {...state}
      groups={[{
        key: "a",
        label: "A",
        points: [{ x: -MAX, y: 1 }, { x: MAX, y: 2 }],
      }]}
      xLabel="X"
      yLabel="Y"
      onRetry={() => scatterRetried.push("retry")}
    />,
  );
  assertUnreadable(scatter.container, scatterRetried);
  using point = sized(
    <ScatterChart
      {...state}
      groups={[{ key: "a", label: "A", points: [{ x: MAX, y: -MAX }] }]}
      xLabel="X"
      yLabel="Y"
    />,
  );
  assertEquals(
    point.container.querySelectorAll(
      "svg[data-chart=scatter] circle[data-slot]",
    ).length,
    1,
  );
  assertFinite(point.container);
});

Deno.test("apps/sdk#R38: hole이 있는 배열은 render가 무너지지 않고 다시 시도 상태로 끝난다", () => {
  const retried: string[] = [];
  using view = sized(
    <LineChart
      {...state}
      x={new Array(1)}
      series={[{ key: "a", label: "A", values: [1] }]}
      xLabel="Day"
      onRetry={() => retried.push("retry")}
    />,
  );
  assertUnreadable(view.container, retried);
});

Deno.test("apps/sdk#R38: 수만 개 시점의 선 차트도 인자 펼치기 없이 유한하게 그린다", () => {
  const start = Date.UTC(2026, 0, 1);
  const count = 50_000;
  using view = sized(
    <LineChart
      {...state}
      x={Array.from(
        { length: count },
        (_, index) => new Date(start + index * 60_000),
      )}
      series={[{
        key: "a",
        label: "A",
        values: Array.from({ length: count }, (_, index) => index % 97),
      }]}
      xLabel="Minute"
    />,
  );
  assert(view.container.querySelector("svg[data-chart=line] path"));
  assertFinite(view.container);
});
