// Contexts·Context·Search 탭 kind와 여는 길(shell/workspace#R14, R15, R26, R29~R32). 화면 하나하나는
// 각자의 시험이 보고 여기서는 작업대에 올려 열리는 탭과 저장되는 layout을 본다.
import { assert, assertEquals } from "@std/assert";
import { act, type ReactNode } from "react";
import {
  click,
  focus,
  manualTimer,
  one,
  pressAsync,
  render,
} from "../../../../../packages/design/components/testing.ts";

import {
  CONTEXT_SUB_TABS,
  TAB_KINDS,
} from "../../../../../packages/contracts/shell/workspace.ts";
import { ConversationProvider } from "../../conversation/dock-slot.tsx";
import { DraftStore } from "../../conversation/drafts.ts";
import {
  fakeSource as fakeConversation,
  manualTicks,
} from "../../conversation/testdata/fake-source.ts";
import type { EditorDeps } from "../../editor/document-view.tsx";
import { readingWidthStore } from "../../editor/reading-width.ts";
import { TerminalStore } from "../../terminal/store.ts";
import { toStoredLayout, viewFromStored } from "../layout-map.ts";
import type { WorkspaceSource } from "../source.ts";
import { tabKindLabel, tabKindOf, tabKinds } from "../kinds/registry.ts";
import { Workspace } from "../workspace.tsx";
import { layoutHint } from "../view-hint.ts";
import {
  createFakeContextsSource,
  EVAL,
  experimentPath,
  fakeId,
  HARNESS,
  RELEASE_NOTES,
  RELEASE_NOTES_ITEM,
} from "./fake-source.ts";
import { SUB_TABS } from "./shared.ts";
import { settleContextTabs } from "./settle-tabs.ts";
import type { ContextsSource } from "./source.ts";
import { all, buttonNamed, norm } from "./testing.tsx";

const EXPERIMENT_DOC = "doc_experiment008";
const NOTES_DOC = "doc_notes";
const contextKey = (context: string) => `context:${context}`;

const FILES = [{
  folder: "/work/lophn",
  path: experimentPath("exp-008"),
  document: EXPERIMENT_DOC,
  title: "exp-008 query tools",
}];

interface Options {
  readonly layout?: unknown;
  readonly contexts?: ContextsSource | null;
  readonly timer?: ReturnType<typeof manualTimer>;
  readonly conversation?: boolean;
  readonly editor?: EditorDeps;
}

function mount(options: Options = {}) {
  const saved: {
    panes: { tabs: Record<string, unknown>[]; selected_tab: string | null }[];
  }[] = [];
  const contexts = options.contexts === undefined
    ? createFakeContextsSource()
    : options.contexts;
  const source: WorkspaceSource = {
    project: () =>
      Promise.resolve({
        ok: true,
        value: { id: "prj_1", title: "lophn", folders: [] },
      }),
    documents: () =>
      Promise.resolve({
        ok: true,
        value: [{ id: NOTES_DOC, title: "notes" }],
      }),
    contexts: () => Promise.resolve({ ok: true, value: [] }),
    files: () => Promise.resolve({ ok: true, value: FILES }),
    readLayout: () =>
      Promise.resolve(
        options.layout === undefined
          ? { ok: true, available: false, reason: "absent" }
          : { ok: true, available: true, layout: options.layout },
      ),
    saveLayout: (value) => {
      saved.push(value as (typeof saved)[number]);
      return Promise.resolve({ ok: true });
    },
    ...(contexts === null ? {} : { contextsSource: contexts }),
  };
  const body = (
    <Workspace
      projectId="prj_1"
      source={source}
      windowWidth={1600}
      bodyWidth={1200}
      onLauncher={() => {}}
      onLophn={() => {}}
      timer={options.timer}
      editor={options.editor}
      terminal={{
        bridge: null,
        store: new TerminalStore(null),
        createView: () => ({
          write: () => {},
          reset: () => {},
          focus: () => {},
          fit: () => null,
          onData: () => () => {},
          dispose: () => {},
        }),
        confirmClose: () => Promise.resolve(true),
      }}
    />
  );
  const wrapped: ReactNode = options.conversation
    ? (
      <ConversationProvider
        deps={{
          source: fakeConversation().source,
          drafts: new DraftStore(),
          ticks: manualTicks().ticks,
        }}
      >
        {body}
      </ConversationProvider>
    )
    : body;
  return { view: render(wrapped), saved };
}

async function flush(): Promise<void> {
  for (let round = 0; round < 6; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const tabKeys = (root: ParentNode) =>
  all(root, "[data-tab]").map((tab) => tab.dataset.tab);
const lastTabs = (saved: ReturnType<typeof mount>["saved"]) =>
  saved.at(-1)!.panes.flatMap((pane) => pane.tabs);

function layoutOf(...tabs: Record<string, unknown>[]) {
  return {
    panes: [{ tabs, selected_tab: tabs[0]!.key }],
    split_ratio: 0.5,
    focused_pane: 0,
    information_panel: { open: false, tab: "info" },
  };
}

const CONTEXT_TAB = {
  kind: "context",
  key: contextKey(EVAL),
  context: EVAL,
  sub_tab: "violations",
};
const SEARCH_TAB = {
  kind: "search",
  key: "search-1",
  context: EVAL,
  declared_search: "findings_about_change",
  inputs: { kind: ["improvement", "regression"] },
  page: 1,
  saved_view: fakeId("viw", "v1"),
};
const CONTEXTS_TAB = { kind: "contexts", key: "contexts" };

Deno.test("shell/workspace#R14 [ctx-I53]: registry에 Contexts·Context·Search 세 kind가 올라 있고 TAB_KINDS와 같다", () => {
  const names = tabKinds().map((kind) => kind.kind);
  for (const kind of ["contexts", "context", "search"]) {
    assert(names.includes(kind), `${kind} is not registered`);
    assert((TAB_KINDS as readonly string[]).includes(kind));
  }
  // Agent 탭은 다른 일이 맡는다.
  assertEquals(names.includes("agent"), false);
  assertEquals(tabKindLabel("contexts"), "Contexts");
  assertEquals(tabKindLabel("context"), "Context");
  assertEquals(tabKindLabel("search"), "Search");
  for (const kind of ["contexts", "context", "search"]) {
    assert(tabKindOf(kind)!.icon, `${kind} has no icon`);
  }
});

Deno.test("shell/workspace#R17 [ctx-I53]: 화면의 하위 탭 목록은 contracts의 하위 탭 목록과 같다", () => {
  assertEquals([...SUB_TABS], [...CONTEXT_SUB_TABS]);
});

Deno.test("shell/workspace#R14 [ctx-I53]: 세 kind의 탭은 layout을 저장하고 복원해도 그대로이고 파일에는 schema 필드만 남는다", () => {
  const stored = layoutOf(CONTEXTS_TAB, CONTEXT_TAB, SEARCH_TAB);
  const restored = viewFromStored(stored).view!;
  const tabs = restored.panes[0]!.tabs;
  assertEquals(tabs.map((tab) => tab.kind), ["contexts", "context", "search"]);
  assertEquals(tabs[1]!.fields, { context: EVAL, sub_tab: "violations" });
  const out = toStoredLayout({
    project: "prj_1",
    view: restored,
    informationPanel: { open: false, tab: "info" },
    lastSpace: "project",
  });
  assertEquals(out.panes[0]!.tabs, [CONTEXTS_TAB, CONTEXT_TAB, SEARCH_TAB]);
  // 제목·결과 줄은 파일에 없다.
  assertEquals(JSON.stringify(out).includes("title"), false);
});

Deno.test("shell/workspace#R14 [ctx-I53]: 맞지 않는 context 값의 탭은 저장·복원에서 그 탭만 빠지고 하위 탭을 모르면 Overview다", () => {
  const view = viewFromStored(layoutOf(
    { kind: "context", key: "context:bad", context: "ctx_1" },
    { ...CONTEXT_TAB, sub_tab: "nope" },
    { kind: "search", key: "search-x", context: "nope" },
  )).view!;
  assertEquals(view.panes[0]!.tabs.map((tab) => tab.key), [
    contextKey(EVAL),
  ]);
  assertEquals(view.panes[0]!.tabs[0]!.fields?.sub_tab, "overview");
});

Deno.test("shell/workspace#R14 [ctx-I53]: 현재 보기 힌트는 context·하위 탭·선언된 검색의 key만 담고 채운 입력은 담지 않는다", () => {
  const view = viewFromStored(layoutOf(CONTEXTS_TAB, CONTEXT_TAB, SEARCH_TAB))
    .view!;
  const hint = layoutHint({ project: "prj_1", view, presentation: {} });
  assertEquals(hint.panes[0]!.tabs, [
    { kind: "contexts", key: "contexts" },
    {
      kind: "context",
      key: contextKey(EVAL),
      context: EVAL,
      sub_tab: "violations",
    },
    {
      kind: "search",
      key: "search-1",
      context: EVAL,
      declared_search: "findings_about_change",
    },
  ]);
  assertEquals(JSON.stringify(hint).includes("improvement"), false);
});

Deno.test("shell/workspace#R6 [ctx-I53]: 복원할 때 없어진 context의 Context·Search 탭은 다른 없는 대상처럼 빠지고 나머지 순서와 선택은 그대로다", async () => {
  const gone = fakeId("ctx", "gn1");
  const { view } = mount({
    layout: {
      ...layoutOf(
        CONTEXTS_TAB,
        { ...CONTEXT_TAB, key: contextKey(gone), context: gone },
        { ...SEARCH_TAB, context: gone },
        { ...CONTEXT_TAB, sub_tab: "glossary" },
      ),
      panes: [{
        tabs: [
          CONTEXTS_TAB,
          { ...CONTEXT_TAB, key: contextKey(gone), context: gone },
          { ...SEARCH_TAB, context: gone },
          { ...CONTEXT_TAB, sub_tab: "glossary" },
        ],
        selected_tab: contextKey(EVAL),
      }],
    },
  });
  using _ = view;
  await flush();
  assertEquals(tabKeys(view.container), ["contexts", contextKey(EVAL)]);
  assertEquals(
    one(view.container, "[data-tab][aria-selected=true]").dataset.tab,
    contextKey(EVAL),
  );
  // 남은 탭은 이름을 얻는다.
  assertEquals(
    norm(one(view.container, `[data-tab='${contextKey(EVAL)}']`)).startsWith(
      "eval",
    ),
    true,
  );
});

Deno.test("shell/workspace#R6 [ctx-I53]: context 목록을 읽지 못하면 복원한 탭을 그대로 둔다", async () => {
  const base = createFakeContextsSource();
  const { view } = mount({
    contexts: {
      ...base,
      list: () => Promise.resolve({ ok: false, message: "down" }),
    },
    layout: layoutOf(CONTEXT_TAB),
  });
  using _ = view;
  await flush();
  assertEquals(tabKeys(view.container), [contextKey(EVAL)]);
});

Deno.test("shell/workspace#R6 [ctx-I53]: settleContextTabs는 없는 context의 탭만 빼고 칸이 비면 접는다", () => {
  const view = viewFromStored({
    panes: [
      { tabs: [CONTEXTS_TAB], selected_tab: "contexts" },
      {
        tabs: [{ ...CONTEXT_TAB, context: fakeId("ctx", "gn1") }],
        selected_tab: contextKey(EVAL),
      },
    ],
  }).view!;
  const settled = settleContextTabs(view, [{ id: EVAL, title: "eval" }]);
  assertEquals(settled.panes.length, 1);
  assertEquals(settled.panes[0]!.tabs.map((tab) => tab.key), ["contexts"]);
});

Deno.test("shell/workspace#R31 [ctx-I53]: 첫째 길 — sidebar의 Contexts 행이 Contexts 탭을 열고 다시 눌러도 탭은 하나다", async () => {
  const { view, saved } = mount();
  using _ = view;
  await flush();
  const row = one(view.container, "[data-contexts-row]");
  assertEquals(norm(row), "Contexts");
  click(row);
  await flush();
  assertEquals(tabKeys(view.container), ["contexts"]);
  // 카드가 보인다.
  assertEquals(all(view.container, "[data-context-card]").length, 2);
  click(row);
  await flush();
  assertEquals(tabKeys(view.container), ["contexts"]);
  assertEquals(lastTabs(saved), [CONTEXTS_TAB]);
});

Deno.test("shell/workspace#R31 [ctx-I53]: Contexts 탭 카드의 [Open]은 그 Context 탭을 Overview로 열고 Frame의 머리와 하위 탭 다섯이 보인다", async () => {
  const { view, saved } = mount();
  using _ = view;
  await flush();
  click(one(view.container, "[data-contexts-row]"));
  await flush();
  click(
    buttonNamed(
      one(view.container, `[data-context-card="${HARNESS}"]`),
      "Open",
    )!,
  );
  await flush();
  assertEquals(tabKeys(view.container), ["contexts", contextKey(HARNESS)]);
  assertEquals(
    all(view.container, "[role=tab]").map(norm).filter((name) =>
      ["Overview", "Search", "Violations", "Glossary", "Contract"].includes(
        name,
      )
    ),
    ["Overview", "Search", "Violations", "Glossary", "Contract"],
  );
  assertEquals(lastTabs(saved).at(-1), {
    kind: "context",
    key: contextKey(HARNESS),
    context: HARNESS,
    sub_tab: "overview",
  });
});

Deno.test("shell/workspace#R17 [ctx-I53]: 하위 탭을 고르면 그 본문이 보이고 고른 하위 탭이 layout에 남는다", async () => {
  const { view, saved } = mount({
    layout: layoutOf({ ...CONTEXT_TAB, sub_tab: "overview" }),
  });
  using _ = view;
  await flush();
  // Overview는 개체 카드와 Composition을 함께 둔다.
  assert(view.container.querySelector("[role=tree]"), "Composition is missing");
  const subTab = (name: string) =>
    all(view.container, "[role=tab]").find((tab) =>
      norm(tab).startsWith(name)
    )!;
  for (
    const [name, sub, marker] of [
      ["Search", "search", "[data-context-search]"],
      ["Violations", "violations", "[data-violation]"],
      ["Glossary", "glossary", "[data-glossary-term], [data-empty], table, ul"],
      ["Contract", "contract", "[data-note]"],
    ] as const
  ) {
    act(() => {
      subTab(name).dispatchEvent(
        new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          button: 0,
        }),
      );
    });
    await flush();
    assert(view.container.querySelector(marker), `${name} body is missing`);
    assertEquals(lastTabs(saved).at(-1)!.sub_tab, sub);
  }
});

Deno.test("shell/workspace#R22 [ctx-I53]: Search 하위 탭은 선언된 검색 목록을 보이고 하나를 고르면 결과를 context 안에서 보인다", async () => {
  const { view } = mount({
    layout: layoutOf({ ...CONTEXT_TAB, sub_tab: "search" }),
  });
  using _ = view;
  await flush();
  const picks = all(view.container, "[data-context-search] [data-declared]");
  assertEquals(picks.map(norm), [
    "Findings about a change",
    "Experiments by status",
    "Scenarios using a rubric",
  ]);
  click(picks[1]!);
  await flush();
  assertEquals(tabKeys(view.container), [contextKey(EVAL)]);
  assert(view.container.querySelector("[data-result-count]"), "no results");
});

Deno.test("shell/workspace#R30 [ctx-I53]: 만드는 중인 context의 탭은 ContextDrafting을 보인다", async () => {
  const { view } = mount({
    contexts: createFakeContextsSource({ drafting: true }),
    layout: layoutOf({
      ...CONTEXT_TAB,
      key: contextKey(RELEASE_NOTES),
      context: RELEASE_NOTES,
      sub_tab: "overview",
    }),
  });
  using _ = view;
  await flush();
  assert(norm(view.container).includes("drafting"), norm(view.container));
});

async function chooseMenuItem(trigger: HTMLElement, label: string) {
  focus(trigger);
  await pressAsync(trigger, "Enter");
  for (let step = 0; step < 6; step += 1) {
    await pressAsync(document.activeElement!, "ArrowDown");
    if (norm(document.activeElement) === label) break;
  }
  assertEquals(norm(document.activeElement), label);
  await pressAsync(document.activeElement!, "Enter");
  await flush();
}

Deno.test("shell/workspace#R31 [ctx-I53]: 셋째 길 — 탭 줄 `+`의 Context는 context 목록에서 하나를 골라 그 탭을 연다", async () => {
  const { view } = mount();
  using _ = view;
  await flush();
  await chooseMenuItem(
    one(view.container, "[data-pane] button[data-open-context]"),
    "harness",
  );
  assertEquals(tabKeys(view.container), [contextKey(HARNESS)]);
  assertEquals(
    norm(one(view.container, "[data-tab]")).startsWith("harness"),
    true,
  );
});

Deno.test("shell/workspace#R31 [ctx-I53]: 넷째 길 — Search 탭의 'Open context'는 그 context의 탭을 연다", async () => {
  const { view } = mount({ layout: layoutOf(SEARCH_TAB) });
  using _ = view;
  await flush();
  click(one(view.container, "[data-search-side] [data-open-context]"));
  await flush();
  assertEquals(tabKeys(view.container), ["search-1", contextKey(EVAL)]);
});

Deno.test("shell/workspace#R26 [ctx-I53]: 검색 결과의 도메인 객체 링크는 그 객체의 문서 탭을 새 탭으로 연다", async () => {
  const { view } = mount({ layout: layoutOf({ ...SEARCH_TAB, page: 0 }) });
  using _ = view;
  await flush();
  const link = all(view.container, "tbody [data-open-document]").find((item) =>
    norm(item) === "exp-008"
  );
  assert(link, "no exp-008 link in the results");
  click(link);
  await flush();
  assertEquals(tabKeys(view.container), ["search-1", EXPERIMENT_DOC]);
});

Deno.test("shell/workspace#R23 [ctx-I53]: Search 탭에서 입력과 선택을 바꾸면 선언된 검색·채운 입력·page·저장한 보기가 layout에 남는다", async () => {
  const { view, saved } = mount({
    layout: layoutOf({
      kind: "search",
      key: "search-1",
      context: EVAL,
      declared_search: null,
      inputs: {},
      page: 0,
      saved_view: null,
    }),
  });
  using _ = view;
  await flush();
  click(all(view.container, "[data-declared]")[1]!);
  await flush();
  // 입력 바뀜은 저장을 잠깐 모아 쓴다.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 250));
  });
  const stored = lastTabs(saved)[0]!;
  assertEquals(stored.declared_search, "experiments_by_status");
  assertEquals(stored.context, EVAL);
  assertEquals(stored.page, 0);
  assertEquals(stored.saved_view, null);
});

Deno.test("shell/workspace#R32 [ctx-I53]: 접힌 sidebar는 바로 가기 rail만 보이고 단추마다 그 종류의 탭을 연다", async () => {
  const { view } = mount({ conversation: true });
  using _ = view;
  await flush();
  click(one(view.container, "[data-sidebar-toggle]"));
  await flush();
  assertEquals(
    one(view.container, "[data-sidebar]").dataset.sidebar,
    "collapsed",
  );
  const rail = all(view.container, "[data-sidebar] [data-rail-action]");
  assertEquals(rail.map((button) => button.dataset.railAction), [
    "terminal",
    "contexts",
    "saved",
    "search",
    "agent",
  ]);
  // 접힌 sidebar에는 문서·폴더 행이 없다.
  assertEquals(
    view.container.querySelector("[data-sidebar] [data-document]"),
    null,
  );

  const press = async (action: string) => {
    click(one(view.container, `[data-rail-action='${action}']`));
    await flush();
  };
  await press("terminal");
  assertEquals(tabKeys(view.container).length, 1);
  assert(tabKeys(view.container)[0]!.startsWith("terminal-"));
  await press("contexts");
  assert(tabKeys(view.container).includes("contexts"));
  await press("saved");
  const searches = () =>
    tabKeys(view.container).filter((key) => key!.startsWith("search-"));
  assertEquals(searches().length, 1);
  assert(
    view.container.querySelector("[data-saved-views]"),
    "no saved views list",
  );
  // Search는 열려 있는 Search 탭을 고를 뿐 하나 더 만들지 않는다.
  await press("search");
  assertEquals(searches().length, 1);
  assertEquals(view.container.querySelector("[data-dock]"), null);
  await press("agent");
  assert(
    view.container.querySelector("[data-dock]"),
    "the conversation did not open",
  );
});

Deno.test("shell/workspace#R32 [ctx-I53]: context가 하나도 없으면 rail의 Search는 Search 탭 대신 Contexts 탭을 연다", async () => {
  const { view } = mount({
    contexts: createFakeContextsSource({ empty: true }),
  });
  using _ = view;
  await flush();
  click(one(view.container, "[data-sidebar-toggle]"));
  await flush();
  click(one(view.container, "[data-rail-action='search']"));
  await flush();
  assertEquals(tabKeys(view.container), ["contexts"]);
});

Deno.test("shell/workspace#R31 [ctx-I53]: 둘째 길 — 접힌 rail의 Contexts에서 연 Contexts 탭의 [Open]이 Context 탭을 연다", async () => {
  const { view } = mount();
  using _ = view;
  await flush();
  click(one(view.container, "[data-sidebar-toggle]"));
  await flush();
  click(one(view.container, "[data-rail-action='contexts']"));
  await flush();
  click(
    buttonNamed(one(view.container, `[data-context-card="${EVAL}"]`), "Open")!,
  );
  await flush();
  assertEquals(tabKeys(view.container), ["contexts", contextKey(EVAL)]);
});

function notesEditor(): EditorDeps {
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

Deno.test("shell/workspace#R31 [ctx-I53]: 다섯째 길 — 문서 Info › Contexts는 이 문서가 든 context를 나열하고 [Open]이 그 Context 탭을 연다", async () => {
  const { view } = mount({
    editor: notesEditor(),
    contexts: createFakeContextsSource({
      containing: {
        "docs/notes.md": [{
          context: EVAL,
          title: "eval",
          types: ["Experiment"],
        }],
      },
    }),
    layout: {
      ...layoutOf({
        kind: "document_editor",
        key: "doc_01h455vb4pex5v6nkc6gd5fdw1",
        document: "doc_01h455vb4pex5v6nkc6gd5fdw1",
      }),
      information_panel: { open: true, tab: "contexts" },
    },
  });
  using _ = view;
  await flush();
  const row = one(view.container, "[data-info-panel] [data-containing]");
  assertEquals(row.dataset.containing, EVAL);
  click(buttonNamed(row, "Open")!);
  await flush();
  assert(tabKeys(view.container).includes(contextKey(EVAL)));
});

Deno.test("shell/workspace#R31 [ctx-I53]: 여섯째 길 — 위반이 늘어 뜬 toast의 [View]는 그 context를 Violations 하위 탭으로 연다", async () => {
  const base = createFakeContextsSource();
  let raised = false;
  const contexts: ContextsSource = {
    ...base,
    list: async (project) => {
      const read = await base.list(project);
      if (!raised || !read.ok) return read;
      return {
        ok: true,
        value: read.value.map((item) =>
          item.id === HARNESS ? { ...item, violation_mark: 3 } : item
        ),
      };
    },
  };
  const timer = manualTimer();
  const { view, saved } = mount({ contexts, timer });
  using _ = view;
  await flush();
  assertEquals(view.container.querySelector("[data-violation-toasts]"), null);
  raised = true;
  timer.advance(30_000);
  await flush();
  const toast = one(view.container, "[data-violation-toasts]");
  assertEquals(
    norm(toast).includes("harness: 3 documents don't match the contract"),
    true,
  );
  click(buttonNamed(toast, "View")!);
  await flush();
  assertEquals(tabKeys(view.container), [contextKey(HARNESS)]);
  assertEquals(lastTabs(saved)[0]!.sub_tab, "violations");
  assertEquals(view.container.querySelector("[data-violation-toasts]"), null);
});

Deno.test("shell/workspace#R31 [ctx-I53]: 아홉째 길 — [New context]는 대화를 열고 만드는 중인 context가 생기면 그 drafting 탭을 남긴다", async () => {
  const base = createFakeContextsSource();
  let started = false;
  const contexts: ContextsSource = {
    ...base,
    list: async (project) => {
      const read = await base.list(project);
      return started && read.ok
        ? { ok: true, value: [...read.value, RELEASE_NOTES_ITEM] }
        : read;
    },
  };
  const timer = manualTimer();
  const { view } = mount({ contexts, timer, conversation: true });
  using _ = view;
  await flush();
  click(one(view.container, "[data-contexts-row]"));
  await flush();
  assertEquals(view.container.querySelector("[data-dock]"), null);
  click(buttonNamed(view.container, "New context")!);
  await flush();
  assert(
    view.container.querySelector("[data-dock]"),
    "the conversation did not open",
  );
  // 아직 만드는 중인 context가 없으니 탭도 없다.
  assertEquals(tabKeys(view.container), ["contexts"]);
  started = true;
  timer.advance(30_000);
  await flush();
  assertEquals(tabKeys(view.container), [
    "contexts",
    contextKey(RELEASE_NOTES),
  ]);
});

Deno.test("shell/workspace#R31 [ctx-I53]: 누르지 않은 채 생긴 만드는 중인 context는 탭을 열지 않는다", async () => {
  const base = createFakeContextsSource();
  let started = false;
  const contexts: ContextsSource = {
    ...base,
    list: async (project) => {
      const read = await base.list(project);
      return started && read.ok
        ? { ok: true, value: [...read.value, RELEASE_NOTES_ITEM] }
        : read;
    },
  };
  const timer = manualTimer();
  const { view } = mount({ contexts, timer, conversation: true });
  using _ = view;
  await flush();
  started = true;
  timer.advance(30_000);
  await flush();
  assertEquals(tabKeys(view.container), []);
});

Deno.test("shell/workspace#R14 [ctx-I53]: 통로가 없는 작업대는 Contexts 행도 Context·Search 열기 단추도 두지 않는다", async () => {
  const { view } = mount({ contexts: null });
  using _ = view;
  await flush();
  assertEquals(view.container.querySelector("[data-contexts-row]"), null);
  assertEquals(
    view.container.querySelector("[data-pane] button[data-open-context]"),
    null,
  );
  assertEquals(
    view.container.querySelector("[data-pane] button[data-open-search]"),
    null,
  );
});

Deno.test("shell/workspace#R14 [ctx-I53]: 같은 key의 탭이 다른 칸에 있으면 새로 붙이지 않고 그 칸의 탭을 고른다", async () => {
  const { view, saved } = mount({
    layout: {
      panes: [
        { tabs: [CONTEXT_TAB], selected_tab: CONTEXT_TAB.key },
        { tabs: [CONTEXTS_TAB], selected_tab: "contexts" },
      ],
      split_ratio: 0.5,
      focused_pane: 0,
      information_panel: { open: false, tab: "info" },
    },
  });
  using _ = view;
  await flush();
  click(one(view.container, "[data-contexts-row]"));
  await flush();
  const panes = saved.at(-1)!.panes;
  assertEquals(panes.map((pane) => pane.tabs.length), [1, 1]);
  assertEquals(panes[1]!.selected_tab, "contexts");
});
