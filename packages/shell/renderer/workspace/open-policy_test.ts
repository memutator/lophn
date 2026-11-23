import assert from "node:assert/strict";
import { test } from "node:test";

import {
  closeTab,
  emptyDesk,
  FLOATS_MAX,
  floatTab,
  groupById,
  isBundle,
  leavesOf,
  membersOf,
  openFloatTab,
  openTab,
  setGroupLabel,
} from "../shell/desk-model.ts";
import { groupLabelFromHint, openAt, openTabWithGroup } from "./open-policy.ts";

const rect = { x: 0, y: 0, width: 300, height: 200 };
const desk = ["agent", "other"].reduce(
  (item, key) => openTab(item, { key, kind: "agent", title: key }),
  emptyDesk("d", "D"),
);

test("agent가 말하지 않은 relation은 target으로 정해지고, source가 float이나 없으면 끝이다", () => {
  const folded = { kind: "float", minimized: true };
  assert.deepEqual(
    openAt(desk, "agent", "show", { relation: null, target: "browser" }),
    folded,
  );
  for (const target of ["session", "tui", "preview", "artifact"] as const) {
    assert.deepEqual(
      openAt(desk, "agent", "show", { relation: null, target }),
      { kind: "tab", after: "agent", relation: "aside" },
    );
  }
  assert.deepEqual(
    openAt(desk, "agent", "show", { relation: "glance", target: "browser" }),
    { kind: "float" },
  );
  assert.deepEqual(
    openAt(desk, undefined, "show", { relation: "peer", target: "session" }),
    { kind: "tab" },
  );
  const floated = floatTab(desk, "agent", rect);
  assert.deepEqual(
    openAt(floated, "agent", "show", { relation: "stage", target: "session" }),
    { kind: "tab" },
  );
});

test("float이 상한이면 agent의 work·glance 탭은 버려지지 않고 desk 끝 탭이다", () => {
  let full = desk;
  for (let index = 0; index < FLOATS_MAX; index++) {
    full = openFloatTab(
      full,
      { key: `f${index}`, kind: "agent", title: "f" },
      rect,
    );
  }
  for (const relation of [null, "glance"] as const) {
    assert.deepEqual(
      openAt(full, "agent", "show", { relation, target: "browser" }),
      { kind: "tab" },
    );
  }
});

test("같은 group 힌트: 1번째는 단독 탭, 2번째에 1-leaf bundle로 묶고 3번째는 분할 없이 합류한다", () => {
  const hints = new Map<string, string>();
  const base = openTab(emptyDesk("wf", "wf", "wf"), {
    key: "workflow:wf",
    kind: "workflow",
    title: "wf",
  });

  // 1st tab stays standalone even if relation/after is passed, without stealing selection
  const d1 = openTabWithGroup(
    base,
    { key: "host:t1", kind: "terminal", title: "worker-1" },
    {
      select: false,
      after: "workflow:wf",
      relation: "aside",
      group: "wfi_1:review",
    },
    hints,
  );
  assert.equal(d1.groups.length, 0);
  assert.equal(d1.selected, "workflow:wf");
  assert.deepEqual(
    d1.tabs.map((item) => item.key),
    ["workflow:wf", "host:t1"],
  );

  // 2nd tab with same group bundles both into a 1-leaf collapsible group with step label
  const d2 = openTabWithGroup(
    d1,
    { key: "host:t2", kind: "terminal", title: "worker-2" },
    { select: false, group: "wfi_1:review" },
    hints,
  );
  assert.equal(d2.selected, "workflow:wf");
  const g2 = groupById(d2, "wfi_1:review");
  assert.ok(g2 !== null);
  assert.equal(isBundle(g2), true);
  assert.equal(g2.label, "review");
  assert.equal(g2.focus, "host:t1");
  assert.deepEqual(leavesOf(g2.layout), ["host:t1"]);
  assert.deepEqual(membersOf(g2.layout), ["host:t1", "host:t2"]);

  // 3rd tab joins existing group without splitting and preserves custom label and selection
  const renamed = setGroupLabel(d2, "host:t1", "Code Review");
  const d3 = openTabWithGroup(
    renamed,
    { key: "host:t3", kind: "terminal", title: "worker-3" },
    { select: false, group: "wfi_1:review" },
    hints,
  );
  assert.equal(d3.selected, "workflow:wf");
  const g3 = groupById(d3, "wfi_1:review");
  assert.ok(g3 !== null);
  assert.equal(isBundle(g3), true);
  assert.equal(g3.label, "Code Review");
  assert.equal(g3.focus, "host:t1");
  assert.deepEqual(leavesOf(g3.layout), ["host:t1"]);
  assert.deepEqual(membersOf(g3.layout), ["host:t1", "host:t2", "host:t3"]);
});

test("다른 group 힌트 탭은 별개로 열리고, bundle이 1개로 풀린 뒤 새 병렬 탭이 오면 다시 묶인다", () => {
  const hints = new Map<string, string>();
  let current = openTab(emptyDesk("wf", "wf", "wf"), {
    key: "workflow:wf",
    kind: "workflow",
    title: "wf",
  });
  current = openTabWithGroup(
    current,
    { key: "host:a1", kind: "terminal", title: "a1" },
    { select: false, group: "wfi_1:build" },
    hints,
  );
  current = openTabWithGroup(
    current,
    { key: "host:b1", kind: "terminal", title: "b1" },
    { select: false, group: "wfi_1:test" },
    hints,
  );
  assert.equal(current.groups.length, 0);

  current = openTabWithGroup(
    current,
    { key: "host:a2", kind: "terminal", title: "a2" },
    { select: false, group: "wfi_1:build" },
    hints,
  );
  assert.equal(current.groups.length, 1);
  assert.equal(groupById(current, "wfi_1:build")?.label, "build");
  assert.equal(groupById(current, "wfi_1:test"), null);

  // Close one tab so bundle dissolves back to lone a2, then open a3 -> re-bundles
  current = closeTab(current, "host:a1");
  assert.equal(current.groups.length, 0);
  current = openTabWithGroup(
    current,
    { key: "host:a3", kind: "terminal", title: "a3" },
    { select: false, group: "wfi_1:build" },
    hints,
  );
  const regrouped = groupById(current, "wfi_1:build");
  assert.ok(regrouped !== null);
  assert.equal(isBundle(regrouped), true);
  assert.deepEqual(membersOf(regrouped.layout), ["host:a2", "host:a3"]);
  assert.equal(groupLabelFromHint("wfi_1:step-name"), "step-name");
  assert.equal(groupLabelFromHint("plain"), "plain");
});
