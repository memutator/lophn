import { assert, assertEquals } from "@std/assert";
import { layoutGraph, NODE_HEIGHT, shorten } from "./graph-layout.ts";

Deno.test("apps/sdk#R17: node는 edge 방향으로 층을 쌓고 같은 입력은 같은 배치를 낸다", () => {
  const nodes = [
    { id: "save", label: "Save" },
    { id: "load", label: "Load" },
    { id: "check", label: "Check" },
  ];
  const edges = [
    { from: "load", to: "check" },
    { from: "check", to: "save", label: "ok" },
  ];
  const layout = layoutGraph(nodes, edges);
  assertEquals(layout.nodes.map((node) => [node.id, node.layer]), [
    ["save", 2],
    ["load", 0],
    ["check", 1],
  ]);
  assertEquals(layoutGraph(nodes, edges), layout);
  assert(
    layout.nodes.every((node) => Number.isFinite(node.x + node.y + node.width)),
  );
  assertEquals(layout.height, NODE_HEIGHT);
  assert(
    layout.edges.every((edge) =>
      edge.path.startsWith("M") && !edge.path.includes("NaN")
    ),
  );
});

Deno.test("apps/sdk#R17: 순환은 되돌아가는 edge로 끊고 끝나며 그 edge도 그린다", () => {
  const nodes = [{ id: "a", label: "A" }, { id: "b", label: "B" }];
  const layout = layoutGraph(nodes, [{ from: "a", to: "b" }, {
    from: "b",
    to: "a",
  }]);
  assertEquals(layout.nodes.map((node) => node.layer), [0, 1]);
  assertEquals(layout.edges.length, 2);
  assert(layout.edges.every((edge) => !edge.path.includes("NaN")));
});

Deno.test("apps/sdk#R17: 긴 이름은 줄여 보이고 전체 이름은 그대로 남는다", () => {
  const long = "A very long service name that keeps going";
  assertEquals([...shorten(long)].length, 24);
  assert(shorten(long).endsWith("…"));
  assertEquals(shorten("Short"), "Short");
  const [node] = layoutGraph([{ id: "x", label: long }], []).nodes;
  assertEquals(node.label, long);
});
