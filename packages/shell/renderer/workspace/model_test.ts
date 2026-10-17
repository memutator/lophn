import { assertEquals } from "@std/assert";

import {
  closeTargets,
  moveTab,
  moveTabBy,
  openTabIn,
  type PaneState,
  reopenTab,
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

Deno.test("한 칸에서 왼쪽·오른쪽으로 옮겨 나눠도 탭이 사라지거나 늘지 않고 다시 연 탭은 한 번만 생긴다", () => {
  const view = viewOf({ tabs: [tab("a"), tab("b"), tab("c")], selected: "b" });
  const keys = (v: WorkspaceView) =>
    v.panes.map((pane) => pane.tabs.map((item) => item.key));
  assertEquals(keys(moveTabBy(view, "b", 1)), [["a", "c"], ["b"]]);
  assertEquals(keys(moveTabBy(view, "b", -1)), [["b"], ["a", "c"]]);
  assertEquals(moveTabBy(view, "b", -1).focusedPane, 0);
  // 끝 칸에서 더 바깥으로는 옮기지 않는다.
  const right = moveTabBy(view, "b", 1);
  assertEquals(moveTabBy(right, "b", 1), right);

  const reopened = reopenTab(view, tab("x"), 0, 1);
  assertEquals(keys(reopened), [["a", "x", "b", "c"]]);
  assertEquals(reopenTab(reopened, tab("x"), 0, 0), reopened);
});
