import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { focus, isFocused, manualTimer, one } from "../components/testing.ts";
import { LineChart } from "./line-chart.tsx";
import { sized, state } from "./testing.tsx";

const x = [new Date("2026-09-26T00:00:00Z")];
const series = [{ key: "a", label: "A", values: [1] }];

Deno.test("apps/sdk#R38: 차트 loading은 300ms 뒤에만 skeleton을 보이고 오류는 다시 불러오기 하나다", () => {
  const timer = manualTimer();
  const retried: string[] = [];
  using view = sized(
    <LineChart
      {...state}
      x={x}
      series={series}
      xLabel="Day"
      loading
      timer={timer}
    />,
  );
  assertEquals(view.container.querySelector("[data-skeleton]"), null);
  timer.advance(300);
  assert(view.container.querySelector("[data-skeleton]"));
  view.rerender(
    <LineChart
      {...state}
      x={x}
      series={series}
      xLabel="Day"
      failed="sales"
      onRetry={() => retried.push("retry")}
    />,
  );
  const error = one(view.container, "[data-state=error]");
  assertEquals(error.textContent, "Couldn't load sales.Reload");
  act(() => one(error, "button").click());
  assertEquals(retried, ["retry"]);
});

Deno.test("apps/sdk#R38: 빈 data는 한 문장과 다음 행동 하나를 보인다", () => {
  using view = sized(<LineChart {...state} x={[]} series={[]} xLabel="Day" />);
  const empty = one(view.container, "[data-state=empty]");
  assertEquals(empty.textContent, "No data yet.Retry");
  assertEquals(empty.querySelectorAll("button").length, 1);
});

Deno.test("apps/sdk#R38: 표 보기 중 invalid 입력은 stale 표를 숨기고 같은 frame에서 복구한다", () => {
  using view = sized(
    <LineChart {...state} x={x} series={series} xLabel="Day" />,
  );
  act(() => one(view.container, "button[aria-pressed]").click());
  assert(view.container.querySelector("table"));
  view.rerender(
    <LineChart
      {...state}
      x={x}
      series={[{ key: "a", label: "A", values: [Number.NaN] }]}
      xLabel="Day"
    />,
  );
  assertEquals(view.container.querySelector("table"), null);
  assertEquals(view.container.querySelector("svg[data-chart]"), null);
  assertEquals(view.container.querySelector("button[aria-pressed]"), null);
  assert(
    one(view.container, "[data-state=empty]").textContent?.includes(
      "This chart couldn't be drawn from its data.",
    ),
  );
  view.rerender(
    <LineChart
      {...state}
      x={x}
      series={[{ key: "a", label: "A", values: [2] }]}
      xLabel="Day"
    />,
  );
  assertEquals(
    one(view.container, "tbody tr").textContent,
    "Sep 26, 2026 (Sat)2",
  );
  assertEquals(
    one(view.container, "button[aria-pressed]").textContent,
    "Show chart",
  );
});

Deno.test("shell/design-system#R11: 표 보기 전환 버튼은 보기를 바꿔도 focus를 지킨다", () => {
  using view = sized(
    <LineChart {...state} x={x} series={series} xLabel="Day" />,
  );
  const toggle = one(view.container, "button[aria-pressed]");
  focus(toggle);
  act(() => toggle.click());
  assertEquals(toggle.getAttribute("aria-pressed"), "true");
  assert(isFocused(toggle));
  assert(view.container.querySelector("table"));
});
