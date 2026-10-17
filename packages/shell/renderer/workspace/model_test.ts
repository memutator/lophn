import { assertEquals } from "@std/assert";

import {
  closeTargets,
  moveTab,
  openTabIn,
  type PaneState,
  type TabItem,
  type WorkspaceView,
} from "./model.ts";

const tab = (key: string, preview = false): TabItem => ({
  key,
  kind: "document_editor",
  title: key,
  ...(preview ? { preview } : {}),
});

const viewOf = (pane: PaneState): WorkspaceView => ({
  panes: [pane],
  splitRatio: 0.5,
  focusedPane: 0,
});

Deno.test("저장 안 된 preview 탭은 다음 preview가 바꿔 쓰지 않고 고정 탭으로 남는다", () => {
  const view = viewOf({ tabs: [tab("a"), tab("b", true)], selected: "b" });
  const replaced = openTabIn(view, tab("c", true), () => false);
  assertEquals(replaced.panes[0]!.tabs.map((item) => item.key), ["a", "c"]);

  const kept = openTabIn(view, tab("c", true), (key) => key === "b");
  assertEquals(
    kept.panes[0]!.tabs.map((item) => [item.key, item.preview === true]),
    [["a", false], ["b", false], ["c", true]],
  );
});

Deno.test("Close Saved는 저장 안 된 탭을 대상에서 뺀다", () => {
  const pane = { tabs: [tab("a"), tab("b"), tab("c")], selected: "a" };
  assertEquals(closeTargets(pane, "saved", "a", (key) => key === "b"), [
    "a",
    "c",
  ]);
});

Deno.test("같은 칸에서 순서를 바꿔도 탭이 사라지거나 늘지 않는다", () => {
  const view = viewOf({ tabs: [tab("a"), tab("b"), tab("c")], selected: "a" });
  const moved = moveTab(view, "a", 0, null);
  assertEquals(moved.panes[0]!.tabs.map((item) => item.key), ["b", "c", "a"]);
  const front = moveTab(moved, "a", 0, "b");
  assertEquals(front.panes[0]!.tabs.map((item) => item.key), ["a", "b", "c"]);
});
