// 복원 테스트. shell/workspace#R6, R7과 shell/desktop#R24다.
import assert from "node:assert/strict";
import { test } from "node:test";

import { validateLayout } from "./layout.ts";
import { restoreLayout, restoreTab, type RestoreTargets } from "./restore.ts";

const DOC = "doc_01h455vb4pex5v6nkc6gd5fdw1";
const PRJ = "prj_01h455vb4pex5v6nkc6gd5fdw1";

/** 통과하는 가짜 대상. 모든 대상이 살아 있고 읽을 수 있다. */
function liveTargets(): RestoreTargets {
  return {
    documentExists: () => Promise.resolve(true),
    app: () => Promise.resolve(true),
    canRead: () => Promise.resolve(true),
  };
}

test("shell/workspace#R7: terminal은 종료된 자리표시로 복원하고 PTY를 만들지 않는다", async () => {
  const restored = await restoreTab(
    { kind: "terminal", key: "t1", project_folder: "/repo/apps/api" },
    liveTargets(),
  );
  assert.deepEqual(restored, {
    kind: "placeholder",
    key: "t1",
    origin: "terminal",
    title: "/repo/apps/api",
    reason: "app_unavailable",
  });
});

test("shell/workspace#R7: 없는 문서는 이유를 가진 자리표시다", async () => {
  const targets: RestoreTargets = {
    ...liveTargets(),
    documentExists: (doc) => Promise.resolve(doc !== DOC),
  };
  const editor = await restoreTab(
    { kind: "document_editor", key: "t1", document: DOC },
    targets,
  );
  assert.equal(editor?.kind, "placeholder");
  if (editor?.kind === "placeholder") {
    assert.equal(editor.reason, "document_missing");
    assert.equal(editor.title, DOC);
  }
});

test("shell/workspace#R7: 사용할 수 없는 앱은 이유를 가진 자리표시다", async () => {
  const targets: RestoreTargets = {
    ...liveTargets(),
    app: () => Promise.resolve(false),
  };
  const panel = await restoreTab(
    {
      kind: "app_panel",
      key: "t1",
      app: PRJ.replace("prj_", "app_"),
      surface: "board",
    },
    targets,
  );
  assert.equal(panel?.kind, "placeholder");
  if (panel?.kind === "placeholder") {
    assert.equal(panel.reason, "app_unavailable");
  }
});

test("shell/workspace#R7: 권한이 없는 문서는 자리표시다", async () => {
  const targets: RestoreTargets = {
    ...liveTargets(),
    canRead: () => Promise.resolve(false),
  };
  const editor = await restoreTab(
    { kind: "document_editor", key: "t1", document: DOC },
    targets,
  );
  assert.equal(editor?.kind, "placeholder");
  if (editor?.kind === "placeholder") {
    assert.equal(editor.reason, "no_permission");
  }
});

test("shell/workspace#R6: 살아 있는 대상은 그대로 복원한다", async () => {
  const tab = { kind: "document_editor" as const, key: "t1", document: DOC };
  const restored = await restoreTab(tab, liveTargets());
  assert.deepEqual(restored, { kind: "tab", tab });
});

test("shell/workspace#R6: [이어서]는 마지막 공간의 layout으로 탭을 만든다", async () => {
  const layout = validateLayout({
    schema_version: 1,
    project: PRJ,
    window_bounds: { x: 0, y: 0, width: 1280, height: 800 },
    last_space: "project",
    panes: [
      {
        tabs: [
          { kind: "document_editor", key: "t1", document: DOC },
          { kind: "terminal", key: "t2", project_folder: "/repo" },
        ],
        selected_tab: "t1",
      },
    ],
    split_ratio: 0.5,
    focused_pane: 0,
    information_panel: { open: false, tab: "info" },
  });
  assert.ok(layout.ok);
  if (!layout.ok) return;
  const outcome = await restoreLayout(
    layout.layout.panes,
    layout.layout.split_ratio,
    layout.layout.focused_pane,
    liveTargets(),
  );
  assert.equal(outcome.panes.length, 1);
  assert.equal(outcome.panes[0]!.selected_tab, "t1");
  assert.deepEqual(
    outcome.panes[0]!.tabs.filter((restored) => restored.kind === "tab")
      .map((restored) => restored.kind === "tab" ? restored.tab.key : ""),
    ["t1"],
  );
  // terminal은 자리표시로 남는다(R7).
  const terminal = outcome.panes[0]!.tabs.find(
    (restored) => restored.kind === "placeholder",
  );
  assert.ok(terminal);
});

test("shell/workspace#R7: 선택 탭이 자리표시가 되면 살아 있는 탭으로 옮긴다", async () => {
  const ALIVE = "doc_01aryz6s41s4z4k7p41s4z4k7p";
  const layout = validateLayout({
    schema_version: 1,
    project: PRJ,
    window_bounds: { x: 0, y: 0, width: 1280, height: 800 },
    last_space: "project",
    panes: [
      {
        tabs: [
          { kind: "document_editor", key: "gone", document: DOC },
          { kind: "document_editor", key: "alive", document: ALIVE },
        ],
        selected_tab: "gone",
      },
    ],
    split_ratio: 0.5,
    focused_pane: 0,
    information_panel: { open: false, tab: "info" },
  });
  assert.ok(layout.ok);
  if (!layout.ok) return;
  const targets: RestoreTargets = {
    ...liveTargets(),
    documentExists: (doc) => Promise.resolve(doc === ALIVE),
  };
  const outcome = await restoreLayout(
    layout.layout.panes,
    layout.layout.split_ratio,
    layout.layout.focused_pane,
    targets,
  );
  // gone은 자리표시, alive는 살아 있어 선택은 alive다.
  assert.equal(outcome.panes[0]!.selected_tab, "alive");
  assert.equal(outcome.placeholders, 1);
});

test("shell/workspace#R6: focused_pane은 저장된 값을 그대로 유지한다", async () => {
  const outcome = await restoreLayout([], 0.5, 0, liveTargets());
  assert.equal(outcome.focused_pane, 0);
  const panes = [
    { tabs: [], selected_tab: null as string | null },
    { tabs: [], selected_tab: null as string | null },
  ] as never[];
  const two = await restoreLayout(panes, 0.4, 1, liveTargets());
  assert.equal(two.focused_pane, 1);
});
