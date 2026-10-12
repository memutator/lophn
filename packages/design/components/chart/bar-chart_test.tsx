import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { one, press, style } from "../testing.ts";
import { BarChart } from "./bar-chart.tsx";
import { DistributionChart } from "./distribution-chart.tsx";
import { sized, state } from "./testing.tsx";

const series = [
  { key: "north", label: "North", values: [3, 5, null] },
  { key: "south", label: "South", values: [4, -2, 6] },
];
const categories = ["Mon", "Tue", "Wed"];

// path "M x,base V… H x1 …"에서 막대 폭과 둥근 모서리 수를 읽는다.
function shape(path: Element) {
  const d = path.getAttribute("d") ?? "";
  const numbers = d.match(/-?\d+(\.\d+)?/g)!.map(Number);
  const x = numbers[0];
  const h = /H(-?[\d.]+)/.exec(d);
  const right = /Q(-?[\d.]+),[^ ]+ (-?[\d.]+),/g;
  const corners = d.split("Q").length - 1;
  const lastQ = [...d.matchAll(right)].at(-1);
  return {
    d,
    x,
    h: h ? Number(h[1]) : 0,
    corners,
    end: lastQ ? Number(lastQ[2]) : 0,
  };
}

Deno.test("shell/design-system#R41: 막대는 최대 24px·data 끝만 radius 4px·이웃 사이 2px이다", () => {
  using view = sized(
    <BarChart
      {...state}
      categories={categories}
      series={series}
      xLabel="Day"
    />,
    1200,
  );
  const bars = [...view.container.querySelectorAll("svg[data-chart=bar] path")];
  // null 값은 막대가 없다.
  assertEquals(bars.length, 5);
  const [first, second] = bars.map(shape);
  assertEquals(first.corners, 2);
  // 첫 범주의 두 막대: 폭 24px, 사이 2px.
  assertEquals(first.end - first.x, 24);
  assertEquals(second.x - (first.x + 24), 2);
  assert(bars.every((bar) => !bar.getAttribute("d")?.includes("NaN")));
});

Deno.test("shell/design-system#R13: 누적 막대는 바깥 조각만 둥글고 조각 사이 2px 표면 간격을 둔다", () => {
  using view = sized(
    <BarChart
      {...state}
      stacked
      categories={["Mon"]}
      series={[
        { key: "a", label: "A", values: [3] },
        { key: "b", label: "B", values: [4] },
      ]}
      xLabel="Day"
    />,
  );
  const [lower, upper] = [
    ...view.container.querySelectorAll("svg[data-chart=stacked] path"),
  ];
  assertEquals(lower.getAttribute("d")?.includes("Q"), false);
  assertEquals(upper.getAttribute("d")?.includes("Q"), true);
  const lowerTop = Number(/V(-?[\d.]+)/.exec(lower.getAttribute("d")!)![1]);
  const upperBase = Number(
    /^M[\d.]+,(-?[\d.]+)/.exec(upper.getAttribute("d")!)![1],
  );
  assertEquals(Math.round((lowerTop - upperBase) * 100) / 100, 2);
});

Deno.test("shell/design-system#R13: 막대 tooltip은 hover한 항목 하나의 값을 popover 표면에 보인다", () => {
  using view = sized(
    <BarChart
      {...state}
      categories={categories}
      series={series}
      xLabel="Day"
    />,
  );
  const bar = view.container.querySelectorAll("svg[data-chart=bar] path")[2];
  act(() => {
    bar.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
  const tooltip = one(view.container, "[data-tooltip]");
  assertEquals(tooltip.textContent, "TueNorth5");
  assertEquals(
    style(tooltip).getPropertyValue("background-color"),
    style(document.documentElement).getPropertyValue("--floating-surface")
      .trim(),
  );
  press(one(view.container, "svg[data-chart=bar]"), "ArrowRight");
  assertEquals(one(view.container, "[data-tooltip]").textContent, "TueSouth-2");
});

Deno.test("apps/sdk#R17: 분포는 구간별 수를 막대로 보이고 표 보기에 구간과 수가 있다", () => {
  using view = sized(
    <DistributionChart
      {...state}
      values={[0, 1, 4, 5, 9, 10]}
      bins={5}
      valueLabel="Size"
    />,
  );
  assertEquals(
    view.container.querySelectorAll("svg[data-chart=distribution] path").length,
    3,
  );
  const toggle = [...view.container.querySelectorAll("button")].find((b) =>
    b.textContent === "Show table"
  )!;
  act(() => toggle.click());
  assertEquals(
    [...view.container.querySelectorAll("th")].map((th) => th.textContent),
    ["Size", "Count"],
  );
  assertEquals(
    one(view.container, "tbody tr").textContent,
    "0–22",
  );
});

Deno.test("shell/design-system#R13: 막대 아래 넓은 hover 자리를 hover해도 그 막대의 tooltip이 뜬다", () => {
  using view = sized(
    <BarChart
      {...state}
      categories={categories}
      series={series}
      xLabel="Day"
    />,
  );
  const svg = one(view.container, "svg[data-chart=bar]");
  const hits = [...svg.querySelectorAll("rect[data-hit]")];
  const bars = [...svg.querySelectorAll("path[data-slot]")];
  assertEquals(hits.length, bars.length);
  // hover 자리는 투명하고 막대보다 먼저(아래에) 그린다. 막대 치수는 그대로다.
  assertEquals(style(hits[0]).getPropertyValue("fill"), "transparent");
  assert(
    hits.at(-1)!.compareDocumentPosition(bars[0]) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  );
  assert(Number(hits[2].getAttribute("width")) > 24);
  act(() => {
    hits[2].dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
  assertEquals(one(view.container, "[data-tooltip]").textContent, "TueNorth5");
});

Deno.test("shell/design-system#R13: 간격보다 얇은 누적 조각은 그리지 않지만 표 보기에 값이 남는다", () => {
  using view = sized(
    <BarChart
      {...state}
      stacked
      categories={["Mon"]}
      series={[
        { key: "a", label: "A", values: [100] },
        { key: "b", label: "B", values: [0.25] },
      ]}
      xLabel="Day"
    />,
  );
  assertEquals(
    view.container.querySelectorAll("svg[data-chart=stacked] path[data-slot]")
      .length,
    1,
  );
  assert(!view.container.innerHTML.includes("NaN"));
  const toggle = [...view.container.querySelectorAll("button")].find((b) =>
    b.textContent === "Show table"
  )!;
  act(() => toggle.click());
  assertEquals(one(view.container, "tbody tr").textContent, "Mon1000.25");
});
