import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { render } from "../../../../packages/design/components/testing.ts";

import { Workspace } from "./workspace.tsx";
import type { WorkspaceSource } from "./source.ts";
import type { EditorDeps } from "../editor/document-view.tsx";
import { readingWidthStore } from "../editor/reading-width.ts";

function sourceOf(layout: unknown = null): {
  source: WorkspaceSource;
  saved: unknown[];
} {
  const saved: unknown[] = [];
  return {
    saved,
    source: {
      project: () =>
        Promise.resolve({
          ok: true,
          value: {
            id: "prj_1",
            title: "lophn",
            folders: [{ path: "/work/lophn" }],
          },
        }),
      documents: () =>
        Promise.resolve({
          ok: true,
          value: [{ id: "doc_1", title: "notes" }],
        }),
      contexts: () =>
        Promise.resolve({
          ok: true,
          value: [{ id: "ctx_1", title: "design" }],
        }),
      readLayout: () =>
        Promise.resolve(
          layout === null
            ? { ok: true, available: false, reason: "absent" }
            : { ok: true, available: true, layout },
        ),
      saveLayout: (value) => {
        saved.push(value);
        return Promise.resolve({ ok: true });
      },
    },
  };
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

Deno.test("shell/desktop#R28: 작업대는 프로젝트의 폴더·문서·컨텍스트를 읽어 sidebar에 보인다", async () => {
  const { source } = sourceOf();
  using view = render(
    <Workspace
      projectId="prj_1"
      source={source}
      windowWidth={1600}
      bodyWidth={1200}
      onLauncher={() => {}}
      onLophn={() => {}}
    />,
  );
  await flush();
  assertEquals(
    view.container.querySelector("[data-space]")?.getAttribute("data-space"),
    "project",
  );
  assertEquals(
    view.container.querySelector("[data-folder]")?.textContent,
    "lophn",
  );
  assertEquals(
    view.container.querySelector("[data-document]")?.textContent,
    "notes",
  );
  assertEquals(
    view.container.querySelector("[data-context]")?.textContent,
    "design",
  );
});

Deno.test("shell/workspace#R6: 저장된 layout의 탭·칸·선택을 복원해 그린다", async () => {
  const { source } = sourceOf({
    panes: [
      {
        tabs: [{ key: "doc_1", kind: "document_editor", title: "notes" }],
        selected_tab: "doc_1",
      },
      {
        tabs: [{ key: "term_1", kind: "terminal", title: "shell" }],
        selected_tab: "term_1",
      },
    ],
    split_ratio: 0.5,
    focused_pane: 0,
  });
  using view = render(
    <Workspace
      projectId="prj_1"
      source={source}
      windowWidth={1600}
      bodyWidth={1200}
      onLauncher={() => {}}
      onLophn={() => {}}
    />,
  );
  await flush();
  const tabs = [...view.container.querySelectorAll("[data-tab]")].map((node) =>
    node.getAttribute("data-tab")
  );
  assertEquals(tabs, ["doc_1", "term_1"]);
  const crumbs = [...view.container.querySelectorAll("[data-crumb]")];
  assertEquals(crumbs[crumbs.length - 1]?.textContent, "notes");
});

Deno.test("shell/desktop#R26: sidebar가 접히면 런처 복귀가 상단 바로 옮겨 간다", async () => {
  const { source } = sourceOf();
  const back: string[] = [];
  using view = render(
    <Workspace
      projectId="prj_1"
      source={source}
      windowWidth={1600}
      bodyWidth={1200}
      onLauncher={() => back.push("launcher")}
      onLophn={() => {}}
    />,
  );
  await flush();
  const toggle = view.container.querySelector(
    "[data-sidebar-toggle]",
  ) as HTMLElement;
  act(() => toggle.click());
  assertEquals(
    view.container.querySelector("[data-sidebar]")?.getAttribute(
      "data-sidebar",
    ),
    "collapsed",
  );
  const header = view.container.querySelector("header") as HTMLElement;
  const button = header.querySelector("[data-launcher-back]") as HTMLElement;
  assertEquals(button.getAttribute("aria-label"), "Launcher");
  assertEquals(button.textContent, "");
  act(() => button.click());
  assertEquals(back, ["launcher"]);
});

Deno.test("shell/workspace#R1: 상단 경로는 focus 칸의 활성 탭을 따른다", async () => {
  const { source } = sourceOf();
  using view = render(
    <Workspace
      projectId="prj_1"
      source={source}
      windowWidth={1600}
      bodyWidth={1200}
      onLauncher={() => {}}
      onLophn={() => {}}
    />,
  );
  await flush();
  const document = view.container.querySelector(
    "[data-document]",
  ) as HTMLElement;
  act(() => document.click());
  const crumbs = [...view.container.querySelectorAll("[data-crumb]")].map((
    node,
  ) => node.textContent);
  assertEquals(crumbs, ["lophn", "notes"]);
});

function pointer(type: string, clientX: number): PointerEvent {
  return new PointerEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    button: 0,
  });
}

Deno.test("shell/design-system#R24: sidebar drag는 drag-end의 마지막 폭을 적용하고 drag-cancel은 되돌린다", async () => {
  const { source } = sourceOf();
  using view = render(
    <Workspace
      projectId="prj_1"
      source={source}
      windowWidth={1600}
      bodyWidth={1200}
      onLauncher={() => {}}
      onLophn={() => {}}
    />,
  );
  await flush();
  const width = () =>
    (view.container.querySelector("[data-sidebar]") as HTMLElement).style
      .width;
  const resizer = () =>
    view.container.querySelector("[data-sidebar-resizer]") as HTMLElement;
  act(() => {
    resizer().dispatchEvent(pointer("pointerdown", 240));
    view.container.ownerDocument.dispatchEvent(pointer("pointermove", 300));
    view.container.ownerDocument.dispatchEvent(pointer("pointermove", 1000));
  });
  // drag 중에도 200~400px 안에 머문다.
  assertEquals(width(), "400px");
  act(() => {
    view.container.ownerDocument.dispatchEvent(pointer("pointermove", 320));
    view.container.ownerDocument.dispatchEvent(pointer("pointerup", 320));
  });
  assertEquals(width(), "320px");

  act(() => {
    resizer().dispatchEvent(pointer("pointerdown", 320));
    view.container.ownerDocument.dispatchEvent(pointer("pointermove", 380));
  });
  assertEquals(width(), "380px");
  act(() => {
    view.container.ownerDocument.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  assertEquals(width(), "320px");
});

Deno.test("shell/design-system#R25: 정보 패널은 아이콘 버튼으로 열고 본문 폭이 모자라면 overlay다", async () => {
  const { source, saved } = sourceOf();
  using wide = render(
    <Workspace
      projectId="prj_1"
      source={source}
      windowWidth={1600}
      bodyWidth={1200}
      onLauncher={() => {}}
      onLophn={() => {}}
    />,
  );
  await flush();
  const toggle = wide.container.querySelector(
    "[data-info-toggle]",
  ) as HTMLElement;
  assertEquals(toggle.textContent, "");
  assertEquals(toggle.getAttribute("aria-label"), "Info panel");
  act(() => toggle.click());
  assertEquals(
    wide.container.querySelector("[data-info-panel]")?.getAttribute(
      "data-info-panel",
    ),
    "docked",
  );
  const last = saved[saved.length - 1] as {
    information_panel: { open: boolean };
  };
  assertEquals(last.information_panel.open, true);

  using narrow = render(
    <Workspace
      projectId="prj_1"
      source={source}
      windowWidth={1000}
      bodyWidth={700}
      onLauncher={() => {}}
      onLophn={() => {}}
    />,
  );
  await flush();
  act(() =>
    (narrow.container.querySelector("[data-info-toggle]") as HTMLElement)
      .click()
  );
  assertEquals(
    narrow.container.querySelector("[data-info-panel]")?.getAttribute(
      "data-info-panel",
    ),
    "overlay",
  );
});

function editorDeps(): EditorDeps {
  return {
    source: {
      document: (id) =>
        Promise.resolve({
          ok: true,
          value: {
            id,
            title: "Release notes",
            fileName: "notes.md",
            path: "docs/notes.md",
            version: "ver_1",
            versionNumber: 1,
            savedAt: 0,
          },
        }),
      body: (_id, _version, onPage) => {
        const state = { kind: "text", text: "# Notes", complete: true } as const;
        onPage(state);
        return Promise.resolve(state);
      },
      outline: () => Promise.resolve({ ok: true, value: [] }),
      linkTargets: () => Promise.resolve({ ok: true, value: [] }),
      resolveLink: () => Promise.resolve({ ok: true, value: null }),
    },
    readingWidth: readingWidthStore({
      get: () => Promise.resolve({ value: null, revision: 0 }),
      apply: () => Promise.resolve({ ok: true, revision: 1 }),
    }),
    menu: { open: () => Promise.resolve(null) },
  };
}

Deno.test("shell/editor#R4: 문서 탭은 문서 읽기 화면을 그리고 탭 제목을 파일 이름으로 바꿔 저장한다", async () => {
  const { source, saved } = sourceOf({
    panes: [{
      tabs: [{ key: "doc_1", kind: "document_editor", title: "notes" }],
      selected_tab: "doc_1",
    }],
    split_ratio: 0.5,
    focused_pane: 0,
  });
  using view = render(
    <Workspace
      projectId="prj_1"
      source={source}
      windowWidth={1600}
      bodyWidth={1200}
      onLauncher={() => {}}
      onLophn={() => {}}
      editor={editorDeps()}
    />,
  );
  await flush();
  await flush();
  assert(view.container.querySelector("[data-pane-body] [data-document-view]"));
  const title = view.container.querySelector("[data-tab='doc_1'] span")
    ?.textContent;
  assertEquals(title, "notes.md");
  const last = saved.at(-1) as { panes: { tabs: { title: string }[] }[] };
  assertEquals(last.panes[0]!.tabs[0]!.title, "notes.md");
});
