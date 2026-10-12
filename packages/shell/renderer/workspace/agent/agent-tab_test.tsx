// agent-I33c: Agent 탭 kind와 여는 길, session 복원(shell/workspace#R6, R14, R15, R30, R32~R34, shell/desktop#R35).
// 화면 안쪽(대화·composer)은 conversation의 test가 보고, 여기서는 작업대에 올려 열리는 탭, 저장되는 layout,
// 탭이 source를 얻는 길과 view의 host가 작업대에 닿는 길을 본다. core 대신 agent마다 fake source를 쓴다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import { t } from "@lophn/wording";
import {
  click,
  focus,
  manualTimer,
  one,
  pressAsync,
  render,
  settle,
  unmountSettled,
} from "../../../../design/components/testing.ts";

import { TAB_KINDS } from "../../../../protocol/shell/workspace.ts";
import {
  say,
  SESSION_WEEK,
} from "../../conversation/testdata/fake-agent-source.ts";
import { toStoredLayout, viewFromStored } from "../layout-map.ts";
import type { WorkspaceSource } from "../source.ts";
import { tabKindLabel, tabKindOf } from "../kinds/registry.ts";
import { layoutHint } from "../view-hint.ts";
import { Workspace } from "../workspace.tsx";
import { createFakeAgentsSource } from "../agents/fake-source.ts";
import {
  createFakeContextsSource,
  EVAL,
  HARNESS,
  RELEASE_NOTES,
  RELEASE_NOTES_ITEM,
} from "../contexts/fake-source.ts";
import type { ContextsSource } from "../contexts/source.ts";
import { all, buttonNamed, norm, settleReads } from "../contexts/testing.tsx";
import {
  type AgentTabFixture,
  agentTabFixture,
  ENGINEER_ID,
  LOPHN_ID,
  PROJECT,
  RELEASE_ID,
} from "../testdata/agent-tab.ts";

const flush = settleReads;
const SESSION = SESSION_WEEK.id;
const PLACE = { kind: "project", id: PROJECT };

interface Options {
  readonly layout?: unknown;
  /** false면 Agent view의 통로 없이 연다. */
  readonly agentView?: AgentTabFixture | false;
  readonly contexts?: ContextsSource;
  readonly timer?: ReturnType<typeof manualTimer>;
  readonly windowWidth?: number;
  readonly onLophn?: () => void;
  readonly documents?: readonly { id: string; title: string }[];
}

function mount(options: Options = {}) {
  const fixture = options.agentView === undefined
    ? agentTabFixture()
    : options.agentView;
  const saved: {
    panes: { tabs: Record<string, unknown>[]; selected_tab: string | null }[];
  }[] = [];
  const source: WorkspaceSource = {
    project: () =>
      Promise.resolve({
        ok: true,
        value: { id: PROJECT, title: "phroner", folders: [] },
      }),
    documents: () =>
      Promise.resolve({ ok: true, value: options.documents ?? [] }),
    files: () => Promise.resolve({ ok: true, value: [] }),
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
    contextsSource: options.contexts ?? createFakeContextsSource(),
    agentsSource: createFakeAgentsSource(),
  };
  const view = render(
    <Workspace
      projectId={PROJECT}
      source={source}
      windowWidth={options.windowWidth ?? 1600}
      bodyWidth={1200}
      onLauncher={() => {}}
      onLophn={options.onLophn ?? (() => {})}
      timer={options.timer}
      {...(fixture === false ? {} : { agentViewSource: fixture.factory })}
    />,
  );
  return { view, saved, fixture };
}

function layoutOf(...tabs: Record<string, unknown>[]) {
  return {
    panes: [{ tabs, selected_tab: tabs[0]!.key }],
    split_ratio: 0.5,
    focused_pane: 0,
    information_panel: { open: false, tab: "info" },
  };
}

function agentTab(
  key: string,
  agent: string,
  session?: string,
): Record<string, unknown> {
  return {
    kind: "agent",
    key,
    agent,
    work_place: PLACE,
    ...(session === undefined ? {} : { session }),
  };
}

const tabKeys = (root: ParentNode) =>
  all(root, "[data-tab]").map((tab) => tab.dataset.tab!);
const agentTabs = (root: ParentNode) =>
  all(root, "[data-tab][data-kind=agent]");
const tabTitle = (tab: HTMLElement) =>
  norm(one(tab, "[data-kind-label]").previousElementSibling);
const lastTabs = (saved: ReturnType<typeof mount>["saved"]) =>
  saved.at(-1)!.panes.flatMap((pane) => pane.tabs);
const sidebarRow = (root: ParentNode, assignment: string) =>
  one(root, `[data-agents] [data-agent='${assignment}']`);

function composer(root: ParentNode): HTMLTextAreaElement {
  return one(root, "[data-composer-input]") as HTMLTextAreaElement;
}

function write(textarea: HTMLElement, value: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** 첫 말을 보내 session을 만든다. */
async function sendFirst(root: ParentNode, text: string): Promise<void> {
  write(composer(root), text);
  click(one(root, "[data-send]"));
  await flush();
}

async function openMore(root: ParentNode): Promise<void> {
  const more = one(root, '[aria-label="More"]');
  focus(more);
  await pressAsync(more, "Enter");
}

async function pickMore(index: number): Promise<void> {
  for (let step = 0; step < index; step += 1) {
    await pressAsync(document.activeElement!, "ArrowDown");
  }
  await pressAsync(document.activeElement!, "Enter");
}

/** lophn이 지난 session 하나를 가진 fixture. */
function withEarlierSession(): AgentTabFixture {
  const fixture = agentTabFixture();
  const fake = fixture.fake(LOPHN_ID);
  fake.state.sessions = [{ ...SESSION_WEEK, assignment: LOPHN_ID }];
  fake.state.threads[SESSION] = {
    entries: [say(fake, 1, "user", "What did we settle last week?")],
    run: null,
    tasks: [],
    approval: null,
  };
  return fixture;
}

Deno.test("shell/workspace#R14 shell/workspace#R33 [agent-I33c]: Agent kind는 registry에 올라 TAB_KINDS에 있고 이름은 Agent이며 `+` 메뉴에는 열기 항목이 없다", () => {
  assert((TAB_KINDS as readonly string[]).includes("agent"));
  const kind = tabKindOf("agent");
  assert(kind !== undefined, "agent is not registered");
  assertEquals(tabKindLabel("agent"), "Agent");
  assert(kind.icon);
  // agent는 sidebar·rail·Ask로만 연다. 탭 줄 `+`에는 Agent 항목을 두지 않는다(R15).
  assertEquals(kind.launcher, undefined);
});

Deno.test("shell/workspace#R6 shell/workspace#R33 [agent-I33c]: Agent 탭은 agent·자리·session 참조만 layout으로 저장하고 복원하며 제목은 파일에 남지 않는다", () => {
  const stored = layoutOf(agentTab("agent-1", LOPHN_ID, SESSION));
  const restored = viewFromStored(stored).view!;
  const tab = restored.panes[0]!.tabs[0]!;
  assertEquals(tab.kind, "agent");
  assertEquals(tab.fields?.agent, LOPHN_ID);
  assertEquals(tab.fields?.session, SESSION);
  const out = toStoredLayout({
    project: PROJECT,
    view: restored,
    informationPanel: { open: false, tab: "info" },
    lastSpace: "project",
  });
  assertEquals(out.panes[0]!.tabs, [agentTab("agent-1", LOPHN_ID, SESSION)]);
  assertEquals(JSON.stringify(out).includes("title"), false);

  // 첫 말 전의 새 session은 session 필드가 없다.
  const fresh = viewFromStored(layoutOf(agentTab("agent-2", ENGINEER_ID)))
    .view!;
  assertEquals(
    toStoredLayout({
      project: PROJECT,
      view: fresh,
      informationPanel: { open: false, tab: "info" },
      lastSpace: "project",
    }).panes[0]!.tabs,
    [agentTab("agent-2", ENGINEER_ID)],
  );
});

Deno.test("shell/workspace#R6 [agent-I33c]: agent·자리·session 중 맞지 않는 값이 있는 탭은 다른 agent나 새 session으로 바뀌지 않고 그 탭만 빠진다", () => {
  const drop = (patch: Record<string, unknown>) => {
    const view = viewFromStored(
      layoutOf(
        { kind: "terminal", key: "terminal-1", project_folder: "/work" },
        { ...agentTab("agent-1", LOPHN_ID, SESSION), ...patch },
      ),
    ).view!;
    return view.panes[0]!.tabs.map((tab) => tab.kind);
  };
  assertEquals(drop({}), ["terminal", "agent"]);
  assertEquals(drop({ agent: "asg_1" }), ["terminal"]);
  assertEquals(drop({ agent: undefined }), ["terminal"]);
  assertEquals(drop({ work_place: undefined }), ["terminal"]);
  assertEquals(drop({ work_place: { kind: "app", id: "app_1" } }), [
    "terminal",
  ]);
  assertEquals(drop({ session: "nope" }), ["terminal"]);
});

Deno.test("shell/workspace#R14 shell/workspace#R10 [agent-I33c]: Agent 탭의 현재 보기 힌트는 kind와 key만 담고 agent·session은 담지 않는다", () => {
  const view = viewFromStored(layoutOf(agentTab("agent-1", LOPHN_ID, SESSION)))
    .view!;
  const hint = layoutHint({ project: PROJECT, view, presentation: {} });
  assertEquals(hint.panes[0]!.tabs, [{ kind: "agent", key: "agent-1" }]);
});

Deno.test("shell/workspace#R6 shell/workspace#R33 shell/desktop#R37 [agent-I33c]: 저장된 Agent 탭은 같은 agent와 session을 source로 읽어 Agent view로 보이고 탭 이름은 Agent와 agent 이름이다", async () => {
  const fixture = withEarlierSession();
  const { view } = mount({
    agentView: fixture,
    layout: layoutOf(agentTab("agent-1", LOPHN_ID, SESSION)),
  });
  using _ = view;
  await flush();
  assert(view.container.querySelector("[data-agent-view]"));
  // 탭은 저장된 agent와 이 project 자리로 source를 얻는다.
  assert(
    fixture.asked.length >= 1 &&
      fixture.asked.every((item) =>
        item.assignment === LOPHN_ID &&
        item.place.kind === "project" && item.place.id === PROJECT
      ),
    JSON.stringify(fixture.asked),
  );
  // 같은 session의 대화가 돌아온다.
  assert(
    norm(one(view.container, "[data-agent-view]")).includes(
      "What did we settle last week?",
    ),
  );
  const tab = one(view.container, "[data-tab='agent-1']");
  assertEquals(tabTitle(tab), "lophn");
  assertEquals(norm(one(tab, "[data-kind-label]")), "Agent");
  // 이 탭 안에 agent를 바꾸는 길이 없다.
  assertEquals(
    all(one(view.container, "[data-agent-header]"), "select").length,
    0,
  );
});

Deno.test("shell/workspace#R7 [agent-I33c]: 없어진 agent의 탭은 다른 agent로 바뀌지 않고 agent가 없다는 안내를 보인다", async () => {
  const fixture = agentTabFixture();
  const gone = fixture.fake(RELEASE_ID);
  gone.source.agent = () => Promise.resolve({ ok: false, code: "not_found" });
  const { view } = mount({
    agentView: fixture,
    layout: layoutOf(agentTab("agent-1", RELEASE_ID, SESSION)),
  });
  using _ = view;
  await flush();
  assert(view.container.querySelector("[data-no-agent]"));
  assertEquals(
    fixture.asked.every((item) => item.assignment === RELEASE_ID),
    true,
  );
});

Deno.test("shell/workspace#R14 [agent-I33c]: Agent view의 통로가 없으면 탭은 준비되지 않았다는 안내만 보이고 sidebar 줄도 탭을 만들지 않는다", async () => {
  const { view, saved } = mount({
    agentView: false,
    layout: layoutOf(agentTab("agent-1", LOPHN_ID, SESSION)),
  });
  using _ = view;
  await flush();
  assertEquals(view.container.querySelector("[data-agent-view]"), null);
  const note = one(view.container, "[data-agent-not-ready]");
  assertEquals(norm(note), t("project-workspace.notice.agent-not-ready"));
  // 줄을 눌러도 이 통로 없이는 새 탭을 열지 않는다.
  const before = saved.length;
  click(sidebarRow(view.container, ENGINEER_ID));
  await flush();
  assertEquals(agentTabs(view.container).length, 1);
  assertEquals(saved.length, before);
});

Deno.test("shell/workspace#R6 shell/desktop#R37 [agent-I33c]: 첫 말을 보내 session이 생기면 그 session이 탭의 layout에 남는다", async () => {
  const fixture = agentTabFixture();
  const { view, saved } = mount({
    agentView: fixture,
    layout: layoutOf(agentTab("agent-1", LOPHN_ID)),
  });
  using _ = view;
  await flush();
  // 아직 말하지 않았으니 저장된 탭에는 session이 없다.
  assertEquals(
    lastTabs(saved).filter((tab) => "session" in tab),
    [],
  );
  await sendFirst(view.container, "Summarize the findings");
  const fake = fixture.fake(LOPHN_ID);
  assertEquals(fake.calls.opened.length, 1);
  assertEquals(fake.calls.sent.length, 1);
  const session = fake.calls.opened[0]!.id;
  assertEquals(lastTabs(saved), [agentTab("agent-1", LOPHN_ID, session)]);
});

Deno.test("shell/workspace#R34 [agent-I33c]: sidebar의 agent 줄은 그 agent의 Agent 탭을 열고 아직 말하지 않은 같은 agent 탭이 있으면 새로 만들지 않고 그 탭을 고른다", async () => {
  const fixture = agentTabFixture();
  const { view, saved } = mount({ agentView: fixture });
  using _ = view;
  await flush();
  click(sidebarRow(view.container, LOPHN_ID));
  await flush();
  assertEquals(agentTabs(view.container).length, 1);
  const first = agentTabs(view.container)[0]!;
  assertEquals(tabTitle(first), "lophn");
  assertEquals(first.getAttribute("aria-selected"), "true");
  assert(view.container.querySelector("[data-agent-view]"));
  // 대화 dock은 열리지 않는다.
  assertEquals(view.container.querySelector("[data-dock]"), null);
  const stored = lastTabs(saved);
  assertEquals(stored.length, 1);
  assertEquals(stored[0]!.kind, "agent");
  assertEquals(stored[0]!.agent, LOPHN_ID);
  assertEquals(stored[0]!.work_place, PLACE);
  assertEquals("session" in stored[0]!, false);

  // 다른 agent는 다른 탭이다.
  click(sidebarRow(view.container, ENGINEER_ID));
  await flush();
  assertEquals(agentTabs(view.container).map(tabTitle), [
    "lophn",
    "Context Engineer",
  ]);
  // 다시 누르면 새 탭 없이 그 agent의 탭을 고른다.
  click(sidebarRow(view.container, LOPHN_ID));
  await flush();
  assertEquals(agentTabs(view.container).length, 2);
  assertEquals(
    agentTabs(view.container).find((tab) =>
      tab.getAttribute("aria-selected") === "true"
    ) === first,
    true,
  );
});

Deno.test("shell/workspace#R34 shell/workspace#R33 [agent-I33c]: 이미 말한 session이 있는 agent 탭이 있으면 같은 agent 줄은 새 session을 가진 새 탭을 연다", async () => {
  const fixture = agentTabFixture();
  const { view } = mount({ agentView: fixture });
  using _ = view;
  await flush();
  click(sidebarRow(view.container, LOPHN_ID));
  await flush();
  await sendFirst(view.container, "Hello");
  click(sidebarRow(view.container, LOPHN_ID));
  await flush();
  assertEquals(agentTabs(view.container).map(tabTitle), ["lophn", "lophn"]);
  // 새 탭은 아직 session이 없는 새 session이다.
  assertEquals(
    norm(one(view.container, "[data-agent-header]")).includes("Hello"),
    false,
  );
  assertEquals(fixture.fake(LOPHN_ID).calls.opened.length, 1);
});

Deno.test("shell/workspace#R32 [agent-I33c]: 접힌 rail의 Agent 단추는 lophn의 Agent 탭을 연다", async () => {
  const fixture = agentTabFixture();
  const { view } = mount({ agentView: fixture, windowWidth: 800 });
  using _ = view;
  await flush();
  assertEquals(
    one(view.container, "[data-sidebar]").dataset.sidebar,
    "collapsed",
  );
  click(one(view.container, "[data-rail-action='agent']"));
  await flush();
  assertEquals(agentTabs(view.container).map(tabTitle), ["lophn"]);
  assertEquals(view.container.querySelector("[data-dock]"), null);
  assert(view.container.querySelector("[data-agent-view]"));
});

/** 계약 위반 수가 늘어 toast가 뜨는 contexts 통로. */
function violationContexts() {
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
  return { contexts, raise: () => raised = true };
}

Deno.test("shell/desktop#R35 shell/workspace#R29 [agent-I33c]: 위반 toast의 [Ask Context Engineer]는 위반된 context를 첫 chip으로 붙인 Context Engineer의 새 Agent 탭을 열고 아무것도 보내지 않는다", async () => {
  const fixture = agentTabFixture();
  const { contexts, raise } = violationContexts();
  const timer = manualTimer();
  const { view } = mount({ agentView: fixture, contexts, timer });
  using _ = view;
  await flush();
  raise();
  timer.advance(30_000);
  await flush();
  const toast = one(view.container, "[data-violation-toasts]");
  click(buttonNamed(toast, "Ask Context Engineer")!);
  await flush();
  assertEquals(agentTabs(view.container).map(tabTitle), ["Context Engineer"]);
  const chips = all(view.container, "[data-context-chip]");
  assertEquals(chips.length, 1);
  assertEquals(norm(chips[0]).includes("harness"), true);
  // 탭만 열었다. 사람이 보내기 전에는 session도 메시지도 없다.
  const fake = fixture.fake(ENGINEER_ID);
  assertEquals(fake.calls.opened, []);
  assertEquals(fake.calls.sent, []);
  // toast는 닫힌다.
  assertEquals(view.container.querySelector("[data-violation-toasts]"), null);
});

Deno.test("shell/desktop#R35 [agent-I33c]: [Ask]로 연 탭은 첫 chip을 가진 채 보내는 순간 그 chip이 session의 첫 context가 된다", async () => {
  const fixture = agentTabFixture();
  const { contexts, raise } = violationContexts();
  const timer = manualTimer();
  const { view, saved } = mount({ agentView: fixture, contexts, timer });
  using _ = view;
  await flush();
  raise();
  timer.advance(30_000);
  await flush();
  click(
    buttonNamed(
      one(view.container, "[data-violation-toasts]"),
      "Ask Context Engineer",
    )!,
  );
  await flush();
  await sendFirst(view.container, "Please look");
  const fake = fixture.fake(ENGINEER_ID);
  assertEquals(fake.calls.opened.length, 1);
  assertEquals(fake.calls.opened[0]!.contexts.map((chip) => chip.id), [
    HARNESS,
  ]);
  // chip은 저장하지 않는다. 저장되는 것은 session 참조뿐이다.
  const stored = lastTabs(saved).at(-1)!;
  assertEquals(stored.session, fake.calls.opened[0]!.id);
  assertEquals(JSON.stringify(stored).includes(HARNESS), false);
});

Deno.test("shell/desktop#R35 [agent-I33c]: Agent view의 통로가 없으면 위반 toast에는 [View]만 있다", async () => {
  const { contexts, raise } = violationContexts();
  const timer = manualTimer();
  const { view } = mount({ agentView: false, contexts, timer });
  using _ = view;
  await flush();
  raise();
  timer.advance(30_000);
  await flush();
  const toast = one(view.container, "[data-violation-toasts]");
  assertEquals(all(toast, "button").map(norm).includes("View"), true);
  assertEquals(buttonNamed(toast, "Ask Context Engineer"), null);
});

Deno.test("shell/workspace#R30 [agent-I33c]: Contexts 탭의 [New context]는 대화 dock이 아니라 Context Engineer의 Agent 탭을 열고 입력칸이 말할 거리를 안내한다", async () => {
  const fixture = agentTabFixture();
  const { view } = mount({ agentView: fixture });
  using _ = view;
  await flush();
  click(one(view.container, "[data-contexts-row]"));
  await flush();
  click(buttonNamed(view.container, "New context")!);
  await flush();
  assertEquals(view.container.querySelector("[data-dock]"), null);
  assertEquals(agentTabs(view.container).map(tabTitle), ["Context Engineer"]);
  assertEquals(
    composer(view.container).placeholder,
    t(
      "conversation.placeholder.new-context",
    ),
  );
  // 보내기 전에는 session도 없다.
  assertEquals(fixture.fake(ENGINEER_ID).calls.opened, []);
  // 누른 채 비어 있는 같은 탭이 있으면 다시 열지 않고 그 탭을 고른다.
  click(one(view.container, "[data-tab='contexts']"));
  await flush();
  click(buttonNamed(view.container, "New context")!);
  await flush();
  assertEquals(agentTabs(view.container).length, 1);
});

Deno.test("shell/workspace#R30 [agent-I33c]: [New context] 뒤 안내는 첫 말을 보내면 사라지고 그 session 탭이 layout에 남는다", async () => {
  const fixture = agentTabFixture();
  const { view, saved } = mount({ agentView: fixture });
  using _ = view;
  await flush();
  click(one(view.container, "[data-contexts-row]"));
  await flush();
  click(buttonNamed(view.container, "New context")!);
  await flush();
  await sendFirst(view.container, "Help me find experiments");
  const fake = fixture.fake(ENGINEER_ID);
  assertEquals(fake.calls.sent.length, 1);
  const stored = lastTabs(saved).find((tab) => tab.kind === "agent")!;
  assertEquals(stored.session, fake.calls.opened[0]!.id);
  // 말한 뒤에는 안내 문구가 입력칸을 차지하지 않는다.
  assertEquals(
    composer(view.container).placeholder === t(
      "conversation.placeholder.new-context",
    ),
    false,
  );
});

Deno.test("shell/workspace#R30 [agent-I33c]: [New context] 뒤에는 3초마다 목록을 읽어 만들어진 context의 drafting 탭을 남긴다", async () => {
  const base = createFakeContextsSource();
  let created = false;
  const contexts: ContextsSource = {
    ...base,
    list: async (project) => {
      const read = await base.list(project);
      return created && read.ok
        ? { ok: true, value: [...read.value, RELEASE_NOTES_ITEM] }
        : read;
    },
  };
  const timer = manualTimer();
  const { view } = mount({ contexts, timer });
  using _ = view;
  await flush();
  click(one(view.container, "[data-contexts-row]"));
  await flush();
  click(buttonNamed(view.container, "New context")!);
  await flush();
  assertEquals(
    tabKeys(view.container).filter((key) => key.startsWith("context:")),
    [],
  );
  created = true;
  timer.advance(3_000);
  await flush();
  assertEquals(
    tabKeys(view.container).filter((key) => key.startsWith("context:")),
    [`context:${RELEASE_NOTES}`],
  );
});

Deno.test("shell/workspace#R30 [agent-I33c]: Context 탭의 [Ask Context Engineer]도 대화 dock 대신 Context Engineer의 Agent 탭을 연다", async () => {
  const fixture = agentTabFixture();
  const { view } = mount({
    agentView: fixture,
    layout: layoutOf({
      kind: "context",
      key: `context:${EVAL}`,
      context: EVAL,
      // [Ask Context Engineer]는 Contract 하위 탭에 있다(R21).
      sub_tab: "contract",
    }),
  });
  using _ = view;
  await flush();
  click(buttonNamed(view.container, "Ask Context Engineer")!);
  await flush();
  assertEquals(view.container.querySelector("[data-dock]"), null);
  assertEquals(agentTabs(view.container).map(tabTitle), ["Context Engineer"]);
});

Deno.test("shell/workspace#R31 shell/workspace#R33 [agent-I33c]: view의 결과 링크는 문서 탭과 Context 탭을 열고 ⋯ 메뉴의 Close tab은 탭만 닫고 session은 남긴다", async () => {
  const fixture = withEarlierSession();
  const fake = fixture.fake(LOPHN_ID);
  fake.state.threads[SESSION] = {
    ...fake.state.threads[SESSION]!,
    entries: [
      ...fake.state.threads[SESSION]!.entries,
      {
        ...say(fake, 2, "agent", "Done."),
        results: [
          { kind: "context", context: EVAL },
          { kind: "document", document: "doc_notes" },
        ],
      },
    ],
  };
  fake.state.titles.doc_notes = "notes";
  const { view, saved } = mount({
    agentView: fixture,
    documents: [{ id: "doc_notes", title: "notes" }],
    layout: layoutOf(agentTab("agent-1", LOPHN_ID, SESSION)),
  });
  using _ = view;
  await flush();
  click(one(view.container, "[data-result-context]"));
  await flush();
  assert(tabKeys(view.container).includes(`context:${EVAL}`));
  click(one(view.container, "[data-tab='agent-1']"));
  await flush();
  click(one(view.container, "[data-result]"));
  await flush();
  assert(tabKeys(view.container).includes("doc_notes"));

  click(one(view.container, "[data-tab='agent-1']"));
  await flush();
  await openMore(view.container);
  await pickMore(4);
  await flush();
  assertEquals(tabKeys(view.container).includes("agent-1"), false);
  assertEquals(
    lastTabs(saved).some((tab) => tab.key === "agent-1"),
    false,
  );
  // session은 지워지지도 archive되지도 않았다.
  assertEquals(fake.calls.deleted.concat(fake.calls.archived), []);
  await unmountSettled(view);
});

Deno.test("shell/desktop#R48 [agent-I33c]: Fork가 만든 session은 같은 agent의 새 탭으로 열리고 원래 탭은 자기 session에 남는다", async () => {
  const fixture = withEarlierSession();
  const { view, saved } = mount({
    agentView: fixture,
    layout: layoutOf(agentTab("agent-1", LOPHN_ID, SESSION)),
  });
  using _ = view;
  await flush();
  await openMore(view.container);
  await pickMore(1);
  await flush();
  const fake = fixture.fake(LOPHN_ID);
  assertEquals(fake.calls.forked.length, 1);
  const forked = fake.calls.forked[0]!.id;
  const tabs = agentTabs(view.container);
  assertEquals(tabs.map(tabTitle), ["lophn", "lophn"]);
  const stored = lastTabs(saved);
  assertEquals(stored.map((tab) => tab.session), [SESSION, forked]);
  assertEquals(stored[1]!.agent, LOPHN_ID);
  assertEquals(stored[1]!.work_place, PLACE);
});

Deno.test("shell/desktop#R38 [agent-I33c]: 권한 요약은 Agents 탭으로, model picker의 Change defaults…는 lophn 공간의 설정으로 간다", async () => {
  const fixture = agentTabFixture();
  const opened: string[] = [];
  const { view } = mount({
    agentView: fixture,
    onLophn: () => opened.push("lophn"),
    layout: layoutOf(agentTab("agent-1", LOPHN_ID)),
  });
  using _ = view;
  await flush();
  click(one(view.container, "[data-composer-permissions]"));
  await flush();
  assert(tabKeys(view.container).includes("agents"));
  assertEquals(opened, []);
  click(one(view.container, "[data-tab='agent-1']"));
  await flush();
  click(one(view.container, "[data-model-button]"));
  await settle();
  click(
    buttonNamed(
      one(document.body, "[data-picker-section=defaults]"),
      "Change defaults…",
    )!,
  );
  assertEquals(opened, ["lophn"]);
  await unmountSettled(view);
});
