import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { workspaceIcons } from "@lophn/design/components";
import { click, render } from "../../../../design/components/testing.ts";

import { TAB_KINDS } from "../../../../protocol/shell/workspace.ts";
import { toStoredLayout, viewFromStored } from "../layout-map.ts";
import type { WorkspaceView } from "../model.ts";
import type { WorkspaceSource } from "../source.ts";
import { TabStrip } from "../tab-strip/tab-strip.tsx";
import { layoutHint } from "../view-hint.ts";
import { Workspace } from "../workspace.tsx";
import type { TabKindDef } from "./kind.ts";
import {
  BUILT_IN_TAB_KINDS,
  registerTabKind,
  tabKindLabel,
  tabKinds,
} from "./registry.ts";

// 가짜 kind 하나. 이 파일 밖의 어떤 공통 코드도 이 kind를 알지 못한다.
let opened = 0;
const fakeBoard: TabKindDef = {
  kind: "fake_board",
  labelKey: "project-workspace.label.kind-app-panel",
  icon: workspaceIcons.appPanel,
  fromStored(stored, { key }) {
    if (typeof stored.board !== "string") return null;
    return {
      key,
      kind: "fake_board",
      title: stored.board,
      fields: { board: stored.board },
    };
  },
  toStored(tab) {
    const board = tab.fields?.board;
    if (typeof board !== "string") return null;
    return { kind: "fake_board", key: tab.key, board };
  },
  hint(tab) {
    return { kind: "fake_board", key: tab.key, board: tab.fields?.board };
  },
  render: (tab) => <p data-fake-body={tab.key}>{String(tab.fields?.board)}</p>,
  launcher: {
    labelKey: "project-workspace.button.open-app-panel",
    available: () => true,
    open: (host) => {
      opened += 1;
      host.openTab({
        key: `fake-${opened}`,
        kind: "fake_board",
        title: "new board",
        fields: { board: "new" },
      });
    },
  },
};

const noop = () => {};

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

Deno.test("shell/workspace#R14 [ctx-I37]: TAB_KINDS의 모든 kind는 renderer registry에 하나씩 있고 registry에 더 있는 kind도 없다", () => {
  const names = tabKinds().map((kind) => kind.kind);
  assertEquals([...names].sort(), [...TAB_KINDS].sort());
  assertEquals(new Set(names).size, names.length);
  assertEquals(
    BUILT_IN_TAB_KINDS.map((kind) => kind.kind).sort(),
    [...TAB_KINDS].sort(),
  );
  // 옛 document_viewer는 등록하지 않는다.
  assertEquals(
    tabKinds().some((kind) => kind.kind === "document_viewer"),
    false,
  );
  // 같은 이름을 두 번 올리면 거절한다.
  try {
    registerTabKind(BUILT_IN_TAB_KINDS[0]);
    throw new Error("registered twice");
  } catch (error) {
    assert((error as Error).message.includes("already registered"));
  }
});

Deno.test("shell/workspace#R14 [ctx-I37]: 등록한 가짜 kind는 공통 코드를 건드리지 않고 탭 줄·layout map·view hint에 쓰인다", () => {
  const unregister = registerTabKind(fakeBoard);
  try {
    const stored = {
      panes: [{
        tabs: [
          { kind: "fake_board", key: "f1", board: "main" },
          // 옛 document_viewer는 등록되지 않은 kind라 건너뛰고 나머지 순서와 선택을 지킨다.
          {
            kind: "document_viewer",
            key: "old",
            document: "doc_01h455vb4pex5v6nkc6gd5fdw1",
            version: "ver_01h455vb4pex5v6nkc6gd5fdw1",
          },
          { kind: "fake_board", key: "f2", board: "second" },
        ],
        selected_tab: "f2",
      }],
      split_ratio: 0.5,
      focused_pane: 0,
    };
    const restored = viewFromStored(stored).view!;
    assertEquals(restored.panes[0]!.tabs.map((tab) => tab.key), ["f1", "f2"]);
    assertEquals(restored.panes[0]!.selected, "f2");

    // 저장은 kind의 toStored를 거친다.
    const view: WorkspaceView = restored;
    const out = toStoredLayout({
      project: "prj_1",
      view,
      informationPanel: { open: false, tab: "info" },
      lastSpace: "project",
    });
    assertEquals(out.panes[0]!.tabs, [
      { kind: "fake_board", key: "f1", board: "main" },
      { kind: "fake_board", key: "f2", board: "second" },
    ]);

    // 현재 보기 힌트는 kind의 hint를 거친다.
    const hint = layoutHint({ project: "prj_1", view, presentation: {} });
    assertEquals(hint.panes[0]!.tabs, [
      { kind: "fake_board", key: "f1", board: "main" },
      { kind: "fake_board", key: "f2", board: "second" },
    ]);
    assertEquals(hint.app_tab, null);

    // 탭 줄은 kind의 글자와 아이콘을 그린다.
    assertEquals(tabKindLabel("fake_board"), "App panel");
    using strip = render(
      <TabStrip
        tabs={restored.panes[0]!.tabs}
        selected="f1"
        focused
        onSelect={noop}
        onClose={noop}
      />,
    );
    assertEquals(
      [...strip.container.querySelectorAll("[data-kind-label]")].map((node) =>
        node.textContent
      ),
      ["App panel", "App panel"],
    );
    assert(strip.container.querySelector("[data-tab='f1'] svg"));
  } finally {
    unregister();
  }
  // 내리면 모르는 kind다. 탭이 자리표시 없이 빠진다.
  assertEquals(
    viewFromStored({
      panes: [{
        tabs: [{ kind: "fake_board", key: "f1", board: "main" }],
        selected_tab: "f1",
      }],
    }).view!.panes[0]!.tabs,
    [],
  );
});

Deno.test("shell/workspace#R14 [ctx-I37]: 작업대는 가짜 kind의 본문을 그리고 열기 단추가 그 kind의 열기 함수를 부른다", async () => {
  const unregister = registerTabKind(fakeBoard);
  try {
    const saved: unknown[] = [];
    const source: WorkspaceSource = {
      project: () =>
        Promise.resolve({
          ok: true,
          value: { id: "prj_1", title: "lophn", folders: [] },
        }),
      documents: () => Promise.resolve({ ok: true, value: [] }),
      files: () => Promise.resolve({ ok: true, value: [] }),
      readLayout: () =>
        Promise.resolve({
          ok: true,
          available: true,
          layout: {
            panes: [{
              tabs: [{ kind: "fake_board", key: "f1", board: "main" }],
              selected_tab: "f1",
            }],
            split_ratio: 0.5,
            focused_pane: 0,
            information_panel: { open: false, tab: "info" },
          },
        }),
      saveLayout: (value) => {
        saved.push(value);
        return Promise.resolve({ ok: true });
      },
    };
    using view = render(
      <Workspace
        projectId="prj_1"
        source={source}
        windowWidth={1600}
        bodyWidth={1200}
        onLauncher={noop}
        onLophn={noop}
      />,
    );
    await flush();
    assertEquals(
      view.container.querySelector("[data-fake-body='f1']")?.textContent,
      "main",
    );
    // 열기 단추는 launcher를 선언한 kind마다 하나씩 `data-open-<kind>` 표시와 함께 놓인다.
    const button = view.container.querySelector("[data-open-fake-board]");
    assert(button);
    click(button as HTMLElement);
    await flush();
    assertEquals(
      [...view.container.querySelectorAll("[data-tab]")].map((node) =>
        node.getAttribute("data-tab")
      ),
      ["f1", "fake-1"],
    );
    const last = saved.at(-1) as { panes: { tabs: unknown[] }[] };
    assertEquals(last.panes[0]!.tabs[1], {
      kind: "fake_board",
      key: "fake-1",
      board: "new",
    });
  } finally {
    unregister();
  }
});
