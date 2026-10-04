import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { one, style } from "../../design/components/testing.ts";
import { ScatterChart } from "./scatter-chart.tsx";
import { sized, state } from "./testing.tsx";

const group = (key: string, points = [{ x: 1, y: 2 }, { x: 3, y: 5 }]) => ({
  key,
  label: key.toUpperCase(),
  points,
});

Deno.test("shell/design-system#R41: 점은 radius 4px과 표면 ring이고 항목 tooltip에 x·y 값을 보인다", () => {
  using view = sized(
    <ScatterChart
      {...state}
      groups={[group("a"), group("b", [{ x: 2, y: 250_000 }])]}
      xLabel="Visits"
      yLabel="Orders"
    />,
  );
  const points = [
    ...view.container.querySelectorAll(
      "svg[data-chart=scatter] circle[data-slot]",
    ),
  ];
  assertEquals(points.length, 3);
  assert(points.every((point) => point.getAttribute("r") === "4"));
  assertEquals(style(points[0]).getPropertyValue("stroke-width"), "2px");
  act(() => {
    points[2].dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
  assertEquals(
    one(view.container, "[data-tooltip]").textContent,
    "BVisits2Orders250,000",
  );
});

Deno.test("shell/design-system#R12: 산점 domain이 3을 넘으면 그리지 않고 표 보기에 모든 값을 남긴다", () => {
  using view = sized(
    <ScatterChart
      {...state}
      groups={["a", "b", "c", "d"].map((key) => group(key))}
      xLabel="Visits"
      yLabel="Orders"
    />,
  );
  assertEquals(view.container.querySelector("svg[data-chart]"), null);
  const message = one(view.container, "[data-state=empty]");
  assert(
    message.textContent?.includes(
      "This chart can show up to 3 groups at once.",
    ),
  );
  act(() => one(message, "button").click());
  assertEquals(view.container.querySelectorAll("tbody tr").length, 8);
  assertEquals(
    [...view.container.querySelectorAll("th")].map((th) => th.textContent),
    ["Group", "Visits", "Orders"],
  );
});

Deno.test("shell/design-system#R12: 산점은 domain 첫 3 slot에 엔티티를 고정한다", () => {
  using view = sized(
    <ScatterChart
      {...state}
      groups={[group("c")]}
      domain={["a", "b", "c"]}
      xLabel="Visits"
      yLabel="Orders"
    />,
  );
  assertEquals(
    one(view.container, "circle[data-slot]").getAttribute("data-slot"),
    "2",
  );
});

Deno.test("shell/design-system#R13: 점 둘레의 넓은 hover 자리가 tooltip을 열고 이웃 점을 가리지 않는다", () => {
  using view = sized(
    <ScatterChart
      {...state}
      groups={[group("a", [{ x: 1, y: 1 }, { x: 1.001, y: 1 }])]}
      xLabel="Visits"
      yLabel="Orders"
    />,
  );
  const svg = one(view.container, "svg[data-chart=scatter]");
  const hits = [...svg.querySelectorAll("circle[data-hit]")];
  const points = [...svg.querySelectorAll("circle[data-slot]")];
  assertEquals(hits.length, 2);
  assertEquals(hits[0].getAttribute("r"), "8");
  assertEquals(points[0].getAttribute("r"), "4");
  // 모든 hover 자리가 모든 점보다 먼저(아래에) 그려진다.
  assert(
    hits.at(-1)!.compareDocumentPosition(points[0]) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  );
  act(() => {
    hits[1].dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
  assertEquals(
    one(view.container, "[data-tooltip]").textContent,
    "AVisits1.001Orders1",
  );
  act(() => {
    points[0].dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
  });
  assertEquals(
    one(view.container, "[data-tooltip]").textContent,
    "AVisits1Orders1",
  );
});
