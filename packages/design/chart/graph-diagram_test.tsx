import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { one } from "../components/testing.ts";
import { GraphDiagram } from "./graph-diagram.tsx";
import { sized, state } from "./testing.tsx";

const nodes = [
  { id: "a", label: "Order placed" },
  { id: "b", label: "Packed" },
  { id: "c", label: "Shipped" },
];

Deno.test("apps/sdk#R17: node·edge 도표는 node 상자와 화살표 edge, edge 이름을 SVG로 그린다", () => {
  using view = sized(
    <GraphDiagram
      {...state}
      nodes={nodes}
      edges={[{ from: "a", to: "b" }, {
        from: "b",
        to: "c",
        label: "same day",
      }]}
    />,
  );
  assertEquals(view.container.querySelectorAll("[data-node] rect").length, 3);
  assertEquals(view.container.querySelectorAll("[data-edge] path").length, 2);
  const marker = one(view.container, "marker").id;
  assert(/^arrow-[A-Za-z0-9_-]+$/.test(marker), marker);
  assertEquals(
    one(view.container, "[data-edge] path").getAttribute("marker-end"),
    `url(#${marker})`,
  );
  assert(view.container.textContent?.includes("same day"));
  act(() => {
    one(view.container, "[data-node='2']").dispatchEvent(
      new PointerEvent("pointerover", { bubbles: true }),
    );
  });
  assertEquals(one(view.container, "[data-tooltip]").textContent, "Shipped");
});

Deno.test("apps/sdk#R38: 없는 node를 가리키는 edge는 그리지 않고 중립 상태로 알린다", () => {
  using view = sized(
    <GraphDiagram
      {...state}
      nodes={nodes}
      edges={[{ from: "a", to: "zzz" }]}
    />,
  );
  assertEquals(view.container.querySelector("svg[data-chart]"), null);
  assert(
    one(view.container, "[data-state=empty]").textContent?.includes(
      "This chart couldn't be drawn from its data.",
    ),
  );
});

Deno.test("apps/sdk#R38: node·edge·계열 이름의 HTML과 script는 글로만 보이고 실행되지 않는다", () => {
  const hostile =
    '<img src=x onerror="globalThis.chartOwned=1"><script>globalThis.chartOwned=2</script>';
  using view = sized(
    <GraphDiagram
      {...state}
      nodes={[{ id: "a", label: hostile }, { id: "b", label: "B" }]}
      edges={[{ from: "a", to: "b", label: hostile }]}
    />,
  );
  assertEquals(view.container.querySelector("img"), null);
  assertEquals(view.container.querySelector("script"), null);
  assert(view.container.textContent?.includes("<img src=x"));
  assertEquals((globalThis as { chartOwned?: number }).chartOwned, undefined);
});
