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
      files: () => Promise.resolve({ ok: true, value: [] }),
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

Deno.test("shell/desktop#R28: sidebar의 폴더 안 문서는 탭으로 열리고 컨텍스트 행은 onContext로 이어진다", async () => {
  const { source } = sourceOf();
  const base = source.files;
  source.files = (project) =>
    base(project).then(() => ({
      ok: true as const,
      value: [{
        folder: "/work/lophn",
        path: "docs/notes.md",
        document: "doc_1",
        title: "notes",
      }],
    }));
  const contexts: string[] = [];
  using view = render(
    <Workspace
      projectId="prj_1"
      source={source}
      windowWidth={1600}
      bodyWidth={1200}
      onLauncher={() => {}}
      onLophn={() => {}}
      onContext={(context) => contexts.push(context)}
    />,
  );
  await flush();
  act(() =>
    (view.container.querySelector("[data-folder]") as HTMLElement).click()
  );
  act(() =>
    (view.container.querySelector("[data-folder-document]") as HTMLElement)
      .click()
  );
  assertEquals(
    view.container.querySelector("[data-tab]")?.getAttribute("data-tab"),
    "doc_1",
  );
  act(() =>
    (view.container.querySelector("[data-context]") as HTMLElement).click()
  );
  assertEquals(contexts, ["ctx_1"]);
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
        const state = {
          kind: "text",
          text: "# Notes",
          complete: true,
        } as const;
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

function ctrlAltB(): void {
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "b",
        code: "KeyB",
        ctrlKey: true,
        altKey: true,
        bubbles: true,
        cancelable: true,
      }),
    );
  });
}

Deno.test("shell/editor#R6: 정보 패널은 기본 닫힘이고 CommandOrControl+Alt+B로 여닫으며 공간의 열림과 마지막 탭을 기억한다", async () => {
  const { source, saved } = sourceOf();
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
  assertEquals(view.container.querySelector("[data-info-panel]"), null);
  ctrlAltB();
  const panel = view.container.querySelector("[data-info-panel]") as
    | HTMLElement
    | null;
  assert(panel);
  assertEquals(panel.style.width, "320px");
  act(() =>
    (view.container.querySelector("[data-info-tab='versions']") as HTMLElement)
      .click()
  );
  const last = saved.at(-1) as {
    information_panel: { open: boolean; tab: string };
  };
  assertEquals(last.information_panel, { open: true, tab: "versions" });
  ctrlAltB();
  assertEquals(view.container.querySelector("[data-info-panel]"), null);
  assertEquals(
    (saved.at(-1) as { information_panel: unknown }).information_panel,
    { open: false, tab: "versions" },
  );

  // 같은 공간을 다시 열면 열림과 마지막 탭이 돌아온다.
  const restored = sourceOf({
    panes: [{ tabs: [], selected_tab: null }],
    information_panel: { open: true, tab: "versions" },
  });
  using again = render(
    <Workspace
      projectId="prj_1"
      source={restored.source}
      windowWidth={1600}
      bodyWidth={1200}
      onLauncher={() => {}}
      onLophn={() => {}}
    />,
  );
  await flush();
  assertEquals(
    again.container.querySelector("[data-info-tab][aria-selected=true]")
      ?.getAttribute("data-info-tab"),
    "versions",
  );
});

Deno.test("shell/editor#R6: overlay 정보 패널은 Escape와 바깥 click으로 닫히고 안쪽 click에는 남는다", async () => {
  const { source } = sourceOf();
  using view = render(
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
  const open = () =>
    act(() =>
      (view.container.querySelector("[data-info-toggle]") as HTMLElement)
        .click()
    );
  const placement = () =>
    view.container.querySelector("[data-info-panel]")?.getAttribute(
      "data-info-panel",
    ) ?? null;
  open();
  assertEquals(placement(), "overlay");
  act(() => {
    document.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
  });
  assertEquals(placement(), null);
  open();
  const inside = view.container.querySelector("[data-info-body]")!;
  act(() => {
    inside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  assertEquals(placement(), "overlay");
  const outside = view.container.querySelector("[data-space]")!;
  act(() => {
    outside.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
  assertEquals(placement(), null);
});

Deno.test("shell/editor#R6 shell/editor#R13: 버전 탭의 비교는 focus 칸 문서 탭 본문에 비교를 열고 닫으면 문서로 돌아온다", async () => {
  const { source } = sourceOf({
    panes: [{
      tabs: [{ key: "doc_1", kind: "document_editor", title: "notes" }],
      selected_tab: "doc_1",
    }],
    split_ratio: 0.5,
    focused_pane: 0,
    information_panel: { open: true, tab: "versions" },
  });
  const rows = [2, 1].map((number) => ({
    id: `ver_${number}`,
    number,
    savedBy: "user" as const,
    savedAt: 0,
    run: null,
    fromFile: false,
    contentHash: `h${number}`,
    restorable: true,
  }));
  const editor: EditorDeps = {
    ...editorDeps(),
    versions: {
      facts: () => Promise.resolve({ ok: false, code: "unavailable" }),
      history: () => Promise.resolve({ ok: true, value: rows }),
      text: (_document, version) =>
        Promise.resolve({
          ok: true,
          value: version === "ver_1" ? "# Notes\nold" : "# Notes\nnew",
        }),
      sections: () => Promise.resolve({ ok: true, value: [] }),
      diff: () =>
        Promise.resolve({
          ok: true,
          value: {
            deletions: [{ range: { start: 2, end: 2 }, text: "old" }],
            additions: [{ range: { start: 2, end: 2 }, text: "new" }],
            omissions: [],
            complete: true,
          },
        }),
      sectionHistory: () => Promise.resolve({ ok: false, code: "unavailable" }),
      contexts: () => Promise.resolve({ ok: true, value: [] }),
      restore: () => Promise.resolve({ ok: false, code: "unavailable" }),
    },
  };
  using view = render(
    <Workspace
      projectId="prj_1"
      source={source}
      windowWidth={1600}
      bodyWidth={1200}
      onLauncher={() => {}}
      onLophn={() => {}}
      editor={editor}
    />,
  );
  await flush();
  await flush();
  const compare = view.container.querySelector(
    "[data-compare-previous='2']",
  ) as HTMLElement;
  assert(compare);
  act(() => compare.click());
  await flush();
  await flush();
  assertEquals(
    view.container.querySelector("[data-pane-body] [data-document-view]")
      ?.getAttribute("data-document-view"),
    "compare",
  );
  const shown = [
    ...view.container.querySelectorAll("[data-compare-body] tr[data-diff]"),
  ].map((row) => row.getAttribute("data-diff"));
  assertEquals(shown, ["same", "delete", "add"]);
  act(() =>
    (view.container.querySelector("[data-compare-close]") as HTMLElement)
      .click()
  );
  await flush();
  assertEquals(
    view.container.querySelector("[data-pane-body] [data-document-view]")
      ?.getAttribute("data-document-view"),
    "read",
  );
});
