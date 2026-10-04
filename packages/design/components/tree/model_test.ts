import { assertEquals } from "@std/assert";
import { indentSteps, treeKey, type TreeNode, visibleRows } from "./model.ts";

function chain(depth: number): TreeNode {
  let node: TreeNode = { id: `n${depth}`, label: `Level ${depth}` };
  for (let level = depth - 1; level >= 0; level -= 1) {
    node = { id: `n${level}`, label: `Level ${level}`, children: [node] };
  }
  return node;
}

Deno.test("shell/design-system#R32: 깊이당 한 단계씩 들이고 8단부터 더 들이지 않는다", () => {
  assertEquals([0, 1, 7, 8, 9, 30].map(indentSteps), [0, 1, 7, 8, 8, 8]);
  const expanded = new Set(Array.from({ length: 12 }, (_, i) => `n${i}`));
  const rows = visibleRows([chain(12)], expanded);
  assertEquals(rows.length, 13);
  assertEquals(rows.map((row) => row.indent), [
    0,
    1,
    2,
    3,
    4,
    5,
    6,
    7,
    8,
    8,
    8,
    8,
    8,
  ]);
  assertEquals(rows[12].depth, 12);
});

Deno.test("shell/design-system#R32: 닫힌 가지의 자식은 보이지 않고 방향키는 열기·닫기·부모·형제로 움직인다", () => {
  const nodes: TreeNode[] = [
    {
      id: "docs",
      label: "docs",
      children: [{ id: "a", label: "a.md" }, { id: "b", label: "b.md" }],
    },
    { id: "readme", label: "README.md" },
  ];
  const closed = visibleRows(nodes, new Set());
  assertEquals(closed.map((row) => row.id), ["docs", "readme"]);
  assertEquals(treeKey(closed, "docs", "ArrowRight"), {
    kind: "expand",
    id: "docs",
    open: true,
  });
  const open = visibleRows(nodes, new Set(["docs"]));
  assertEquals(open.map((row) => row.id), ["docs", "a", "b", "readme"]);
  assertEquals(treeKey(open, "docs", "ArrowRight"), { kind: "focus", id: "a" });
  assertEquals(treeKey(open, "b", "ArrowLeft"), { kind: "focus", id: "docs" });
  assertEquals(treeKey(open, "docs", "ArrowLeft"), {
    kind: "expand",
    id: "docs",
    open: false,
  });
  assertEquals(treeKey(open, "b", "ArrowDown"), {
    kind: "focus",
    id: "readme",
  });
  assertEquals(treeKey(open, "readme", "ArrowDown"), { kind: "none" });
  assertEquals(treeKey(open, "a", "End"), { kind: "focus", id: "readme" });
  assertEquals(treeKey(open, "readme", "Home"), { kind: "focus", id: "docs" });
});
