import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { one, press, style } from "../testing.ts";
import { sized, state } from "./testing.tsx";
import { LineChart, type LineChartProps } from "./line-chart.tsx";
import type { Series } from "./types.ts";

const x = [
  new Date("2026-09-24T12:00:00Z"),
  new Date("2026-09-25T12:00:00Z"),
  new Date("2026-09-26T12:00:00Z"),
];

const line = (key: string, values: (number | null)[]): Series => ({
  key,
  label: key.toUpperCase(),
  values,
});

function chart(props: Partial<LineChartProps> = {}) {
  return (
    <LineChart
      {...state}
      x={x}
      series={[line("a", [1, 2, 3]), line("b", [120_000, null, 250_000])]}
      xLabel="Day"
      {...props}
    />
  );
}

const slots = (root: HTMLElement) =>
  [...root.querySelectorAll("[data-series]")].map((group) =>
    group.getAttribute("data-slot")
  );

Deno.test("shell/design-system#R13: 선은 2px이고 격자는 subtle 실선, 축은 10만 이상 compact다", () => {
  using view = sized(chart());
  const path = one(view.container, "[data-series] path");
  assertEquals(style(path).getPropertyValue("stroke-width"), "2px");
  assert(path.getAttribute("d")?.startsWith("M"));
  assert(!view.container.innerHTML.includes("NaN"));
  const labels = [...view.container.querySelectorAll("[data-axis=value] text")]
    .map((text) => text.textContent);
  assert(labels.includes("100K"), labels.join(","));
  assertEquals(
    [...view.container.querySelectorAll("[data-axis=category] text")].map((
      text,
    ) => text.textContent),
    ["Sep 24", "Sep 25", "Sep 26"],
  );
});

Deno.test("shell/design-system#R13: 십자선 tooltip은 그 날짜의 모든 계열 값을 읽고 Escape로 닫는다", () => {
  using view = sized(chart());
  const svg = one(view.container, "svg[data-chart=line]");
  press(svg, "ArrowRight");
  press(svg, "ArrowRight");
  press(svg, "ArrowRight");
  const tooltip = one(view.container, "[data-tooltip]");
  assertEquals(
    tooltip.textContent,
    "Sep 26, 2026 (Sat)A3B250,000",
  );
  assert(view.container.querySelector("[data-active] line"));
  press(svg, "Escape");
  assertEquals(view.container.querySelector("[data-tooltip]"), null);
});

Deno.test("shell/design-system#R13: pointer가 움직이면 가장 가까운 날짜에 십자선을 둔다", () => {
  using view = sized(chart());
  const svg = one(view.container, "svg[data-chart=line]");
  act(() => {
    svg.dispatchEvent(
      new PointerEvent("pointermove", { clientX: 5, bubbles: true }),
    );
  });
  assert(
    one(view.container, "[data-tooltip]").textContent?.startsWith(
      "Sep 24, 2026 (Thu)",
    ),
  );
  // null 값은 tooltip 행에서 빠진다.
  press(svg, "ArrowRight");
  assertEquals(
    one(view.container, "[data-tooltip]").textContent,
    "Sep 25, 2026 (Fri)A2",
  );
});

Deno.test("shell/design-system#R12: filter로 앞 계열이 빠져도 뒤 계열을 다시 칠하지 않는다", () => {
  using view = sized(
    chart({
      domain: ["a", "b", "c"],
      series: [line("c", [1, 2, 3]), line("b", [3, 2, 1])],
    }),
  );
  assertEquals(slots(view.container), ["1", "2"]);
});

Deno.test("shell/design-system#R11: 9번째 계열부터 기타 회색 하나로 더하고 slot을 순환하지 않는다", () => {
  const keys = "abcdefghij".split("");
  using view = sized(
    chart({ series: keys.map((key) => line(key, [1, 1, 1])) }),
  );
  assertEquals(slots(view.container), [
    "0",
    "1",
    "2",
    "3",
    "4",
    "5",
    "6",
    "7",
    "other",
  ]);
  const legend = [...view.container.querySelectorAll("li")].map((item) =>
    item.textContent
  );
  assertEquals(legend.at(-1), "Other");
  const svg = one(view.container, "svg");
  press(svg, "ArrowRight");
  assert(one(view.container, "[data-tooltip]").textContent?.endsWith("Other2"));
});

Deno.test("shell/design-system#R11: 직접 라벨은 4계열까지 겹치지 않을 때만, 범례는 2계열부터다", () => {
  using one_ = sized(chart({ series: [line("a", [1, 2, 3])] }));
  assertEquals(one_.container.querySelectorAll("li").length, 0);
  assertEquals(
    one_.container.querySelectorAll("[data-direct-label]").length,
    1,
  );
  using close = sized(
    chart({ series: [line("a", [1, 2, 3]), line("b", [1, 2, 3])] }),
  );
  assertEquals(
    close.container.querySelectorAll("[data-direct-label]").length,
    0,
  );
  assertEquals(close.container.querySelectorAll("li").length, 2);
});

Deno.test("shell/design-system#R11: 낮은 대비 slot도 표 보기로 모든 값을 글로 읽고 다시 차트로 돌아간다", () => {
  using view = sized(
    chart({
      series: [
        line("a", [1, 2, 3]),
        line("b", [4, 5, 6]),
        line("c", [7, null, 9]),
      ],
    }),
  );
  const toggle = [...view.container.querySelectorAll("button")].find((button) =>
    button.textContent === "Show table"
  )!;
  act(() => toggle.click());
  const rows = [...view.container.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")].map((cell) => cell.textContent)
  );
  assertEquals(rows[2], ["Sep 26, 2026 (Sat)", "3", "6", "9"]);
  assertEquals(rows[1][3], "");
  assertEquals(toggle.textContent, "Show chart");
  act(() => toggle.click());
  assert(view.container.querySelector("svg[data-chart=line]"));
});

Deno.test("apps/sdk#R38: 잘못된 값은 그리지 않고 중립 상태와 다시 시도 하나만 보인다", () => {
  const retried: string[] = [];
  using view = sized(
    chart({
      series: [line("a", [1, Number.POSITIVE_INFINITY, 3])],
      onRetry: () => retried.push("retry"),
    }),
  );
  assertEquals(view.container.querySelector("svg[data-chart]"), null);
  assertEquals(view.container.querySelector("table"), null);
  const message = one(view.container, "[data-state=empty]");
  assert(
    message.textContent?.includes(
      "This chart couldn't be drawn from its data.",
    ),
  );
  act(() => one(message, "button").click());
  assertEquals(retried, ["retry"]);
});

Deno.test("shell/design-system#R41: 날짜는 caller의 locale과 시간대를 따른다", () => {
  using view = sized(chart({ locale: "de", timeZone: "Asia/Seoul" }));
  assertEquals(
    one(view.container, "[data-axis=category] text").textContent,
    "24. Sept.",
  );
});
