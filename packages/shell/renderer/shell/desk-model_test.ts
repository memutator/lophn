import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addDesk,
  applyTabDrop,
  closeDetached,
  closeFloat,
  closeTargets,
  closeTab,
  defaultPlaceLayout,
  type Desk,
  deskEntries,
  detachTab,
  dockFloat,
  emptyDesk,
  entryKey,
  findTab,
  floatTab,
  focusLeaf,
  groupOf,
  leavesOf,
  MAIN_DESK,
  minimizeFloat,
  moveTab,
  openTab,
  openTabInLayout,
  type PaneZone,
  type PlaceLayout,
  reattachTab,
  removeDesk,
  restoreFloat,
  selectTab,
  setRatio,
  splitTab,
  stepTab,
  swapTabs,
  type TabDragItem,
  type TabDropHit,
  tabDropState,
  type TabItem,
  ungroup,
  ungroupTab,
  updateDesk,
} from "./desk-model.ts";

const tab = (key: string): TabItem => ({ key, kind: "terminal", title: key });
const RECT = { x: 0, y: 0, width: 400, height: 300 };
const BOUNDS = { x: 1, y: 1, width: 500, height: 400 };

function keysOf(desk: Desk): string[] {
  return [
    ...desk.tabs.map((item) => item.key),
    ...desk.floats.map((item) => item.tab.key),
    ...desk.detached.map((item) => item.tab.key),
  ];
}

function deskOf(...keys: string[]): Desk {
  return keys.reduce(
    (desk, key) => openTab(desk, tab(key)),
    emptyDesk("d", "D"),
  );
}

// 모든 동작 뒤에 지켜야 하는 불변 조건.
function assertValid(desk: Desk, expected: readonly string[]) {
  const keys = keysOf(desk);
  assert.equal(new Set(keys).size, keys.length, "duplicate key");
  assert.deepEqual([...keys].sort(), [...expected].sort(), "lost or added");
  const tabKeys = desk.tabs.map((item) => item.key);
  assert.ok(
    desk.selected === null || tabKeys.includes(desk.selected),
    "selected is not in tabs",
  );
  if (desk.selected === null) assert.equal(desk.tabs.length, 0);
  const used = new Set<string>();
  for (const group of desk.groups) {
    const leaves = leavesOf(group.layout);
    assert.ok(leaves.length >= 2 && leaves.length <= 4, "group size");
    const at = tabKeys.indexOf(leaves[0]!);
    assert.ok(at >= 0, "leaf is not in tabs");
    assert.deepEqual(
      tabKeys.slice(at, at + leaves.length),
      leaves,
      "contiguous",
    );
    for (const leaf of leaves) {
      assert.ok(!used.has(leaf), "tab in two groups");
      used.add(leaf);
    }
    assert.ok(leaves.includes(group.focus), "focus is not a leaf");
    if (desk.selected !== null && leaves.includes(desk.selected)) {
      assert.equal(group.focus, desk.selected, "focus follows selected");
    }
  }
}

test("여는 동작 순서를 섞어도 tab을 잃거나 둘로 만들지 않는다", () => {
  const all = ["a", "b", "c", "d", "e", "f"];
  let desk = deskOf(...all);
  desk = openTab(desk, tab("c")); // 이미 열린 tab
  assertValid(desk, all);
  assert.equal(desk.selected, "c");

  desk = splitTab(desk, "b", "e", "right");
  assertValid(desk, all);
  desk = moveTab(desk, "e", 5); // group 구성원을 옮기면 함께 간다
  assertValid(desk, all);
  desk = moveTab(
    desk,
    "a",
    desk.tabs.findIndex((t) => t.key === "e"),
  ); // group 사이로는 못 든다
  assertValid(desk, all);

  desk = floatTab(desk, "d", RECT);
  desk = floatTab(desk, "b", RECT); // group 구성원을 띄우면 group에서 빠지고 1개가 되어 풀린다
  assert.deepEqual(desk.groups, []);
  assertValid(desk, all);
  desk = openTab(desk, tab("d")); // float은 그 자리에 둔다
  assert.equal(desk.floats.length, 2);
  desk = minimizeFloat(restoreFloat(desk, "d"), "d");
  desk = detachTab(desk, "b", BOUNDS);
  desk = detachTab(desk, "c", BOUNDS);
  assertValid(desk, all);
  desk = reattachTab(desk, "b");
  desk = dockFloat(desk, "d");
  assertValid(desk, all);
  assert.equal(desk.selected, "d");

  desk = closeDetached(closeFloat(closeTab(desk, "a"), "zzz"), "c");
  assertValid(desk, ["b", "d", "e", "f"]);
});

test("splitTab·swapTabs·ungroupTab·float·close를 이어서 해도 tab을 잃거나 둘로 만들지 않고 group은 붙어 있다", () => {
  const all = ["a", "b", "c", "d", "e", "f", "g"];
  let desk = deskOf(...all);

  // 둘 → 셋 → 넷. 다섯째는 들어가지 못한다.
  desk = splitTab(desk, "c", "a", "left");
  assertValid(desk, all);
  assert.deepEqual(leavesOf(desk.groups[0]!.layout), ["a", "c"]);
  assert.deepEqual(desk.tabs.map((t) => t.key).slice(0, 3), ["b", "a", "c"]);
  desk = splitTab(desk, "c", "f", "bottom");
  desk = splitTab(desk, "a", "g", "top");
  assertValid(desk, all);
  assert.equal(leavesOf(desk.groups[0]!.layout).length, 4);
  assert.equal(splitTab(desk, "a", "b", "right"), desk, "max 4");
  // 같은 group 안에서의 옮김은 4개여도 된다.
  const moved = splitTab(desk, "a", "f", "right");
  assertValid(moved, all);
  assert.equal(leavesOf(moved.groups[0]!.layout).length, 4);

  // 다른 group의 leaf를 가져오면 그쪽 group이 줄고, 1개가 되면 풀린다.
  let two = splitTab(deskOf(...all), "a", "b", "right");
  two = splitTab(two, "d", "e", "right");
  assert.equal(two.groups.length, 2);
  two = splitTab(two, "d", "b", "bottom"); // a의 group은 a 하나가 되어 풀린다
  assertValid(two, all);
  assert.deepEqual(
    two.groups.map((g) => leavesOf(g.layout)),
    [["d", "b", "e"]],
  );

  // swap: group 안 / group 사이 / group과 plain tab
  desk = swapTabs(desk, "a", "c");
  assertValid(desk, all);
  let pair = splitTab(deskOf(...all), "a", "b", "right");
  pair = splitTab(pair, "d", "e", "right");
  pair = swapTabs(pair, "b", "e");
  assertValid(pair, all);
  assert.deepEqual(
    pair.groups.map((g) => leavesOf(g.layout)),
    [
      ["a", "e"],
      ["d", "b"],
    ],
  );
  pair = swapTabs(pair, "a", "g"); // plain tab과
  assertValid(pair, all);
  assert.ok(groupOf(pair, "g") !== null && groupOf(pair, "a") === null);

  // 꺼내기: toIndex가 있으면 거기, 없으면 group 바로 뒤. 둘이던 group은 풀린다.
  desk = ungroupTab(desk, "g");
  assertValid(desk, all);
  assert.equal(desk.selected, "g");
  assert.equal(leavesOf(desk.groups[0]!.layout).length, 3);
  desk = ungroupTab(desk, "f", 0);
  assertValid(desk, all);
  assert.equal(desk.tabs[0]!.key, "f");
  assert.equal(desk.groups.length, 1);
  const rest = leavesOf(desk.groups[0]!.layout);
  desk = ungroupTab(desk, rest[0]!);
  assertValid(desk, all);
  assert.deepEqual(desk.groups, []);

  // 구성원을 띄우거나 떼거나 닫으면 group에서 빠진다.
  desk = deskOf(...all);
  desk = splitTab(desk, "a", "b", "right");
  desk = splitTab(desk, "b", "c", "bottom");
  desk = floatTab(desk, "b", RECT);
  assertValid(desk, all);
  assert.deepEqual(
    desk.groups.map((g) => leavesOf(g.layout)),
    [["a", "c"]],
  );
  desk = detachTab(desk, "c", BOUNDS);
  assertValid(desk, all);
  assert.deepEqual(desk.groups, []);
  desk = dockFloat(desk, "b"); // docking은 plain tab으로 끝에
  assert.equal(desk.tabs.at(-1)!.key, "b");
  assert.equal(groupOf(desk, "b"), null);
});

test("group 구성원을 닫으면 짝이 선택되고 1개가 되면 group이 풀린다", () => {
  let desk = deskOf("a", "b", "c", "d");
  desk = splitTab(desk, "a", "b", "right");
  desk = splitTab(desk, "b", "c", "right"); // [a, b, c]
  assert.equal(entryKey(desk), "a");
  desk = selectTab(desk, "b");
  assert.equal(desk.groups[0]!.focus, "b");
  desk = closeTab(desk, "b");
  assertValid(desk, ["a", "c", "d"]);
  assert.equal(desk.selected, "c"); // 이웃 leaf
  assert.equal(desk.groups.length, 1);
  desk = closeTab(desk, "c");
  assert.deepEqual(desk.groups, []);
  assert.equal(desk.selected, "a");
  assertValid(desk, ["a", "d"]);
});

test("desk를 지우면 tab이 Main으로 옮겨지고 Main은 지워지지 않는다", () => {
  let layout: PlaceLayout = defaultPlaceLayout();
  layout = updateDesk(layout, MAIN_DESK, (d) => openTab(d, tab("m1")));
  layout = addDesk(layout, "wf", "wf", "wf");
  layout = updateDesk(layout, "wf", (d) => {
    let next = d;
    for (const key of ["m1", "x", "y", "z", "w"])
      next = openTab(next, tab(key));
    next = splitTab(next, "x", "w", "right");
    next = floatTab(next, "y", RECT);
    return detachTab(next, "z", BOUNDS);
  });
  layout = { ...layout, active: "wf" };
  const removed = removeDesk(layout, "wf");
  assert.deepEqual(Object.keys(removed.desks), [MAIN_DESK]);
  assert.equal(removed.active, MAIN_DESK);
  assertValid(removed.desks[MAIN_DESK]!, ["m1", "x", "y", "z", "w"]);
  assert.equal(removeDesk(removed, MAIN_DESK), removed);
});

test("열려 있는 tab은 그 desk로 찾아간다", () => {
  let layout = addDesk(defaultPlaceLayout(), "wf", "wf", "wf");
  layout = updateDesk(layout, "wf", (d) => openTab(d, tab("s1")));
  assert.deepEqual(findTab(layout, "s1"), { desk: "wf", where: "tab" });
  const opened = openTabInLayout(layout, tab("s1"));
  assert.equal(opened.active, "wf");
  assert.equal(
    findTab(openTabInLayout(layout, tab("s2")), "s2")?.desk,
    MAIN_DESK,
  );
});

test("preview tab은 자리를 바꿔 쓰고 저장 안 된 것은 남기며 group을 깨지 않는다", () => {
  const preview = (key: string): TabItem => ({ ...tab(key), preview: true });
  let desk = deskOf("a", "b");
  desk = openTab(desk, preview("p1"));
  desk = splitTab(desk, "p1", "b", "right");
  desk = openTab(desk, preview("p2"));
  assertValid(desk, ["a", "p2", "b"]);
  assert.deepEqual(leavesOf(desk.groups[0]!.layout), ["p2", "b"]);

  desk = openTab(desk, preview("p3"), { unsaved: (key) => key === "p2" });
  assertValid(desk, ["a", "p2", "b", "p3"]);
  assert.equal(desk.tabs.find((item) => item.key === "p2")?.preview, false);

  // group의 첫 leaf 뒤에 넣어도 group 사이로 들어가지 않는다.
  desk = openTab(desk, tab("n"), { after: "p2", select: false });
  assertValid(desk, ["a", "p2", "b", "p3", "n"]);
  assert.deepEqual(
    desk.tabs.map((t) => t.key),
    ["a", "p2", "b", "n", "p3"],
  );
  assert.equal(desk.selected, "p3");
});

test("tab 메뉴의 여러 개 닫기는 의도한 tab만 닫고 group을 유효하게 둔다", () => {
  let desk = deskOf("a", "b", "c", "d", "e");
  desk = splitTab(desk, "b", "c", "right");
  desk = floatTab(desk, "e", RECT);
  const unsaved = (key: string) => key === "d";
  const all = ["a", "b", "c", "d", "e"];

  const run = (scope: Parameters<typeof closeTargets>[1], key: string) => {
    const targets = closeTargets(desk, scope, key, unsaved);
    let next = desk;
    for (const target of targets) next = closeTab(next, target);
    assertValid(
      next,
      all.filter((item) => !targets.includes(item)),
    );
    return { targets, next };
  };

  // group의 어느 쪽에서 눌러도 짝은 남는다. float은 닫지 않는다.
  assert.deepEqual(run("others", "c").targets, ["a", "d"]);
  assert.deepEqual(run("right", "b").targets, ["d"]);
  assert.deepEqual(run("right", "c").targets, ["d"]);
  assert.deepEqual(run("saved", "a").targets, ["a", "b", "c"]);
  assert.deepEqual(run("all", "a").targets, ["a", "b", "c", "d"]);
  assert.equal(run("others", "b").next.groups.length, 1);
});

test("group의 몫은 범위를 지키고 한 칸으로 다니며 풀면 tab이 그대로 남는다", () => {
  let desk = deskOf("a", "b", "c", "d");
  desk = splitTab(desk, "a", "c", "bottom");
  desk = splitTab(desk, "c", "d", "right"); // column(a, row(c, d))
  assert.deepEqual(
    desk.tabs.map((t) => t.key),
    ["a", "c", "d", "b"],
  );
  desk = setRatio(desk, "d", [], 0.99);
  assert.equal((desk.groups[0]!.layout as { ratio: number }).ratio, 0.85);
  desk = setRatio(desk, "a", ["b"], -3);
  const inner = (desk.groups[0]!.layout as { b: { ratio: number } }).b;
  assert.equal(inner.ratio, 0.15);
  assert.equal(setRatio(desk, "b", [], 0.3), desk); // group이 아닌 tab
  assert.equal(setRatio(desk, "a", ["a"], 0.3), desk); // 나눔이 아닌 node

  // 한 칸: 칸 수와 stepTab·focusLeaf·moveTab
  assert.deepEqual(
    deskEntries(desk).map((e) => [e.key, e.tabs.length]),
    [
      ["a", 3],
      ["b", 1],
    ],
  );
  desk = selectTab(desk, "d");
  assert.equal(entryKey(desk), "a");
  assert.equal(stepTab(desk, 1).selected, "b");
  assert.equal(stepTab(selectTab(desk, "b"), 1).selected, "d"); // group의 focus로 돌아온다
  assert.equal(focusLeaf(desk, 0).selected, "a");
  assert.equal(focusLeaf(desk, 7), desk);
  const moved = moveTab(desk, "d", 3); // group 전체가 b 뒤로
  assertValid(moved, ["a", "b", "c", "d"]);
  assert.deepEqual(
    moved.tabs.map((t) => t.key),
    ["b", "a", "c", "d"],
  );

  desk = ungroup(desk, "c");
  assert.deepEqual(desk.groups, []);
  assertValid(desk, ["a", "b", "c", "d"]);
});

test("끌어 놓기는 어떤 조합에서도 tab을 잃거나 둘로 만들지 않고 가득 찬 group에는 놓이지 않는다", () => {
  const all = ["a", "b", "c", "d", "e", "f", "g", "h"];
  let desk = deskOf(...all);
  desk = splitTab(desk, "a", "b", "right"); // [a b]
  desk = splitTab(desk, "d", "e", "right");
  desk = splitTab(desk, "e", "f", "bottom");
  desk = splitTab(desk, "d", "g", "top"); // [g d e f] 가득
  assertValid(desk, all);
  const zones: PaneZone[] = ["left", "right", "top", "bottom", "center"];
  const hits: TabDropHit[] = [
    ...deskEntries(desk).map(
      (entry) => ({ kind: "strip", before: entry.key }) as const,
    ),
    { kind: "strip", before: null },
    ...all.flatMap((target) =>
      zones.map((zone) => ({ kind: "pane", target, zone }) as const),
    ),
  ];
  for (const key of all) {
    const own = groupOf(desk, key);
    const items: TabDragItem[] = [
      { key, whole: false },
      ...(own === null ? [] : [{ key, whole: true }]),
    ];
    for (const item of items) {
      for (const hit of hits) {
        const state = tabDropState(desk, item, hit);
        const next = applyTabDrop(desk, item, hit);
        assertValid(next, all);
        if (state !== "ok")
          assert.equal(next, desk, `${state} must not change`);
        if (hit.kind === "strip" && !item.whole && own !== null) {
          assert.equal(groupOf(next, key), null, "leaf leaves the group");
        }
      }
    }
  }
  // 가득 찬 group의 가장자리에는 밖의 tab이 못 놓이고, 가운데 swap과 안의 leaf 옮김은 된다.
  assert.equal(
    tabDropState(
      desk,
      { key: "c", whole: false },
      { kind: "pane", target: "d", zone: "right" },
    ),
    "full",
  );
  assert.equal(
    tabDropState(
      desk,
      { key: "c", whole: false },
      { kind: "pane", target: "d", zone: "center" },
    ),
    "ok",
  );
  assert.equal(
    tabDropState(
      desk,
      { key: "g", whole: false },
      { kind: "pane", target: "f", zone: "left" },
    ),
    "ok",
  );
  // 보이는 칸과 자리를 바꾼 group 밖 tab이 보인다.
  const swapped = applyTabDrop(
    selectTab(desk, "c"),
    { key: "h", whole: false },
    { kind: "pane", target: "c", zone: "center" },
  );
  assert.equal(swapped.selected, "h");
});
