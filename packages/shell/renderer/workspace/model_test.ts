import { assertEquals } from "@std/assert";

import {
  activeView,
  allDeskTabs,
  allTabs,
  attachDetached,
  closeDetached,
  closeFloat,
  closeTab,
  closeTargets,
  DEFAULT_DESK,
  deskOfTab,
  detachTab,
  dockTab,
  emptyView,
  findTab,
  floatTab,
  isDetached,
  mergeDeskIntoDefault,
  minimizeFloat,
  moveTab,
  moveTabBy,
  openAcrossDesks,
  openDetachedTab,
  openFloat,
  openTabIn,
  type PaneState,
  raiseFloat,
  reopenTab,
  restoreFloat,
  setActiveView,
  storableView,
  switchDesk,
  type TabItem,
  type WorkspaceDesks,
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
  detached: [],
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

Deno.test("float, dock, minimize, restore, raise, detach, attach, close를 이어서 해도 탭이 사라지거나 둘이 되지 않는다", () => {
  const area = { width: 1000, height: 700 };
  const bounds = { x: 100, y: 80, width: 800, height: 600 };
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
    detached: [{ tab: tab("h"), bounds }],
  };
  const known = new Set(["a", "b", "c", "d", "e", "f", "g", "h"]);
  // no-op이어도 key마다 한 곳 불변은 지켜지므로, 옮기는 step은 key가 어디에 있어야 하는지도 본다.
  type Place = "pane" | "float" | "detached";
  const placeOf = (v: WorkspaceView, key: string): Place | undefined =>
    v.panes.some((pane) => pane.tabs.some((t) => t.key === key))
      ? "pane"
      : v.floats.some((float) => float.tab.key === key)
      ? "float"
      : isDetached(v, key)
      ? "detached"
      : undefined;
  // 셋째는 이 step이 닫는 key, 넷째는 이 step이 새로 여는 key, 다섯째는 step 뒤 key의 자리다.
  const steps: [
    string,
    (v: WorkspaceView) => WorkspaceView,
    string?,
    string?,
    [string, Place]?,
  ][] = [
    ["float a", (v) => floatTab(v, "a", area)],
    ["float d", (v) => floatTab(v, "d", area)],
    ["float e (오른쪽 칸이 빈다)", (v) => floatTab(v, "e", area)],
    ["float f again", (v) => floatTab(v, "f", area)],
    ["minimize a", (v) => minimizeFloat(v, "a")],
    ["restore g", (v) => restoreFloat(v, "g")],
    ["raise a", (v) => raiseFloat(v, "a")],
    [
      "detach pane tab b",
      (v) => detachTab(v, "b", bounds),
      undefined,
      undefined,
      [
        "b",
        "detached",
      ],
    ],
    [
      "detach minimized a",
      (v) => detachTab(v, "a", bounds),
      undefined,
      undefined,
      [
        "a",
        "detached",
      ],
    ],
    [
      "detach floated g",
      (v) => detachTab(v, "g", bounds),
      undefined,
      undefined,
      [
        "g",
        "detached",
      ],
    ],
    ["detach b again", (v) => detachTab(v, "b", bounds)],
    ["detach unknown", (v) => detachTab(v, "zzz", bounds)],
    [
      "openDetachedTab new i",
      (v) => openDetachedTab(v, tab("i"), bounds),
      undefined,
      "i",
      ["i", "detached"],
    ],
    ["openDetachedTab detached b", (v) => openDetachedTab(v, tab("b"), bounds)],
    ["openDetachedTab pane c", (v) => openDetachedTab(v, tab("c"), bounds)],
    [
      "openTabIn detached b",
      (v) => openTabIn(v, tab("b"), () => false, "c"),
      ,
      ,
      ["b", "detached"],
    ],
    [
      "reopenTab detached b",
      (v) => reopenTab(v, tab("b"), 0, 0),
      undefined,
      undefined,
      [
        "b",
        "detached",
      ],
    ],
    [
      "floatTab detached b",
      (v) => floatTab(v, "b", area),
      undefined,
      undefined,
      [
        "b",
        "detached",
      ],
    ],
    [
      "openFloat detached b",
      (v) => openFloat(v, tab("b"), area),
      undefined,
      undefined,
      [
        "b",
        "detached",
      ],
    ],
    ["dock detached b", (v) => dockTab(v, "b"), undefined, undefined, [
      "b",
      "detached",
    ]],
    ["closeFloat detached b", (v) => closeFloat(v, "b")],
    ["attach b", (v) => attachDetached(v, "b"), undefined, undefined, [
      "b",
      "pane",
    ]],
    [
      "attach a (바뀐 탭)",
      (v) => attachDetached(v, "a", { ...tab("a"), title: "A" }),
      undefined,
      undefined,
      ["a", "pane"],
    ],
    ["attach unknown", (v) => attachDetached(v, "zzz")],
    ["close detached h", (v) => closeDetached(v, "h"), "h"],
    ["close detached unknown", (v) => closeDetached(v, "zzz")],
    [
      "openFloat sized b (이미 있는 key)",
      (v) => openFloat(v, tab("b"), area, { width: 100, height: 100 }),
    ],
    ["openTabIn floated d", (v) => openTabIn(v, tab("d"), () => false)],
    ["reopenTab floated d", (v) => reopenTab(v, tab("d"), 0, 0)],
    ["dock e (칸이 사라져 focus pane)", (v) => dockTab(v, "e")],
    ["dock f", (v) => dockTab(v, "f")],
    [
      "detach pane tab f",
      (v) => detachTab(v, "f", bounds),
      undefined,
      undefined,
      [
        "f",
        "detached",
      ],
    ],
    ["close g", (v) => closeDetached(v, "g"), "g"],
    ["float b", (v) => floatTab(v, "b", area)],
    ["close d", (v) => closeFloat(v, "d"), "d"],
    ["dock a", (v) => dockTab(v, "a")],
    ["close pane tab c", (v) => {
      const at = v.panes.findIndex((p) => p.tabs.some((t) => t.key === "c"));
      return closeTab(v, at, "c");
    }, "c"],
    ["close detached i", (v) => closeDetached(v, "i"), "i"],
    ["float unknown", (v) => floatTab(v, "zzz", area)],
  ];
  let view = start;
  for (const [name, run, close, open, at] of steps) {
    view = run(view);
    if (at !== undefined) assertEquals(placeOf(view, at[0]), at[1], name);
    if (name === "attach b") {
      assertEquals(view.panes[view.focusedPane]!.selected, "b", name);
    }
    if (name === "attach a (바뀐 탭)") {
      assertEquals(findTab(view, "a")!.title, "A", name);
    }
    if (close !== undefined) known.delete(close);
    if (open !== undefined) known.add(open);
    const keys = allTabs(view).map((t) => t.key);
    assertEquals([...keys].sort(), [...known].sort(), name);
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
    detached: [
      { tab: transient("t4"), bounds: { x: 0, y: 0, width: 400, height: 300 } },
    ],
  };
  const stored = storableView(view);
  assertEquals(allTabs(stored).map((t) => t.key), ["a", "f"]);
  assertEquals(stored.panes.length, 1);
  assertEquals(stored.panes[0]!.selected, "a");
  assertEquals(stored.focusedPane, 0);
  // dock·attach하면 고른 것이니 저장해도 된다.
  const attached = attachDetached(view, "t4");
  assertEquals(
    allTabs(storableView(attached)).map((t) => t.key).includes("t4"),
    true,
  );
  const docked = dockTab(view, "t3");
  assertEquals(
    allTabs(storableView(docked)).map((t) => t.key).includes("t3"),
    true,
  );
});

Deno.test("자리에서 float, detach하고 자리를 바꾸고 건너 열고 합쳐도 모든 자리의 탭이 사라지거나 둘이 되지 않고 맞는 자리에 있다", () => {
  const area = { width: 1000, height: 700 };
  const bounds = { x: 100, y: 80, width: 800, height: 600 };
  const rect = { x: 5, y: 6, width: 400, height: 300 };
  const float = (key: string, minimized = false) => ({
    tab: tab(key),
    rect,
    minimized,
    originPane: 0,
  });
  const fillers = Array.from({ length: 17 }, (_, i) => float(`x${i}`));
  const view = (
    panes: PaneState[],
    floats: WorkspaceView["floats"] = [],
    detached: WorkspaceView["detached"] = [],
  ): WorkspaceView => ({
    panes,
    splitRatio: 0.5,
    focusedPane: 0,
    floats,
    detached,
  });
  // DEFAULT_DESK는 합칠 때 floats가 19개가 되게 채워 둔다(d1을 floated로 만들면 19).
  const start: WorkspaceDesks = {
    active: DEFAULT_DESK,
    desks: {
      [DEFAULT_DESK]: view(
        [
          { tabs: [tab("d1"), tab("d2")], selected: "d1" },
          { tabs: [tab("d3")], selected: "d3" },
        ],
        [...fillers, float("df")],
        [{ tab: tab("dd"), bounds }],
      ),
      alpha: view(
        [{ tabs: [tab("a1", true), tab("a2")], selected: "a1" }],
        [float("af", true), float("af2", true)],
      ),
      beta: view([{ tabs: [], selected: null }], [], [{
        tab: tab("bd"),
        bounds,
      }]),
    },
  };
  const known = new Set(allDeskTabs(start).map((t) => t.key));
  const placeOf = (d: WorkspaceDesks, key: string) => {
    const at = deskOfTab(d, key);
    if (at === undefined) return undefined;
    const v = d.desks[at]!;
    const place = v.panes.some((p) => p.tabs.some((t) => t.key === key))
      ? "pane"
      : v.floats.some((f) => f.tab.key === key)
      ? "float"
      : "detached";
    return `${at}/${place}`;
  };
  const onActive =
    (fn: (v: WorkspaceView) => WorkspaceView) => (d: WorkspaceDesks) =>
      setActiveView(d, fn(activeView(d)));
  const seed = view(
    [
      { tabs: [tab("a1"), tab("g1"), tab("d3")], selected: "a1" },
    ],
    [float("df")],
    [{ tab: tab("bd"), bounds }],
  );
  // 이름, 함수, 이 step이 새로 여는 key, step 뒤 [key, "자리/위치"]들, step 뒤 active.
  const steps: [
    string,
    (d: WorkspaceDesks) => WorkspaceDesks,
    string?,
    [string, string][]?,
    string?,
  ][] = [
    ["float d1", onActive((v) => floatTab(v, "d1", area)), , [[
      "d1",
      `${DEFAULT_DESK}/float`,
    ]]],
    ["detach d2", onActive((v) => detachTab(v, "d2", bounds)), , [[
      "d2",
      `${DEFAULT_DESK}/detached`,
    ]]],
    [
      "있는 자리로 (seed는 무시)",
      (d) => switchDesk(d, "alpha", seed),
      ,
      [],
      "alpha",
    ],
    [
      "없는 자리로 (다른 자리에 있는 탭은 빠진다)",
      (d) => switchDesk(d, "gamma", seed),
      "g1",
      [["g1", "gamma/pane"], ["a1", "alpha/pane"], [
        "d3",
        `${DEFAULT_DESK}/pane`,
      ], [
        "bd",
        "beta/detached",
      ]],
      "gamma",
    ],
    [
      "다른 자리의 docked 열기",
      (d) => openAcrossDesks(d, tab("a2"), () => false),
      ,
      [["a2", "alpha/pane"]],
      "alpha",
    ],
    [
      "다른 자리의 detached 열기",
      (d) => openAcrossDesks(d, tab("bd"), () => false),
      ,
      [["bd", "beta/detached"]],
      "beta",
    ],
    [
      "다른 자리의 minimized floated 열기",
      (d) => openAcrossDesks(d, tab("af"), () => false),
      ,
      [["af", "alpha/float"]],
      "alpha",
    ],
    [
      "어느 자리에도 없는 탭 열기",
      (d) => openAcrossDesks(d, tab("n1"), () => false),
      "n1",
      [["n1", "alpha/pane"]],
      "alpha",
    ],
    [
      "default의 docked 열기",
      (d) => openAcrossDesks(d, tab("d3"), () => false),
      ,
      [],
      DEFAULT_DESK,
    ],
    [
      "새 탭이 after로 다른 자리의 탭을 가리키면 그 자리에서 그 뒤에 열기",
      (d) => openAcrossDesks(d, tab("n2"), () => false, "a1"),
      "n2",
      [["n2", "alpha/pane"]],
      "alpha",
    ],
    [
      "default로",
      (d) => switchDesk(d, DEFAULT_DESK, emptyView()),
      ,
      [],
      DEFAULT_DESK,
    ],
    [
      "DEFAULT_DESK 합치기는 그대로",
      (d) => mergeDeskIntoDefault(d, DEFAULT_DESK),
      ,
      [],
      DEFAULT_DESK,
    ],
    [
      "없는 자리 합치기는 그대로",
      (d) => mergeDeskIntoDefault(d, "zzz"),
      ,
      [],
      DEFAULT_DESK,
    ],
    [
      "보이지 않는 자리 합치기",
      (d) => mergeDeskIntoDefault(d, "gamma"),
      ,
      [["g1", `${DEFAULT_DESK}/pane`]],
      DEFAULT_DESK,
    ],
    ["alpha로", (d) => switchDesk(d, "alpha", emptyView()), , [], "alpha"],
    [
      "보이는 자리 합치기 (floats 상한을 넘는 탭은 docked)",
      (d) => mergeDeskIntoDefault(d, "alpha"),
      ,
      [
        ["af2", `${DEFAULT_DESK}/float`],
        ["af", `${DEFAULT_DESK}/pane`],
        ["a1", `${DEFAULT_DESK}/pane`],
        ["a2", `${DEFAULT_DESK}/pane`],
        ["n1", `${DEFAULT_DESK}/pane`],
      ],
      DEFAULT_DESK,
    ],
    [
      "detached만 있는 자리 합치기",
      (d) => mergeDeskIntoDefault(d, "beta"),
      ,
      [["bd", `${DEFAULT_DESK}/detached`]],
      DEFAULT_DESK,
    ],
  ];
  let desks = start;
  for (const [name, run, open, at, active] of steps) {
    desks = run(desks);
    for (const [key, place] of at ?? []) {
      assertEquals(placeOf(desks, key), place, name);
    }
    if (active !== undefined) assertEquals(desks.active, active, name);
    assertEquals(Object.hasOwn(desks.desks, desks.active), true, name);
    assertEquals(Object.hasOwn(desks.desks, DEFAULT_DESK), true, name);
    if (open !== undefined) known.add(open);
    const keys = allDeskTabs(desks).map((t) => t.key);
    assertEquals([...keys].sort(), [...known].sort(), name);
    assertEquals(new Set(keys).size, keys.length, name);
    for (const v of Object.values(desks.desks)) {
      for (const pane of v.panes) {
        assertEquals(
          pane.tabs.length === 0 ||
            pane.tabs.some((t) => t.key === pane.selected),
          true,
          name,
        );
      }
    }
    if (name.startsWith("다른 자리의 minimized")) {
      assertEquals(activeView(desks).floats.at(-1)!.tab.key, "af", name);
      assertEquals(activeView(desks).floats.at(-1)!.minimized, false, name);
    }
    if (name.startsWith("새 탭이 after로")) {
      const keys = activeView(desks).panes.flatMap((p) => p.tabs).map((t) =>
        t.key
      );
      assertEquals(keys[keys.indexOf("a1") + 1], "n2", name);
    }
    if (name.startsWith("보이는 자리 합치기")) {
      assertEquals(Object.keys(desks.desks), [DEFAULT_DESK, "beta"], name);
      const merged = desks.desks[DEFAULT_DESK]!;
      const af2 = merged.floats.find((f) => f.tab.key === "af2")!;
      assertEquals([af2.rect, af2.minimized], [rect, true], name);
      assertEquals(
        merged.panes.flatMap((p) => p.tabs).some((t) => t.preview === true),
        false,
        name,
      );
    }
  }
  assertEquals(Object.keys(desks.desks), [DEFAULT_DESK]);
});
