import assert from "node:assert/strict";
import { test } from "node:test";

import {
  addDesk,
  closeDetached,
  closeFloat,
  closeTargets,
  closeTab,
  defaultPlaceLayout,
  type Desk,
  detachTab,
  dockFloat,
  emptyDesk,
  findTab,
  floatTab,
  MAIN_DESK,
  minimizeFloat,
  moveTab,
  openTab,
  openTabInLayout,
  type PlaceLayout,
  reattachTab,
  removeDesk,
  restoreFloat,
  selectTab,
  splitWith,
  type TabItem,
  unsplit,
  updateDesk,
} from "./desk-model.ts";

const tab = (key: string): TabItem => ({ key, kind: "terminal", title: key });
const RECT = { x: 0, y: 0, width: 400, height: 300 };

function keysOf(desk: Desk): string[] {
  return [
    ...desk.tabs.map((item) => item.key),
    ...desk.floats.map((item) => item.tab.key),
    ...desk.detached.map((item) => item.tab.key),
  ];
}

// 모든 동작 뒤에 지켜야 하는 불변 조건.
function assertValid(desk: Desk, expected: readonly string[]) {
  const keys = keysOf(desk);
  assert.equal(new Set(keys).size, keys.length, "duplicate key");
  assert.deepEqual([...keys].sort(), [...expected].sort(), "lost or added");
  const inTabs = (key: string | null) =>
    key === null || desk.tabs.some((item) => item.key === key);
  assert.ok(inTabs(desk.selected), "selected is not in tabs");
  if (desk.selected === null) assert.equal(desk.tabs.length, 0);
  if (desk.split !== null) {
    const a = desk.tabs.findIndex((item) => item.key === desk.split!.a);
    const b = desk.tabs.findIndex((item) => item.key === desk.split!.b);
    assert.ok(a >= 0 && b === a + 1, "split is not adjacent");
  }
}

test("여는 동작 순서를 섞어도 tab을 잃거나 둘로 만들지 않는다", () => {
  let desk = emptyDesk("d", "D");
  for (const key of ["a", "b", "c", "d", "e", "f"])
    desk = openTab(desk, tab(key));
  desk = openTab(desk, tab("c")); // 이미 열린 tab
  assertValid(desk, ["a", "b", "c", "d", "e", "f"]);
  assert.equal(desk.selected, "c");

  desk = splitWith(desk, "b", "e");
  assertValid(desk, ["a", "b", "c", "d", "e", "f"]);
  desk = moveTab(desk, "e", 5); // split 구성원을 옮기면 짝과 같이 간다
  assertValid(desk, ["a", "b", "c", "d", "e", "f"]);
  desk = moveTab(
    desk,
    "a",
    desk.tabs.findIndex((t) => t.key === "e"),
  ); // split 사이로는 못 든다
  assertValid(desk, ["a", "b", "c", "d", "e", "f"]);

  desk = floatTab(desk, "d", RECT);
  desk = floatTab(desk, "b", RECT); // split 구성원을 띄우면 split이 풀린다
  assert.equal(desk.split, null);
  assertValid(desk, ["a", "b", "c", "d", "e", "f"]);
  desk = openTab(desk, tab("d")); // float은 그 자리에 둔다
  assert.equal(desk.floats.length, 2);
  desk = minimizeFloat(restoreFloat(desk, "d"), "d");
  desk = detachTab(desk, "b", { x: 1, y: 1, width: 500, height: 400 });
  desk = detachTab(desk, "c", { x: 1, y: 1, width: 500, height: 400 });
  assertValid(desk, ["a", "b", "c", "d", "e", "f"]);
  desk = reattachTab(desk, "b");
  desk = dockFloat(desk, "d");
  assertValid(desk, ["a", "b", "c", "d", "e", "f"]);
  assert.equal(desk.selected, "d");

  desk = closeDetached(closeFloat(closeTab(desk, "a"), "zzz"), "c");
  assertValid(desk, ["b", "d", "e", "f"]);
});

test("split 구성원을 닫으면 split이 풀리고 짝이 선택된다", () => {
  let desk = emptyDesk("d", "D");
  for (const key of ["a", "b", "c"]) desk = openTab(desk, tab(key));
  desk = splitWith(desk, "a", "b");
  desk = selectTab(desk, "b");
  assert.equal(desk.split?.focus, "b");
  desk = closeTab(desk, "b");
  assert.equal(desk.split, null);
  assert.equal(desk.selected, "a");
  assertValid(desk, ["a", "c"]);
  desk = splitWith(desk, "a", "c");
  assertValid(unsplit(closeTab(desk, "c")), ["a"]);
});

test("desk를 지우면 tab이 Main으로 옮겨지고 Main은 지워지지 않는다", () => {
  let layout: PlaceLayout = defaultPlaceLayout();
  layout = updateDesk(layout, MAIN_DESK, (d) => openTab(d, tab("m1")));
  layout = addDesk(layout, "wf", "wf", "wf");
  layout = updateDesk(layout, "wf", (d) => {
    let next = d;
    for (const key of ["m1", "x", "y", "z"]) next = openTab(next, tab(key));
    next = floatTab(next, "y", RECT);
    return detachTab(next, "z", { x: 0, y: 0, width: 300, height: 300 });
  });
  layout = { ...layout, active: "wf" };
  const removed = removeDesk(layout, "wf");
  assert.deepEqual(Object.keys(removed.desks), [MAIN_DESK]);
  assert.equal(removed.active, MAIN_DESK);
  assertValid(removed.desks[MAIN_DESK]!, ["m1", "x", "y", "z"]);
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

test("preview tab은 자리를 바꿔 쓰고 저장 안 된 것은 남기며 split을 깨지 않는다", () => {
  const preview = (key: string): TabItem => ({ ...tab(key), preview: true });
  let desk = emptyDesk("d", "D");
  for (const key of ["a", "b"]) desk = openTab(desk, tab(key));
  desk = openTab(desk, preview("p1"));
  desk = splitWith(desk, "p1", "b");
  desk = openTab(desk, preview("p2"));
  assertValid(desk, ["a", "p2", "b"]);
  assert.deepEqual([desk.split?.a, desk.split?.b], ["p2", "b"]);

  desk = openTab(desk, preview("p3"), { unsaved: (key) => key === "p2" });
  assertValid(desk, ["a", "p2", "b", "p3"]);
  assert.equal(desk.tabs.find((item) => item.key === "p2")?.preview, false);

  // split의 a 뒤에 넣어도 짝 사이로 들어가지 않는다.
  desk = openTab(desk, tab("n"), { after: "p2", select: false });
  assertValid(desk, ["a", "p2", "b", "p3", "n"]);
  assert.equal(desk.selected, "p3");
});

test("tab 메뉴의 여러 개 닫기는 의도한 tab만 닫고 split을 유효하게 둔다", () => {
  let desk = emptyDesk("d", "D");
  for (const key of ["a", "b", "c", "d", "e"]) desk = openTab(desk, tab(key));
  desk = splitWith(desk, "b", "c");
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

  // split의 어느 쪽에서 눌러도 짝은 남는다. float은 닫지 않는다.
  assert.deepEqual(run("others", "c").targets, ["a", "d"]);
  assert.deepEqual(run("right", "b").targets, ["d"]);
  assert.deepEqual(run("right", "c").targets, ["d"]);
  assert.deepEqual(run("saved", "a").targets, ["a", "b", "c"]);
  assert.deepEqual(run("all", "a").targets, ["a", "b", "c", "d"]);
  assert.equal(run("others", "b").next.split?.a, "b");
});
