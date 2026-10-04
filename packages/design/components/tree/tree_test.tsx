import { assert, assertEquals } from "@std/assert";
import { act, useState } from "react";
import { focus, isFocused, one, press, render, style } from "../testing.ts";
import type { TreeNode } from "./model.ts";
import { Tree } from "./tree.tsx";

function deep(depth: number): TreeNode[] {
  let node: TreeNode = { id: `n${depth}`, label: `level-${depth}.md` };
  for (let level = depth - 1; level >= 0; level -= 1) {
    node = { id: `n${level}`, label: `level-${level}`, children: [node] };
  }
  return [node];
}

const files: TreeNode[] = [
  {
    id: "docs",
    label: "docs",
    children: [{ id: "a", label: "a.md" }, { id: "b", label: "b.md" }],
  },
  { id: "readme", label: "README.md" },
];

function Stateful(
  { onOpen, current }: { onOpen?: (id: string) => void; current?: string },
) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  return (
    <Tree
      nodes={files}
      expanded={expanded}
      onExpandedChange={(id, open) =>
        setExpanded((now) => {
          const next = new Set(now);
          if (open) next.add(id);
          else next.delete(id);
          return next;
        })}
      currentId={current}
      selectedIds={selected}
      onSelectionChange={setSelected}
      onOpen={onOpen}
    />
  );
}

function row(container: HTMLElement, id: string): HTMLElement {
  return one(container, `[data-id="${id}"]`);
}

Deno.test("shell/design-system#R32: 트리 행은 28px이고 깊이당 12px 들이며 8단부터 더 들이지 않는다", () => {
  const expanded = new Set(Array.from({ length: 12 }, (_, i) => `n${i}`));
  using view = render(
    <Tree nodes={deep(12)} expanded={expanded} onExpandedChange={() => {}} />,
  );
  const rows = [...view.container.querySelectorAll("[role=treeitem]")];
  assertEquals(rows.length, 13);
  for (const item of rows) assertEquals(style(item).height, "28px");
  assertEquals(
    rows.map((item) => item.querySelectorAll(":scope > span").length - 2),
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 8, 8, 8, 8],
  );
  // 들임 칸 폭과 행 간격을 함께 더해 실제 들임을 잰다. 간격이 끼면 12px보다 커진다.
  const indentOf = (item: Element) => {
    const computed = style(item);
    const spans = [...item.querySelectorAll(":scope > span")].slice(0, -2);
    const widths = spans.reduce(
      (sum, span) => sum + parseFloat(style(span).width),
      0,
    );
    return widths + parseFloat(computed.columnGap || "0") * spans.length;
  };
  assertEquals(style(rows[0]).columnGap, "0px");
  assertEquals(rows.map(indentOf), [
    0,
    12,
    24,
    36,
    48,
    60,
    72,
    84,
    96,
    96,
    96,
    96,
    96,
  ]);
  const twisty = style(
    rows[0].querySelector(":scope > span:nth-last-child(2)")!,
  );
  assertEquals([twisty.width, twisty.marginRight], ["14px", "4px"]);
  assertEquals(rows[12].getAttribute("aria-level"), "13");
});

Deno.test("shell/design-system#R32: 현재 항목은 왼쪽 2px 표시, 다중 선택은 배경으로 색 없이도 구별한다", () => {
  using view = render(<Stateful current="readme" />);
  const current = row(view.container, "readme");
  assertEquals(current.getAttribute("aria-current"), "page");
  assert(current.hasAttribute("data-current"));
  const marker = style(one(current, ":scope > span"));
  assertEquals(marker.width, "2px");
  assertEquals(marker.position, "absolute");
  assertEquals(marker.backgroundColor, "#1a1a18");
  assertEquals(
    row(view.container, "docs").querySelectorAll(":scope > span").length,
    2,
  );
  act(() => {
    row(view.container, "docs").dispatchEvent(
      new MouseEvent("click", { bubbles: true, ctrlKey: true }),
    );
  });
  act(() => {
    current.dispatchEvent(
      new MouseEvent("click", { bubbles: true, metaKey: true }),
    );
  });
  for (const id of ["docs", "readme"]) {
    const item = row(view.container, id);
    assertEquals(item.getAttribute("aria-selected"), "true");
    assertEquals(style(item).backgroundColor, "#e7f0fb");
  }
  // 다중 선택 click은 가지를 열지 않는다.
  assertEquals(view.container.querySelectorAll("[role=treeitem]").length, 2);
});

Deno.test("shell/design-system#R32: 키보드로 focus를 옮기고 가지를 열고 닫으며 focus는 행 안쪽 2px이다", () => {
  const opened: string[] = [];
  using view = render(<Stateful onOpen={(id) => opened.push(id)} />);
  const docs = row(view.container, "docs");
  assertEquals(docs.tabIndex, 0);
  focus(docs);
  const ring = style(docs);
  assertEquals(ring.outlineWidth, "2px");
  // happy-dom은 calc를 풀지 않는다. 바깥이 아니라 안쪽(음수) offset이면 된다.
  assert(["-2px", "calc(2px * -1)"].includes(ring.outlineOffset));
  press(docs, "ArrowRight");
  assertEquals(docs.getAttribute("aria-expanded"), "true");
  press(docs, "ArrowRight");
  const a = row(view.container, "a");
  assert(isFocused(a));
  assertEquals([a.tabIndex, docs.tabIndex], [0, -1]);
  press(a, "ArrowDown");
  const b = row(view.container, "b");
  assert(isFocused(b));
  press(b, "Enter");
  assertEquals(opened, ["b"]);
  press(b, " ");
  assertEquals(b.getAttribute("aria-selected"), "true");
  press(b, "ArrowLeft");
  assert(isFocused(docs));
  press(docs, "ArrowLeft");
  assertEquals(docs.getAttribute("aria-expanded"), "false");
  assertEquals(view.container.querySelectorAll("[role=treeitem]").length, 2);
});
