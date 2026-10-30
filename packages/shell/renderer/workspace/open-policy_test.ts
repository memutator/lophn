import assert from "node:assert/strict";
import { test } from "node:test";

import { evenRow } from "./layout-tree.ts";
import type { TabItem, WorkspaceView } from "./model.ts";
import { type OpenAt, openAt } from "./open-policy.ts";

const tab = (key: string): TabItem => ({
  key,
  kind: "document_editor",
  title: key,
});

const view = (
  panes: readonly (readonly string[])[],
  floats: readonly string[] = [],
  detached: readonly string[] = [],
): WorkspaceView => ({
  panes: panes.map((keys) => ({
    tabs: keys.map(tab),
    selected: keys[0] ?? null,
  })),
  layout: evenRow(panes.length),
  focusedPane: 0,
  floats: floats.map((key) => ({
    tab: tab(key),
    rect: { x: 0, y: 0, width: 100, height: 100 },
    minimized: false,
    originPane: 0,
  })),
  detached: detached.map((key) => ({
    tab: tab(key),
    bounds: { x: 0, y: 0, width: 100, height: 100 },
  })),
});

test("연 탭의 자리에 따라 새 탭이 source를 가리지 않는 자리에 열린다", () => {
  const rows: [string, WorkspaceView, string | undefined, OpenAt][] = [
    // 한쪽에 claude code, 다른 쪽에 문서들: 문서 쪽 끝이다.
    [
      "pane 둘",
      view([["claude"], ["a.md", "b.md"]]),
      "claude",
      { kind: "pane", after: "b.md" },
    ],
    [
      "pane 둘, 반대쪽 끝",
      view([["a.md"], ["claude"]]),
      "claude",
      { kind: "pane", after: "a.md" },
    ],
    [
      "pane 셋, 마지막 칸이면 처음 칸으로 돈다",
      view([["a.md"], ["b.md"], ["claude"]]),
      "claude",
      { kind: "pane", after: "a.md" },
    ],
    [
      "pane 하나",
      view([["a.md", "claude", "b.md"]]),
      "claude",
      { kind: "pane", after: "claude" },
    ],
    [
      "floated source",
      view([["a.md"], ["b.md"]], ["claude"]),
      "claude",
      { kind: "pane" },
    ],
    [
      "detached source",
      view([["a.md"], ["b.md"]], [], ["claude"]),
      "claude",
      { kind: "pane" },
    ],
    [
      "숨은 desk의 source",
      view([["a.md"], ["b.md"]]),
      "elsewhere",
      { kind: "pane", after: "elsewhere" },
    ],
    ["source 없음", view([["a.md"], ["b.md"]]), undefined, { kind: "pane" }],
  ];
  for (const [name, at, source, expected] of rows) {
    assert.deepEqual(openAt(at, source, "show"), expected, name);
  }
});

test("실행 터미널은 source와 상관없이 floated로 열린다", () => {
  assert.deepEqual(openAt(view([["claude"], ["a.md"]]), "claude", "run"), {
    kind: "float",
  });
});
