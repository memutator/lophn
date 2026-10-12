import { assert } from "@std/assert";
import { act } from "react";
import { one, press } from "../components/testing.ts";
import { BarChart } from "./bar-chart.tsx";
import { ScatterChart } from "./scatter-chart.tsx";
import { textWidth } from "./geometry.ts";
import { LineChart } from "./line-chart.tsx";
import { sized, state } from "./testing.tsx";

const LONG =
  "Very long entity label that cannot fit in this narrow chart panel";

// SVG 안의 모든 x 범위가 0..width 안이고 폭이 음수가 아니다.
function assertInside(svg: Element) {
  const width = Number(svg.getAttribute("width"));
  for (const node of svg.querySelectorAll("foreignObject, rect[data-hit]")) {
    const x = Number(node.getAttribute("x"));
    const span = Number(node.getAttribute("width"));
    assert(span >= 0 && x >= 0 && x + span <= width + 1e-9, node.outerHTML);
  }
  for (const label of svg.querySelectorAll("[data-direct-label]")) {
    const x = Number(label.getAttribute("x"));
    assert(x + textWidth(label.textContent ?? "") <= width, label.textContent!);
  }
  assert(!/NaN|Infinity/.test(svg.outerHTML));
}

Deno.test("shell/design-system#R41: 96px 선 차트의 긴 이름은 직접 라벨 없이 그리고 tooltip 상자는 SVG 안이다", () => {
  using view = sized(
    <LineChart
      {...state}
      x={[new Date(0), new Date(1000)]}
      series={[{ key: "a", label: LONG, values: [1, 2] }]}
      xLabel="X"
    />,
    96,
  );
  const svg = one(view.container, "svg[data-chart=line]");
  assert(svg.querySelector("[data-direct-label]") === null);
  for (const clientX of [0, 48, 95, 400]) {
    act(() =>
      svg.dispatchEvent(
        new PointerEvent("pointermove", { bubbles: true, clientX }),
      )
    );
    assert(one(view.container, "[data-tooltip]").textContent?.includes(LONG));
    assertInside(svg);
  }
});

Deno.test("shell/design-system#R41: 넓은 칸에서는 짧은 직접 라벨을 그대로 둔다", () => {
  using view = sized(
    <LineChart
      {...state}
      x={[new Date(0), new Date(1000)]}
      series={[{ key: "a", label: "North", values: [1, 2] }]}
      xLabel="X"
    />,
  );
  const svg = one(view.container, "svg[data-chart=line]");
  assert(svg.querySelector("[data-direct-label]"));
  assertInside(svg);
});

Deno.test("shell/design-system#R41: 32px 칸의 9계열 막대는 hover 자리와 tooltip이 SVG 밖으로 나가지 않는다", () => {
  const series = Array.from({ length: 9 }, (_, index) => ({
    key: String(index),
    label: `Entity ${index}`,
    values: [1_000_000 * (index + 1)],
  }));
  using view = sized(
    <BarChart
      {...state}
      categories={["A category label much wider than its entire chart panel"]}
      series={series}
      xLabel="X"
    />,
    32,
  );
  const svg = one(view.container, "svg[data-chart=bar]");
  assertInside(svg);
  press(svg, "ArrowRight");
  assert(one(view.container, "[data-tooltip]"));
  assertInside(svg);
});

// 축 글자의 어림 범위가 모두 0..width 안이다. 격자 선은 남는다.
function assertAxisInside(svg: Element) {
  const width = Number(svg.getAttribute("width"));
  for (const text of svg.querySelectorAll("[data-axis] text")) {
    const x = Number(text.getAttribute("x"));
    const size = textWidth(text.textContent ?? "");
    const anchor = text.getAttribute("text-anchor");
    const start = anchor === "end"
      ? x - size
      : anchor === "middle"
      ? x - size / 2
      : x;
    assert(start >= 0 && start + size <= width, text.textContent!);
  }
  assert(svg.querySelectorAll("[data-axis=value] line").length > 0);
}

Deno.test("shell/design-system#R41: 250px 선 차트의 넓은 글자 이름은 직접 라벨로 두지 않는다", () => {
  using view = sized(
    <LineChart
      {...state}
      x={[new Date(0), new Date(1000)]}
      series={[{ key: "a", label: "WWWWWWWWWW", values: [1, 2] }]}
      xLabel="X"
    />,
    250,
  );
  const svg = one(view.container, "svg[data-chart=line]");
  assert(svg.querySelector("[data-direct-label]") === null);
  assertInside(svg);
  assertAxisInside(svg);
});

Deno.test("shell/design-system#R41: 32px 선 차트는 값·날짜 축 글자를 SVG 밖으로 그리지 않고 격자는 남긴다", () => {
  using view = sized(
    <LineChart
      {...state}
      x={[new Date("2026-09-25T00:00:00Z"), new Date("2026-09-26T00:00:00Z")]}
      series={[{ key: "a", label: "A", values: [1, 2] }]}
      xLabel="X"
    />,
    32,
  );
  const svg = one(view.container, "svg[data-chart=line]");
  assertAxisInside(svg);
  assertInside(svg);
});

Deno.test("shell/design-system#R41: 1e100 극값의 선·막대·산점 축 글자는 넘치지 않고 tooltip은 정확한 값을 읽는다", () => {
  const exact = new Intl.NumberFormat("en").format(2e100);
  using line = sized(
    <LineChart
      {...state}
      x={[new Date(0), new Date(1000)]}
      series={[{ key: "a", label: "A", values: [1e100, 2e100] }]}
      xLabel="X"
    />,
  );
  const lineSvg = one(line.container, "svg[data-chart=line]");
  assertAxisInside(lineSvg);
  press(lineSvg, "ArrowLeft");
  assert(one(line.container, "[data-tooltip]").textContent?.endsWith(exact));
  using bar = sized(
    <BarChart
      {...state}
      categories={["Mon", "Tue"]}
      series={[{ key: "a", label: "A", values: [1e100, 2e100] }]}
      xLabel="X"
    />,
  );
  assertAxisInside(one(bar.container, "svg[data-chart=bar]"));
  using scatter = sized(
    <ScatterChart
      {...state}
      groups={[{
        key: "a",
        label: "A",
        points: [{ x: 1e100, y: 1e100 }, { x: 2e100, y: 2e100 }],
      }]}
      xLabel="X"
      yLabel="Y"
    />,
  );
  const scatterSvg = one(scatter.container, "svg[data-chart=scatter]");
  assertAxisInside(scatterSvg);
  assert(scatterSvg.querySelectorAll("[data-axis=column] line").length > 0);
});

Deno.test("shell/design-system#R41: 640px 보통 차트는 값·날짜 축 글자와 짧은 직접 라벨을 그대로 둔다", () => {
  using view = sized(
    <LineChart
      {...state}
      x={[new Date("2026-09-25T00:00:00Z"), new Date("2026-09-26T00:00:00Z")]}
      series={[{ key: "a", label: "North", values: [1, 200_000] }]}
      xLabel="X"
    />,
  );
  const svg = one(view.container, "svg[data-chart=line]");
  assertAxisInside(svg);
  const value = [...svg.querySelectorAll("[data-axis=value] text")].map((t) =>
    t.textContent
  );
  assert(value.includes("200K"), value.join(","));
  assert(svg.querySelectorAll("[data-axis=category] text").length === 2);
  assert(svg.querySelector("[data-direct-label]")?.textContent === "North");
});
