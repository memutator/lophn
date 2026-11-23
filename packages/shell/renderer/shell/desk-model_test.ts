import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addDesk,
  addTabToGroup,
  applyTabDrop,
  closeDetached,
  closeFloat,
  closeTargets,
  closeTab,
  cyclePane,
  defaultWorkspaceLayout,
  type Desk,
  deskEntries,
  detachTab,
  dockFloat,
  emptyDesk,
  entryKey,
  findTab,
  floatTab,
  focusLeaf,
  groupById,
  groupOf,
  groupTabs,
  type GroupNode,
  leavesOf,
  MAIN_DESK,
  membersOf,
  mergeDeskIntoMain,
  minimizeFloat,
  moveTab,
  openTab,
  openTabInLayout,
  paneStackOf,
  type PaneZone,
  type WorkspaceLayout,
  reattachTab,
  removeDesk,
  restoreFloat,
  selectTab,
  setRatio,
  splitTab,
  stackTab,
  stepTab,
  swapTabs,
  toggleGroupCollapsed,
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
    const members = membersOf(group.layout);
    assert.ok(
      (leaves.length >= 2 && leaves.length <= 4) ||
        (leaves.length === 1 && members.length >= 2),
      "group size",
    );
    const at = tabKeys.indexOf(members[0]!);
    assert.ok(at >= 0, "leaf is not in tabs");
    assert.deepEqual(
      tabKeys.slice(at, at + members.length),
      members,
      "contiguous",
    );
    for (const key of members) {
      assert.ok(!used.has(key), "tab in two groups");
      used.add(key);
    }
    assert.ok(
      desk.selected === null ||
        !members.includes(desk.selected) ||
        leaves.includes(desk.selected),
      "selected is hidden in a pane",
    );
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

test("끝낸 desk는 tab을 닫은 뒤 desk만 지우고 Main과 다른 desk는 건드리지 않는다", () => {
  let layout: WorkspaceLayout = defaultWorkspaceLayout();
  layout = updateDesk(layout, MAIN_DESK, (d) => openTab(d, tab("m1")));
  layout = addDesk(layout, "mine", "mine", undefined);
  layout = updateDesk(layout, "mine", (d) => {
    let next = d;
    for (const key of ["x", "y", "z"]) next = openTab(next, tab(key));
    next = floatTab(next, "y", RECT);
    return detachTab(next, "z", BOUNDS);
  });
  layout = { ...layout, active: "mine" };
  // 호출자가 먼저 닫는다.
  layout = updateDesk(layout, "mine", (d) =>
    closeDetached(closeFloat(closeTab(d, "x"), "y"), "z"),
  );
  const removed = removeDesk(layout, "mine");
  assert.deepEqual(Object.keys(removed.desks), [MAIN_DESK]);
  assert.equal(removed.active, MAIN_DESK);
  assertValid(removed.desks[MAIN_DESK]!, ["m1"]);
  assert.equal(removeDesk(removed, MAIN_DESK), removed);
});

test("workflow desk가 사라지면 tab과 group이 Main으로 합쳐지고 겹치는 key는 옮기지 않는다", () => {
  let layout: WorkspaceLayout = defaultWorkspaceLayout();
  layout = updateDesk(layout, MAIN_DESK, (d) => {
    let next = openTab(openTab(d, tab("m1")), tab("m2"));
    next = openTab(next, tab("a"));
    return splitTab(next, "m1", "m2", "right");
  });
  layout = addDesk(layout, "wf", "wf", "wf");
  layout = updateDesk(layout, "wf", (d) => {
    let next = d;
    for (const key of ["x", "y", "z", "w", "u", "v", "m1"])
      next = openTab(next, tab(key));
    next = splitTab(next, "x", "w", "right");
    // m1은 Main에도 있어 옮기지 않는다. 그 leaf가 빠진 group은 1개가 되어 풀린다.
    next = splitTab(next, "u", "m1", "right");
    next = floatTab(next, "y", RECT);
    return detachTab(next, "z", BOUNDS);
  });
  layout = { ...layout, active: "wf" };
  const merged = mergeDeskIntoMain(layout, "wf");
  assert.deepEqual(Object.keys(merged.desks), [MAIN_DESK]);
  assert.equal(merged.active, MAIN_DESK);
  const main = merged.desks[MAIN_DESK]!;
  assertValid(main, ["m1", "m2", "a", "x", "y", "z", "w", "u", "v"]);
  assert.deepEqual(
    main.groups.map((group) => leavesOf(group.layout)),
    [
      ["m1", "m2"],
      ["x", "w"],
    ],
  );
  assert.equal(mergeDeskIntoMain(merged, MAIN_DESK), merged);
});

test("열려 있는 tab은 그 desk로 찾아간다", () => {
  let layout = addDesk(defaultWorkspaceLayout(), "wf", "wf", "wf");
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

test("터미널 옆에 열기는 group을 만들거나 다음 칸에 쌓고, 칸의 tab을 잃거나 둘로 만들지 않는다", () => {
  // group이 없으면 [터미널 | 새 tab]이 된다.
  let desk = deskOf("a", "t", "b");
  desk = openTab(desk, tab("n1"), { after: "t", beside: true });
  assertValid(desk, ["a", "t", "b", "n1"]);
  assert.deepEqual(leavesOf(groupOf(desk, "t")!.layout), ["t", "n1"]);
  assert.equal(desk.selected, "n1");

  // group에 있으면 다음 칸에 쌓여 보이고, 전에 보이던 tab은 그 칸에 숨어 남는다. group은 자라지 않는다.
  desk = openTab(desk, tab("n2"), { after: "t", beside: true });
  desk = openTab(desk, tab("n3"), { after: "t", beside: true });
  const all = ["a", "t", "b", "n1", "n2", "n3"];
  assertValid(desk, all);
  assert.deepEqual(leavesOf(groupOf(desk, "t")!.layout), ["t", "n3"]);
  assert.deepEqual(paneStackOf(desk, "n3"), ["n1", "n2", "n3"]);
  assert.deepEqual(
    deskEntries(desk).map((entry) => entry.key),
    ["a", "t", "b"],
    "hidden tabs are not strip entries",
  );

  // 칸 안에서 돌려 보고, 끝에서 처음으로 돈다. 이미 열린 숨은 tab을 다시 열면 그 칸에 보인다.
  desk = cyclePane(desk, "n3", 1);
  assertValid(desk, all);
  assert.deepEqual(leavesOf(groupOf(desk, "t")!.layout), ["t", "n1"]);
  assert.equal(desk.selected, "n1");
  desk = openTab(desk, tab("n2"), { after: "t", beside: true });
  assertValid(desk, all);
  assert.deepEqual(leavesOf(groupOf(desk, "t")!.layout), ["t", "n2"]);

  // 보이는 tab을 닫으면 칸의 이웃이 보이고, 칸에서 꺼내면 tab 줄의 tab이 된다.
  desk = closeTab(desk, "n2");
  assertValid(desk, ["a", "t", "b", "n1", "n3"]);
  assert.deepEqual(leavesOf(groupOf(desk, "t")!.layout), ["t", "n3"]);
  assert.equal(desk.selected, "n3");
  desk = ungroupTab(desk, "n3");
  assertValid(desk, ["a", "t", "b", "n1", "n3"]);
  assert.deepEqual(leavesOf(groupOf(desk, "t")!.layout), ["t", "n1"]);
  assert.deepEqual(paneStackOf(desk, "n1"), ["n1"]);
  assert.equal(groupOf(desk, "n3"), null);

  // group을 풀면 칸에 숨은 tab도 tab 줄에 나온다.
  desk = openTab(desk, tab("n4"), { after: "t", beside: true });
  desk = ungroup(desk, "t");
  assertValid(desk, ["a", "t", "b", "n1", "n3", "n4"]);
  assert.equal(deskEntries(desk).length, 6);
});

test("고르지 않고 열어도 옆 칸과 group 칸 자리를 지키고 보던 tab을 바꾸지 않는다", () => {
  let desk = deskOf("a", "t", "b");
  desk = openTab(desk, tab("n1"), { after: "t", beside: true, select: false });
  assertValid(desk, ["a", "t", "b", "n1"]);
  assert.deepEqual(leavesOf(groupOf(desk, "t")!.layout), ["t", "n1"]);
  assert.equal(desk.selected, "b");

  // group이 있으면 beside는 다음 칸 stack에 숨어 쌓인다. 선택은 그대로다.
  desk = openTab(desk, tab("n2"), { after: "t", beside: true, select: false });
  assertValid(desk, ["a", "t", "b", "n1", "n2"]);
  assert.equal(leavesOf(groupOf(desk, "t")!.layout).length, 2);
  assert.equal(desk.selected, "b");
});

// agent가 연 탭의 뜻(relation)이 칸으로 풀리는 규칙. 어느 쪽도 보던 tab을 바꾸지 않는다.
const area = (node: GroupNode, key: string, share = 1): number | null => {
  if ("tab" in node) return node.tab === key ? share : null;
  return (
    area(node.a, key, share * node.ratio) ??
    area(node.b, key, share * (1 - node.ratio))
  );
};

test("peer를 계속 열어도 칸은 한 group에 모이고 띠가 생기지 않으며 보던 tab은 그대로다", () => {
  let desk = deskOf("a", "src", "b");
  desk = selectTab(desk, "b");
  const all = ["a", "src", "b"];
  for (const key of ["c1", "c2", "c3"]) {
    desk = openTab(desk, tab(key), {
      after: "src",
      relation: "peer",
      select: false,
    });
    all.push(key);
    assertValid(desk, all);
    assert.equal(desk.selected, "b");
  }
  const group = groupOf(desk, "src")!;
  assert.deepEqual(
    new Set(leavesOf(group.layout)),
    new Set(["src", "c1", "c2", "c3"]),
  );
  for (const key of leavesOf(group.layout)) {
    assert.ok(Math.abs(area(group.layout, key)! - 0.25) < 1e-9, key);
  }

  // 가득 차면 마지막 칸에 숨어 쌓이고 칸의 보이는 tab은 그대로다.
  const before = leavesOf(group.layout);
  desk = openTab(desk, tab("c4"), {
    after: "src",
    relation: "peer",
    select: false,
  });
  assertValid(desk, [...all, "c4"]);
  assert.deepEqual(leavesOf(groupOf(desk, "src")!.layout), before);
  assert.deepEqual(paneStackOf(desk, "c4").at(-1), "c4");
  assert.equal(desk.selected, "b");
});

test("aside는 source의 칸을 나누고 가득 차면 다음 칸에 보이게 쌓되 보던 칸은 가리지 않으며, stage는 group 바깥 뒤에 선다", () => {
  let desk = deskOf("a", "src", "b");
  desk = openTab(desk, tab("n1"), {
    after: "src",
    relation: "aside",
    select: false,
  });
  desk = openTab(desk, tab("n2"), {
    after: "src",
    relation: "aside",
    select: false,
  });
  desk = openTab(desk, tab("n3"), {
    after: "src",
    relation: "aside",
    select: false,
  });
  assertValid(desk, ["a", "src", "b", "n1", "n2", "n3"]);
  assert.equal(leavesOf(groupOf(desk, "src")!.layout).length, 4);
  // source 칸만 거듭 나누지 않아 띠가 되지 않는다.
  assert.ok(area(groupOf(desk, "src")!.layout, "src")! >= 0.25 - 1e-9);
  assert.equal(desk.selected, "b");

  // 가득 찬 group: 사람이 그 group을 보고 있지 않으면 다음 칸에 보인다.
  const next = leavesOf(groupOf(desk, "src")!.layout)[1]!;
  desk = openTab(desk, tab("n4"), {
    after: "src",
    relation: "aside",
    select: false,
  });
  assertValid(desk, ["a", "src", "b", "n1", "n2", "n3", "n4"]);
  assert.equal(leavesOf(groupOf(desk, "src")!.layout)[1], "n4");
  assert.deepEqual(paneStackOf(desk, "n4"), [next, "n4"]);
  assert.equal(desk.selected, "b");

  // 사람이 그 칸을 보고 있으면 숨어 쌓인다.
  desk = selectTab(desk, "n4");
  desk = openTab(desk, tab("n5"), {
    after: "src",
    relation: "aside",
    select: false,
  });
  assert.equal(desk.selected, "n4");
  assert.ok(!leavesOf(groupOf(desk, "src")!.layout).includes("n5"));

  // stage는 group 안이 아니라 group 바로 뒤다.
  desk = openTab(desk, tab("s"), {
    after: "src",
    relation: "stage",
    select: false,
  });
  assert.equal(groupOf(desk, "s"), null);
  const keys = desk.tabs.map((item) => item.key);
  assert.equal(keys.indexOf("s"), keys.length - 2);
  assert.equal(keys.at(-1), "b");
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

test("칸 안의 다른 tab 닫기는 그 칸만, group 닫기는 칸에 숨은 tab까지 닫는다", () => {
  let desk = deskOf("a", "t", "b");
  for (const key of ["n1", "n2", "n3"]) {
    desk = openTab(desk, tab(key), { after: "t", beside: true });
  }
  // [t | n1·n2·n3] 칸에서 숨은 n2를 기준으로 고른다.
  const all = ["a", "t", "b", "n1", "n2", "n3"];
  const close = (scope: Parameters<typeof closeTargets>[1], key: string) => {
    const targets = closeTargets(desk, scope, key, () => false);
    let next = desk;
    for (const target of targets) next = closeTab(next, target);
    assertValid(
      next,
      all.filter((item) => !targets.includes(item)),
    );
    return { targets, next };
  };

  const pane = close("pane-others", "n2");
  assert.deepEqual(pane.targets.toSorted(), ["n1", "n3"]);
  assert.deepEqual(leavesOf(groupOf(pane.next, "t")!.layout), ["t", "n2"]);
  assert.deepEqual(paneStackOf(pane.next, "n2"), ["n2"]);
  assert.deepEqual(close("pane-others", "t").targets, []);

  const group = close("group", "n2");
  assert.deepEqual(group.targets.toSorted(), ["n1", "n2", "n3", "t"]);
  assert.equal(group.next.groups.length, 0);
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
  desk = stackTab(desk, "b", "h"); // b 칸이 [b h]를 돌려 보고 h가 보인다
  assertValid(desk, all);
  assert.deepEqual(paneStackOf(desk, "h"), ["b", "h"]);
  const zones: PaneZone[] = ["left", "right", "top", "bottom", "center"];
  const hits: TabDropHit[] = [
    ...deskEntries(desk).map(
      (entry) => ({ kind: "strip", before: entry.key }) as const,
    ),
    { kind: "strip", before: null },
    ...all.flatMap((target) =>
      zones.map((zone) => ({ kind: "pane", target, zone }) as const),
    ),
    // tab 줄 group 칸 안의 자리: 칸마다 stack의 앞·사이·끝.
    ...desk.groups.flatMap((group) =>
      leavesOf(group.layout).flatMap((target) =>
        [...paneStackOf(desk, target), ""].map(
          (_, index) => ({ kind: "stack", target, index }) as const,
        ),
      ),
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
        if (hit.kind === "stack" && state === "ok") {
          assert.equal(next.selected, key, "dropped tab is shown");
          assert.equal(
            paneStackOf(next, key).indexOf(key),
            hit.index -
              (paneStackOf(desk, hit.target).indexOf(key) >= 0 &&
              paneStackOf(desk, hit.target).indexOf(key) < hit.index
                ? 1
                : 0),
            "dropped where pointed",
          );
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
  // group 칸 가운데에 놓으면 그 칸에 쌓이고, 2칸 group의 짝을 놓아도 leaf 하나짜리 bundle로 남는다.
  const stacked = applyTabDrop(
    desk,
    { key: "c", whole: false },
    { kind: "pane", target: "h", zone: "center" },
  );
  assert.deepEqual(paneStackOf(stacked, "c"), ["b", "h", "c"]);
  assert.equal(stacked.selected, "c");
  const collapsedSplit = applyTabDrop(
    desk,
    { key: "a", whole: false },
    { kind: "pane", target: "h", zone: "center" },
  );
  assert.deepEqual(leavesOf(groupOf(collapsedSplit, "a")!.layout), ["a"]);
  assert.deepEqual(paneStackOf(collapsedSplit, "a"), ["b", "h", "a"]);
  assertValid(collapsedSplit, all);
  // group이 아닌 보이는 칸과 자리를 바꾼 tab이 보인다.
  const swapped = applyTabDrop(
    deskOf("x", "y"),
    { key: "x", whole: false },
    { kind: "pane", target: "y", zone: "center" },
  );
  assert.equal(swapped.selected, "x");
});

test("leaf 하나의 bundle group: 묶기·접기·쌓기·빼기, 하나만 남으면 풀린다", () => {
  let desk = deskOf("a", "b", "c", "d");
  desk = groupTabs(desk, ["b", "c"], { groupId: "wf:1/s1", label: "Step 1" });
  assertValid(desk, ["a", "b", "c", "d"]);
  const bundle = groupById(desk, "wf:1/s1")!;
  assert.equal(bundle.label, "Step 1");
  assert.deepEqual(leavesOf(bundle.layout), ["b"]);
  assert.deepEqual(paneStackOf(desk, "c"), ["b", "c"]);
  assert.deepEqual(
    deskEntries(desk).map((entry) => entry.tabs.map((item) => item.key)),
    [["a"], ["b"], ["d"]],
  );

  // 숨은 tab을 고르면 칸이 그 tab을 보인다. 접힘은 구성원을 바꾸지 않고 저장된 group에 남는다.
  desk = selectTab(desk, "c");
  assert.deepEqual(leavesOf(groupOf(desk, "b")!.layout), ["c"]);
  const collapsed = toggleGroupCollapsed(desk, "b");
  assert.equal(groupOf(collapsed, "c")!.collapsed, true);
  assert.equal(groupOf(collapsed, "c")!.label, "Step 1");
  assert.equal(toggleGroupCollapsed(collapsed, "b", true), collapsed);
  assert.equal(
    groupOf(toggleGroupCollapsed(collapsed, "c"), "b")!.collapsed,
    undefined,
  );

  // 새 tab을 쌓는다. 보던 tab은 그대로이고 새 tab은 숨는다. 다른 group의 tab은 거기서 빠져 온다.
  let more = addTabToGroup(desk, "wf:1/s1", tab("e"));
  assert.deepEqual(paneStackOf(more, "b"), ["b", "c", "e"]);
  assert.equal(more.selected, "c");
  assertValid(more, ["a", "b", "c", "d", "e"]);
  more = splitTab(more, "a", "d", "right");
  more = addTabToGroup(more, "wf:1/s1", tab("d"));
  assert.deepEqual(paneStackOf(more, "d"), ["b", "c", "e", "d"]);
  assert.equal(groupOf(more, "a"), null);
  assertValid(more, ["a", "b", "c", "d", "e"]);

  // group 앞의 plain tab을 넣어도 group이 앞으로 튀지 않고 제자리에 남는다.
  const stayed = addTabToGroup(desk, "wf:1/s1", tab("a"));
  assert.deepEqual(
    stayed.tabs.map((item) => item.key),
    ["c", "b", "a", "d"],
  );
  assertValid(stayed, ["a", "b", "c", "d"]);

  // 쌓은 tab이 2개 밑으로 줄면 group이 풀리고 tab은 tabs에 남는다.
  let rest = more;
  for (const key of ["e", "d"]) rest = ungroupTab(rest, key);
  assert.deepEqual(paneStackOf(rest, "b"), ["b", "c"]);
  rest = closeTab(rest, "c");
  assert.deepEqual(rest.groups, []);
  assertValid(rest, ["a", "b", "d", "e"]);

  // bundle의 칸을 옆으로 나누면 split이 되고 label·groupId와 칸의 stack이 그대로 남는다.
  const split = splitTab(desk, "c", "a", "left");
  const splitGroup = groupOf(split, "a")!;
  assert.deepEqual(leavesOf(splitGroup.layout), ["a", "c"]);
  assert.deepEqual(paneStackOf(split, "c"), ["b", "c"]);
  assert.equal(splitGroup.label, "Step 1");
  assert.equal(splitGroup.groupId, "wf:1/s1");
  assertValid(split, ["a", "b", "c", "d"]);

  // plain tab끼리 stackTab으로 바로 bundle을 만들 수 있다.
  const plainStacked = stackTab(deskOf("x", "y", "z"), "x", "z");
  assert.deepEqual(leavesOf(groupOf(plainStacked, "x")!.layout), ["z"]);
  assert.deepEqual(paneStackOf(plainStacked, "x"), ["x", "z"]);
  assertValid(plainStacked, ["x", "y", "z"]);
});
