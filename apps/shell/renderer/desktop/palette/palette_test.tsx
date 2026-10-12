import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  manualTimer,
  render,
} from "../../../../../packages/design/components/testing.ts";

import type {
  OverlayApi,
  OverlayEvent,
  OverlayModel,
  OverlayOpen,
  OverlayUpdate,
} from "../../../ipc/overlay.ts";
import type { ShortcutApi, WindowShortcut } from "../../../ipc/shortcuts.ts";
import type { CoreSource } from "../connection/connection.ts";
import { Desktop } from "../main.tsx";
import { openLophn, openProject } from "../router.ts";
import { fakeSource } from "../lophn-space/testdata/fake-source.ts";
import { find, flush } from "../lophn-space/testdata/dom.ts";
import type { WorkspaceSource } from "../../workspace/source.ts";
import { shortcutLabel } from "./labels.ts";
import {
  arrange,
  LOPHN_GROUPS,
  paletteModel,
  WORKSPACE_GROUPS,
} from "./model.ts";
import { documentSearch } from "./search.ts";
import { appRow, fakeApps } from "../lophn-space/apps/testdata/fake-apps.ts";

const core: CoreSource = {
  subscribe(listener) {
    listener({ state: "ready", confirmedAt: 1 });
    return () => {};
  },
  call: () => Promise.resolve({ ok: true, value: {} }),
};

// 창 overlay와 main shortcut의 가짜. 연 표면·바꾼 행·닫기만 남기고 결과는 테스트가 보낸다.
function fakeWindow() {
  const opened: OverlayOpen[] = [];
  const updates: OverlayUpdate[] = [];
  const closed: string[] = [];
  const overlayListeners = new Set<(event: OverlayEvent) => void>();
  const shortcutListeners = new Set<(shortcut: WindowShortcut) => void>();
  let serial = 0;
  const overlay: OverlayApi = {
    open: (input) => {
      opened.push(input);
      return Promise.resolve({
        ok: true,
        value: { surfaceId: `surface_${++serial}`, generation: 1 },
      });
    },
    close: (input) => {
      closed.push(input.surfaceId);
      return Promise.resolve({ ok: true, value: null });
    },
    update: (input) => {
      updates.push(input);
      return Promise.resolve({ ok: true, value: null });
    },
    result: () => Promise.resolve({ ok: true, value: null }),
    subscribe: (listener) => {
      overlayListeners.add(listener);
      return () => overlayListeners.delete(listener);
    },
  };
  const shortcuts: ShortcutApi = {
    subscribe: (listener) => {
      shortcutListeners.add(listener);
      return () => shortcutListeners.delete(listener);
    },
  };
  const timer = manualTimer();
  async function press(shortcut: WindowShortcut) {
    act(() => {
      for (const listener of shortcutListeners) listener(shortcut);
    });
    await flush();
  }
  function current() {
    const open = opened.at(-1)!;
    return {
      requestId: open.requestId,
      surfaceId: `surface_${serial}`,
      generation: 1,
    };
  }
  async function emit(event: OverlayEvent) {
    act(() => {
      for (const listener of overlayListeners) listener(event);
    });
    await flush();
  }
  /** 지금 행 모양. 마지막으로 바꾼 행이 있으면 그것이다. */
  function model(): OverlayModel {
    const surfaceId = `surface_${serial}`;
    const updated = updates.filter((update) => update.surfaceId === surfaceId);
    return updated.at(-1)?.model ?? opened.at(-1)!.model;
  }
  async function type(text: string) {
    await emit({ ...current(), type: "query", text });
    timer.advance(150);
    await flush();
  }
  async function choose(label: string) {
    const choice = model().choices.find((item) => item.label === label);
    assert(choice, `no palette row ${label}`);
    await emit({ ...current(), type: "selected", choiceId: choice.id });
  }
  return {
    deps: { overlay, shortcuts, timer, platform: "linux" as const },
    opened,
    updates,
    closed,
    press,
    type,
    choose,
    model,
    emit,
    current,
  };
}

function groups(model: OverlayModel): string[] {
  return [...new Set(model.choices.map((choice) => choice.group))] as string[];
}

const workspaceSource: WorkspaceSource = {
  project: () =>
    Promise.resolve({
      ok: true,
      value: { id: "prj_1", title: "lophn", folders: [{ path: "/work" }] },
    }),
  documents: () =>
    Promise.resolve({
      ok: true,
      value: [{ id: "doc_1", title: "notes" }, { id: "doc_2", title: "plan" }],
    }),
  contexts: () =>
    Promise.resolve({ ok: true, value: [{ id: "ctx_1", title: "design" }] }),
  files: () =>
    Promise.resolve({
      ok: true,
      value: [{ path: "docs/plan.md", document: "doc_2", title: "plan" }],
    }),
  readLayout: () =>
    Promise.resolve({
      ok: true,
      available: true,
      layout: {
        panes: [
          {
            tabs: [{ key: "doc_1", kind: "document_viewer", title: "notes" }],
            selected_tab: "doc_1",
          },
          {
            tabs: [{ key: "term_1", kind: "terminal", title: "shell" }],
            selected_tab: "term_1",
          },
        ],
        split_ratio: 0.5,
        focused_pane: 0,
        information_panel: { open: false, tab: "info" },
      },
    }),
  saveLayout: () => Promise.resolve({ ok: true }),
};

Deno.test("shell/desktop#R30: 작업대 팔레트는 열린 탭·문서·파일·컨텍스트·행동 순서로 묶어 overlay palette로 연다", async () => {
  const win = fakeWindow();
  using view = render(
    <Desktop
      source={core}
      initial={openProject("prj_1")}
      workspace={workspaceSource}
      windowWidth={1600}
      palette={win.deps}
    />,
  );
  await flush();
  await win.press("palette");
  assertEquals(win.opened.length, 1);
  const open = win.opened[0]!;
  assertEquals(open.kind, "palette");
  assertEquals(open.model.search, true);
  assertEquals(open.model.label, "Search this project");
  assertEquals(groups(open.model), [
    "Open tabs",
    "Documents",
    "Files",
    "Contexts",
    "Actions",
  ]);
  const rows = open.model.choices.map((choice) => [choice.label, choice.icon]);
  assertEquals(rows.slice(0, 6), [
    ["notes", "tab"],
    ["shell", "terminal"],
    ["notes", "document"],
    ["plan", "document"],
    ["plan.md", "file"],
    ["design", "context"],
  ]);
  const launcher = open.model.choices.find((choice) =>
    choice.label === "Back to launcher"
  );
  assertEquals(launcher?.hint, "Ctrl+Shift+L");
  // 팔레트는 overlay view에 그린다. shell 창 DOM에는 dialog가 생기지 않는다.
  assertEquals(view.container.querySelectorAll("[role=dialog]").length, 0);
});

Deno.test("shell/desktop#R30: 작업대 팔레트의 결과는 작업대 안의 탭·문서 탭·정보 패널로만 간다", async () => {
  const win = fakeWindow();
  using view = render(
    <Desktop
      source={core}
      initial={openProject("prj_1")}
      workspace={workspaceSource}
      windowWidth={1600}
      palette={win.deps}
    />,
  );
  await flush();
  await win.press("palette");
  await win.choose("shell");
  assertEquals(
    find(view.container, "[data-pane='1']").getAttribute("data-focused"),
    "true",
  );
  await win.press("palette");
  await win.type("plan");
  const filtered = win.model();
  assertEquals(filtered.choices.map((choice) => choice.label), [
    "plan",
    "plan.md",
  ]);
  await win.choose("plan.md");
  const tabs = [...view.container.querySelectorAll("[role=tab]")].map((tab) =>
    tab.textContent
  );
  assert(tabs.some((text) => text?.includes("plan")), `tabs: ${tabs}`);
  await win.press("palette");
  await win.choose("design");
  assertEquals(
    find(view.container, "[data-info-tab='contexts']").getAttribute(
      "aria-selected",
    ),
    "true",
  );
});

Deno.test("shell/desktop#R30: lophn 공간 팔레트는 프로젝트·컨텍스트·문서·앱·행동 순서이고 문서는 검색으로 찾는다", async () => {
  const win = fakeWindow();
  const { source, of } = fakeSource({
    search: () => ({
      ok: true,
      value: {
        hits: [
          {
            document: "doc_9",
            version: "ver_3",
            latestVersion: "ver_3",
            section: "goals",
            title: "Release notes",
            snippet: "ship   the\nrelease",
            format: "document",
            fromSummary: false,
          },
          {
            document: "doc_9",
            version: "ver_3",
            latestVersion: "ver_3",
            section: "plan",
            title: "Release notes",
            snippet: "second section",
            format: "document",
            fromSummary: false,
          },
        ],
        coverage: { lagging: false, rebuilding: false, omissions: 0 },
        nextCursor: null,
      },
    }),
  });
  using view = render(
    <Desktop
      source={core}
      initial={openLophn()}
      lophn={source}
      palette={{ ...win.deps, search: documentSearch(source) }}
    />,
  );
  await flush();
  await win.press("palette");
  const first = win.opened[0]!.model;
  assertEquals(first.label, "Search lophn");
  // 검색어 전에는 문서 행이 없다. 문서는 documents 검색이 찾는다.
  assertEquals(groups(first), ["Projects", "Contexts", "Apps", "Actions"]);
  await win.type("rel");
  const searched = win.model();
  assertEquals(groups(searched), ["Contexts", "Documents"]);
  const documents = searched.choices.filter((choice) =>
    choice.group === "Documents"
  );
  assertEquals(documents.map((row) => [row.label, row.detail]), [
    ["Release notes", "ship the release"],
  ]);
  const search = of("search").at(-1)!.args[0] as { query: string };
  assertEquals(search.query, "rel");
  await win.choose("Release notes");
  assertEquals(
    find(view.container, "[data-space='lophn']").getAttribute(
      "data-current-screen",
    ),
    "documents",
  );
  assert(view.container.querySelector("[data-reader='doc_9']"));
});

Deno.test("shell/desktop#R30: lophn 공간 팔레트의 컨텍스트·앱·행동은 지금 형제 화면으로 가고 거처·분류 전·시리즈 목적지가 없다", async () => {
  const win = fakeWindow();
  const { source } = fakeSource();
  using view = render(
    <Desktop
      source={core}
      initial={openLophn()}
      lophn={source}
      palette={win.deps}
    />,
  );
  await flush();
  await win.press("palette");
  const labels = win.model().choices.map((choice) => choice.label);
  for (const gone of ["Unsorted", "Inbox", "Home", "Series"]) {
    assert(!labels.some((label) => label.includes(gone)), gone);
  }
  const space = () =>
    find(view.container, "[data-space='lophn']").getAttribute(
      "data-current-screen",
    );
  await win.choose("Release");
  assertEquals(space(), "contexts");
  await win.press("palette");
  await win.choose("Groceries");
  assertEquals(space(), "apps");
  await win.press("palette");
  await win.choose("Go to Settings");
  assertEquals(space(), "settings");
  await win.press("palette");
  await win.choose("Back to launcher");
  assert(!view.container.querySelector("[data-space='lophn']"));
});

Deno.test("shell/desktop#R28: lophn 공간 팔레트에 Go to Roles가 없다", async () => {
  const win = fakeWindow();
  const { source } = fakeSource();
  using view = render(
    <Desktop
      source={core}
      initial={openLophn()}
      lophn={source}
      palette={win.deps}
    />,
  );
  await flush();
  await win.press("palette");
  const labels = win.model().choices.map((choice) => choice.label);
  assert(!labels.some((label) => label.includes("Roles")), "Roles in palette");
  assert(view.container.querySelector("[data-space='lophn']"));
});

Deno.test("shell/desktop#R30: 앱 통로가 있는 창에서 팔레트의 앱 행은 그 앱 공간으로 간다", async () => {
  const win = fakeWindow();
  const { source } = fakeSource();
  const apps = fakeApps({ rows: [appRow("app_1", "Groceries")] });
  using view = render(
    <Desktop
      source={core}
      initial={openLophn()}
      lophn={source}
      palette={win.deps}
      apps={apps.source}
    />,
  );
  await flush();
  await win.press("palette");
  await win.choose("Groceries");
  await flush();
  assertEquals(
    find(view.container, "[data-space='app']").getAttribute("data-app"),
    "app_1",
  );
});

Deno.test("shell/desktop#R18: 팔레트 키는 다시 누르면 닫고 런처 복귀 키는 어느 공간에서든 런처로 간다", async () => {
  const win = fakeWindow();
  const { source } = fakeSource();
  using view = render(
    <Desktop
      source={core}
      initial={openLophn()}
      lophn={source}
      palette={win.deps}
    />,
  );
  await flush();
  await win.press("palette");
  assertEquals(win.opened.length, 1);
  await win.press("palette");
  assertEquals(win.closed, ["surface_1"]);
  await win.press("launcher");
  assert(!view.container.querySelector("[data-space='lophn']"));
  // 런처에는 팔레트 행이 없어 팔레트 키가 아무것도 열지 않는다.
  await win.press("palette");
  assertEquals(win.opened.length, 1);
});

Deno.test("shell/desktop#R18: 상단 바 팔레트 단추는 아이콘이고 이름과 키를 tooltip으로 알린다", async () => {
  const win = fakeWindow();
  const { source } = fakeSource();
  using view = render(
    <Desktop
      source={core}
      initial={openLophn()}
      lophn={source}
      palette={win.deps}
    />,
  );
  await flush();
  const button = find(view.container, "[data-palette-open]");
  assertEquals(button.getAttribute("aria-label"), "Search and commands");
  assertEquals(button.textContent, "");
  assert(button.querySelector("svg.lucide"));
  click(button);
  await flush();
  assertEquals(win.opened.length, 1);
  assertEquals(shortcutLabel("CommandOrControl+K", "linux"), "Ctrl+K");
  assertEquals(shortcutLabel("CommandOrControl+Shift+L", "mac"), "⌘⇧L");
  assertEquals(
    shortcutLabel("CommandOrControl+Shift+L", "windows"),
    "Ctrl+Shift+L",
  );
});

Deno.test("shell/desktop#R30: 묶음 순서는 공간의 표를 따르고 공간에 없는 묶음과 겹친 대상은 빠진다", () => {
  const entries = [
    {
      group: "actions" as const,
      key: "a",
      label: "Act",
      icon: "screen" as const,
      target: 1,
    },
    {
      group: "apps" as const,
      key: "b",
      label: "App",
      icon: "app" as const,
      target: 2,
    },
    {
      group: "documents" as const,
      key: "c",
      label: "Doc",
      icon: "document" as const,
      target: 3,
    },
    {
      group: "documents" as const,
      key: "c",
      label: "Doc",
      icon: "document" as const,
      target: 4,
    },
    {
      group: "tabs" as const,
      key: "d",
      label: "Tab",
      icon: "tab" as const,
      target: 5,
    },
  ];
  assertEquals(
    arrange(WORKSPACE_GROUPS, entries, "").map((row) => row.target),
    [5, 3, 1],
  );
  assertEquals(arrange(LOPHN_GROUPS, entries, "").map((row) => row.target), [
    3,
    2,
    1,
  ]);
  assertEquals(arrange(LOPHN_GROUPS, entries, "ap").map((row) => row.target), [
    2,
  ]);
  const many = Array.from({ length: 30 }, (_, index) => ({
    group: "documents" as const,
    key: `d${index}`,
    label: `Doc ${index}`,
    icon: "document" as const,
    target: index,
  }));
  const rows = arrange(WORKSPACE_GROUPS, many, "");
  assertEquals(rows.length, 12);
  const { model, targets } = paletteModel("Search", rows, 3, (group) => group);
  assertEquals(model.choices[0]!.id, "documents-3-0");
  assertEquals(targets.get("documents-3-11"), 11);
});
