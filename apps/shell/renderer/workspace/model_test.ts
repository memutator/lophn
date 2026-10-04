import { assertEquals } from "@std/assert";

import {
  applyDrag,
  bodyPaddingX,
  breadcrumbs,
  clampSidebar,
  closeTab,
  infoPanelPlacement,
  moveTab,
  type PaneState,
  ratioFromDrag,
  revealScroll,
  sidebarView,
  splitLayout,
  splitPane,
  type TabItem,
  type WorkspaceView,
} from "./model.ts";

const open = { chosenWidth: 240, collapsedByUser: false };

Deno.test("shell/desktop#R22: sidebar 기본 240px, 접힘 56px, 본문 여백은 1024px 경계에서 바뀐다", () => {
  assertEquals(sidebarView(1280, open, false).width, 240);
  assertEquals(sidebarView(800, open, false), {
    mode: "collapsed",
    width: 56,
    launcherInTopBar: true,
  });
  assertEquals(bodyPaddingX(1280), 32);
  assertEquals(bodyPaddingX(1023), 16);
  assertEquals(bodyPaddingX(1024), 32);
});

Deno.test("shell/design-system#R24: 640px 미만은 sidebar를 숨기고 사람이 고른 폭은 다시 접지 않는다", () => {
  assertEquals(sidebarView(639, open, false).mode, "hidden");
  assertEquals(sidebarView(640, open, false).mode, "collapsed");
  // 사람이 drag로 폭을 고르면 640~1023px에서도 접지 않는다.
  assertEquals(sidebarView(700, { ...open, chosenWidth: 320 }, true), {
    mode: "open",
    width: 320,
    launcherInTopBar: false,
  });
  assertEquals(clampSidebar(120), 200);
  assertEquals(clampSidebar(900), 400);
});

Deno.test("shell/desktop#R26: sidebar가 접히거나 숨으면 런처 복귀가 상단 바로 간다", () => {
  assertEquals(sidebarView(1280, open, false).launcherInTopBar, false);
  assertEquals(
    sidebarView(1280, { ...open, collapsedByUser: true }, true)
      .launcherInTopBar,
    true,
  );
  assertEquals(sidebarView(500, open, false).launcherInTopBar, true);
});

function tab(key: string, pinned = false): TabItem {
  return { key, kind: "document_editor", title: key, pinned };
}

Deno.test("shell/workspace#R2: 넘치는 탭 줄은 줄 안에서 scroll하고 선택 탭을 드러낸다", () => {
  // 120px 탭 20개, 줄 폭 400px.
  assertEquals(revealScroll(2280, 2400, 400, 0, 2400), 2000);
  assertEquals(revealScroll(0, 120, 400, 2000, 2400), 0);
  assertEquals(revealScroll(600, 720, 400, 0, 2400), 320);
  // 이미 보이는 탭이면 scroll을 그대로 둔다.
  assertEquals(revealScroll(240, 360, 400, 100, 2400), 100);
  // 줄이 넘치지 않으면 scroll은 0이다.
  assertEquals(revealScroll(0, 120, 400, 50, 300), 0);
});

function viewOf(panes: PaneState[], ratio = 0.5, focused = 0): WorkspaceView {
  return { panes, splitRatio: ratio, focusedPane: focused };
}

Deno.test("shell/workspace#R3: 탭을 다른 칸으로 옮기면 순서·선택·focus가 따라간다", () => {
  const view = viewOf([
    { tabs: [tab("a"), tab("b")], selected: "b" },
    { tabs: [tab("c")], selected: "c" },
  ]);
  const moved = moveTab(view, "b", 1);
  assertEquals(moved.panes[0]!.tabs.map((item) => item.key), ["a"]);
  assertEquals(moved.panes[0]!.selected, "a");
  assertEquals(moved.panes[1]!.tabs.map((item) => item.key), ["c", "b"]);
  assertEquals(moved.panes[1]!.selected, "b");
  assertEquals(moved.focusedPane, 1);
  // 같은 칸으로의 이동은 바꾸지 않는다.
  assertEquals(moveTab(view, "b", 0), view);
});

Deno.test("shell/workspace#R4: 칸이 480px 아래면 비율과 탭 소속을 보존한 한 칸 보기다", () => {
  const view = viewOf(
    [
      { tabs: [tab("a")], selected: "a" },
      { tabs: [tab("b")], selected: "b" },
    ],
    0.6,
    1,
  );
  const narrow = splitLayout(900, view);
  assertEquals(narrow.visiblePanes, 1);
  assertEquals(narrow.shownPane, 1);
  // 저장된 비율은 그대로다.
  assertEquals(view.splitRatio, 0.6);
  const wide = splitLayout(1200, view);
  assertEquals(wide.visiblePanes, 2);
  assertEquals(wide.leftWidth + wide.rightWidth, 1199);
  // 다시 넓어지면 원래 비율로 돌아온다.
  assertEquals(splitLayout(2000, view).leftWidth, Math.round(1999 * 0.6));
});

Deno.test("shell/editor#R5: 경계 drag는 각 칸 480px를 지키고 두 번 누르면 50:50이다", () => {
  assertEquals(ratioFromDrag(2000, 100), 480 / 1999);
  assertEquals(ratioFromDrag(2000, 1900), (1999 - 480) / 1999);
  const equal = splitLayout(
    2000,
    viewOf(
      [{ tabs: [], selected: null }, { tabs: [], selected: null }],
      0.5,
    ),
  );
  assertEquals(Math.abs(equal.leftWidth - equal.rightWidth) <= 1, true);
});

Deno.test("shell/design-system#R25: 정보 패널은 본문 720px 또는 두 칸과 경계를 남길 때만 dock한다", () => {
  assertEquals(infoPanelPlacement(false, 2000, 1), "hidden");
  assertEquals(infoPanelPlacement(true, 719, 1), "overlay");
  assertEquals(infoPanelPlacement(true, 720, 1), "docked");
  assertEquals(infoPanelPlacement(true, 960, 2), "overlay");
  assertEquals(infoPanelPlacement(true, 480 * 2 + 1 + 720, 2), "docked");
});

Deno.test("shell/workspace#R1: 상단 경로는 focus 칸의 활성 탭을 따른다", () => {
  const view = viewOf(
    [
      { tabs: [tab("notes")], selected: "notes" },
      { tabs: [tab("shell")], selected: "shell" },
    ],
    0.5,
    1,
  );
  assertEquals(breadcrumbs("lophn", view).map((crumb) => crumb.label), [
    "lophn",
    "shell",
  ]);
  assertEquals(
    breadcrumbs("lophn", viewOf([{ tabs: [], selected: null }])).length,
    1,
  );
});

Deno.test("shell/workspace#R3: drag-end의 마지막 DTO만 적용하고 drag-cancel은 되돌린다", () => {
  assertEquals(applyDrag(240, 320, { type: "drag-end", x: 320, y: 0 }), 320);
  assertEquals(applyDrag(240, 320, { type: "drag-cancel" }), 240);
});

Deno.test("shell/workspace#R3: 한 칸에서 옆 칸으로 보내면 칸을 나누고 탭 하나뿐이면 나누지 않는다", () => {
  const one = viewOf([{ tabs: [tab("a"), tab("b")], selected: "b" }]);
  const split = splitPane(one);
  assertEquals(split.panes.map((pane) => pane.tabs.map((item) => item.key)), [
    ["a"],
    ["b"],
  ]);
  assertEquals(split.focusedPane, 1);
  assertEquals(moveTab(one, "a", 1).panes[1]!.selected, "a");
  const lone = viewOf([{ tabs: [tab("a")], selected: "a" }]);
  assertEquals(splitPane(lone), lone);
});

Deno.test("shell/workspace#R3: 한 칸이 비면 남은 칸 하나로 돌아가고 닫은 탭 옆 탭을 고른다", () => {
  const view = viewOf(
    [
      { tabs: [tab("a"), tab("b"), tab("c")], selected: "b" },
      { tabs: [tab("d")], selected: "d" },
    ],
    0.5,
    1,
  );
  const closed = closeTab(view, 0, "b");
  assertEquals(closed.panes[0]!.selected, "c");
  const merged = closeTab(view, 1, "d");
  assertEquals(merged.panes.length, 1);
  assertEquals(merged.focusedPane, 0);
  const moved = moveTab(
    viewOf([{ tabs: [tab("a")], selected: "a" }, {
      tabs: [tab("b")],
      selected: "b",
    }]),
    "a",
    1,
  );
  assertEquals(moved.panes.length, 1);
  assertEquals(moved.panes[0]!.tabs.map((item) => item.key), ["b", "a"]);
});
