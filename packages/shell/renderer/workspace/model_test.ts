import { assertEquals } from "@std/assert";

import {
  allTabs,
  closeFloat,
  closeTab,
  closeTargets,
  dockTab,
  floatTab,
  minimizeFloat,
  moveTab,
  moveTabBy,
  openFloat,
  openTabIn,
  type PaneState,
  raiseFloat,
  reopenTab,
  restoreFloat,
  storableView,
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
  floats: [],
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

Deno.test("float, dock, minimize, restore, raise, close를 이어서 해도 탭이 사라지거나 둘이 되지 않는다", () => {
  const area = { width: 1000, height: 700 };
  const start: WorkspaceView = {
    panes: [
      { tabs: [tab("a"), tab("b"), tab("c")], selected: "a" },
      { tabs: [tab("d"), tab("e")], selected: "d" },
    ],
    splitRatio: 0.5,
    focusedPane: 0,
    floats: [
      {
        tab: tab("f"),
        rect: { x: 0, y: 0, width: 400, height: 300 },
        minimized: false,
        originPane: 0,
      },
      {
        tab: tab("g"),
        rect: { x: 10, y: 10, width: 400, height: 300 },
        minimized: true,
        originPane: 1,
      },
    ],
  };
  const all = ["a", "b", "c", "d", "e", "f", "g"];
  const steps: [string, (v: WorkspaceView) => WorkspaceView, string?][] = [
    ["float a", (v) => floatTab(v, "a", area)],
    ["float d", (v) => floatTab(v, "d", area)],
    ["float e (오른쪽 칸이 빈다)", (v) => floatTab(v, "e", area)],
    ["float f again", (v) => floatTab(v, "f", area)],
    ["minimize a", (v) => minimizeFloat(v, "a")],
    ["restore g", (v) => restoreFloat(v, "g")],
    ["raise a", (v) => raiseFloat(v, "a")],
    [
      "openFloat sized b (이미 있는 key)",
      (v) => openFloat(v, tab("b"), area, { width: 100, height: 100 }),
    ],
    ["openTabIn floated d", (v) => openTabIn(v, tab("d"), () => false)],
    ["reopenTab floated f", (v) => reopenTab(v, tab("f"), 0, 0)],
    ["dock e (칸이 사라져 focus pane)", (v) => dockTab(v, "e")],
    ["dock f", (v) => dockTab(v, "f")],
    ["close g", (v) => closeFloat(v, "g"), "g"],
    ["float b", (v) => floatTab(v, "b", area)],
    ["close d", (v) => closeFloat(v, "d"), "d"],
    ["dock a", (v) => dockTab(v, "a")],
    ["close pane tab c", (v) => {
      const at = v.panes.findIndex((p) => p.tabs.some((t) => t.key === "c"));
      return closeTab(v, at, "c");
    }, "c"],
    ["float unknown", (v) => floatTab(v, "zzz", area)],
  ];
  let view = start;
  const closed = new Set<string>();
  for (const [name, run, close] of steps) {
    view = run(view);
    if (close !== undefined) closed.add(close);
    const keys = allTabs(view).map((t) => t.key);
    assertEquals(
      [...keys].sort(),
      all.filter((k) => !closed.has(k)),
      name,
    );
    assertEquals(new Set(keys).size, keys.length, name);
    for (const pane of view.panes) {
      assertEquals(
        pane.tabs.length === 0 ||
          pane.tabs.some((t) => t.key === pane.selected),
        true,
        name,
      );
    }
  }
});

Deno.test("transient 탭은 저장할 view에 없다", () => {
  const transient = (key: string): TabItem => ({
    ...tab(key),
    transient: true,
  });
  const view: WorkspaceView = {
    panes: [
      { tabs: [tab("a"), transient("t1")], selected: "t1" },
      { tabs: [transient("t2")], selected: "t2" },
    ],
    splitRatio: 0.5,
    focusedPane: 1,
    floats: [
      {
        tab: transient("t3"),
        rect: { x: 0, y: 0, width: 400, height: 300 },
        minimized: false,
        originPane: 0,
      },
      {
        tab: tab("f"),
        rect: { x: 0, y: 0, width: 400, height: 300 },
        minimized: true,
        originPane: 0,
      },
    ],
  };
  const stored = storableView(view);
  assertEquals(allTabs(stored).map((t) => t.key), ["a", "f"]);
  assertEquals(stored.panes.length, 1);
  assertEquals(stored.panes[0]!.selected, "a");
  assertEquals(stored.focusedPane, 0);
  // dock하면 고른 것이니 저장해도 된다.
  const docked = dockTab(view, "t3");
  assertEquals(
    allTabs(storableView(docked)).map((t) => t.key).includes("t3"),
    true,
  );
});
