// agent-I34: Agents 탭 kind와 여는 길, 탭 안의 목록·Operator editor가 source로 읽고 쓰는 흐름(shell/workspace#R6, R14,
// R34, R36~R42). 화면 하나하나는 agents-tab_test·agent-editor_test가 보고 여기서는 작업대에 올려 열리는 탭,
// 저장되는 layout, source가 받는 명령을 본다.
import { assert, assertEquals } from "@std/assert";
import { act } from "react";
import {
  click,
  focus,
  one,
  pressAsync,
  render,
} from "../../../../../packages/design/components/testing.ts";

import { TAB_KINDS } from "../../../../../packages/contracts/shell/workspace.ts";
import { toStoredLayout, viewFromStored } from "../layout-map.ts";
import type { WorkspaceSource } from "../source.ts";
import { tabKindLabel, tabKindOf } from "../kinds/registry.ts";
import { layoutHint } from "../view-hint.ts";
import { Workspace } from "../workspace.tsx";
import { createFakeContextsSource, EVAL } from "../contexts/fake-source.ts";
import {
  all,
  buttonNamed,
  norm,
  settleReads,
  typeInto,
} from "../contexts/testing.tsx";
import {
  ANTHROPIC,
  createFakeAgentsSource,
  type FakeAgentsSource,
  LOPHN_ID,
  RELEASE_ID,
} from "./fake-source.ts";

const AGENTS_TAB = { kind: "agents", key: "agents" };
const flush = settleReads;

interface Options {
  readonly layout?: unknown;
  /** null이면 Agents 통로 없이 연다. */
  readonly agents?: FakeAgentsSource | null;
  readonly onProjectInstructions?: () => void;
  readonly onLophn?: () => void;
}

function mount(options: Options = {}) {
  const agents = options.agents === undefined
    ? createFakeAgentsSource()
    : options.agents;
  const saved: {
    panes: { tabs: Record<string, unknown>[]; selected_tab: string | null }[];
  }[] = [];
  const source: WorkspaceSource = {
    project: () =>
      Promise.resolve({
        ok: true,
        value: { id: "prj_1", title: "phroner", folders: [] },
      }),
    documents: () => Promise.resolve({ ok: true, value: [] }),
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
    contextsSource: createFakeContextsSource(),
    ...(agents === null ? {} : { agentsSource: agents }),
  };
  const view = render(
    <Workspace
      projectId="prj_1"
      source={source}
      windowWidth={1600}
      bodyWidth={1200}
      onLauncher={() => {}}
      onLophn={options.onLophn ?? (() => {})}
      onProjectInstructions={options.onProjectInstructions}
    />,
  );
  return { view, saved, agents };
}

function layoutOf(...tabs: Record<string, unknown>[]) {
  return {
    panes: [{ tabs, selected_tab: tabs[0]!.key }],
    split_ratio: 0.5,
    focused_pane: 0,
    information_panel: { open: false, tab: "info" },
  };
}

const tabKeys = (root: ParentNode) =>
  all(root, "[data-tab]").map((tab) => tab.dataset.tab);
const lastTabs = (saved: ReturnType<typeof mount>["saved"]) =>
  saved.at(-1)!.panes.flatMap((pane) => pane.tabs);
const cardNames = (root: ParentNode) =>
  all(root, "[data-agent-card] [data-agent-name]").map((name) => norm(name));
const sidebarNames = (root: ParentNode) =>
  all(root, "[data-agents] [data-agent] [data-agent-name]").map((name) =>
    norm(name)
  );

function field(root: ParentNode, name: string): HTMLElement {
  return one(root, `[data-field=${name}]`);
}

function input(root: ParentNode, label: string): HTMLElement {
  const found = all(root, "label").find((item) => norm(item) === label);
  if (!found) throw new Error(`no label ${label}`);
  return document.getElementById((found as HTMLLabelElement).htmlFor)!;
}

Deno.test("shell/workspace#R14 [agent-I34]: Agents kind는 registry에 올라 TAB_KINDS에 있고 이름과 열기 단추를 가진다", () => {
  assert((TAB_KINDS as readonly string[]).includes("agents"));
  const kind = tabKindOf("agents");
  assert(kind !== undefined, "agents is not registered");
  assertEquals(tabKindLabel("agents"), "Agents");
  assert(kind.icon);
  assert(kind.launcher !== undefined, "agents has no launcher");
});

Deno.test("shell/workspace#R6 [agent-I34]: Agents 탭은 열어 둔 agent와 함께 layout으로 저장되고 복원되며 파일에는 schema 필드만 남는다", () => {
  const stored = layoutOf({ ...AGENTS_TAB, agent: RELEASE_ID });
  const restored = viewFromStored(stored).view!;
  const tab = restored.panes[0]!.tabs[0]!;
  assertEquals(tab.kind, "agents");
  assertEquals(tab.fields, { agent: RELEASE_ID });
  const out = toStoredLayout({
    project: "prj_1",
    view: restored,
    informationPanel: { open: false, tab: "info" },
    lastSpace: "project",
  });
  assertEquals(out.panes[0]!.tabs, [{ ...AGENTS_TAB, agent: RELEASE_ID }]);
  assertEquals(JSON.stringify(out).includes("title"), false);

  // 열어 둔 agent가 없으면 필드도 없다.
  const plain = viewFromStored(layoutOf(AGENTS_TAB)).view!;
  assertEquals(
    toStoredLayout({
      project: "prj_1",
      view: plain,
      informationPanel: { open: false, tab: "info" },
      lastSpace: "project",
    }).panes[0]!.tabs,
    [AGENTS_TAB],
  );
});

Deno.test("shell/workspace#R6 [agent-I34]: 맞지 않는 agent id는 그 필드만 버리고 탭은 목록으로 남는다", () => {
  const view = viewFromStored(layoutOf({ ...AGENTS_TAB, agent: "nope" }))
    .view!;
  const tab = view.panes[0]!.tabs[0]!;
  assertEquals(tab.kind, "agents");
  assertEquals(tab.fields?.agent, undefined);
});

Deno.test("shell/workspace#R14 [agent-I34]: Agents 탭의 현재 보기 힌트는 kind와 key만 담고 열어 둔 agent는 담지 않는다", () => {
  const view = viewFromStored(layoutOf({ ...AGENTS_TAB, agent: RELEASE_ID }))
    .view!;
  const hint = layoutHint({ project: "prj_1", view, presentation: {} });
  assertEquals(hint.panes[0]!.tabs, [{ kind: "agents", key: "agents" }]);
});

Deno.test("shell/workspace#R34 [agent-I34]: sidebar의 Agents 묶음은 lophn · Context Engineer · Operator들 · Manage 순이고 Manage는 Agents 탭을 하나만 연다", async () => {
  const { view, saved } = mount();
  using _ = view;
  await flush();
  assertEquals(sidebarNames(view.container), [
    "lophn",
    "Context Engineer",
    "Release notes",
  ]);
  const manage = one(view.container, "[data-agents-manage]");
  assertEquals(norm(manage), "Manage");
  click(manage);
  await flush();
  assertEquals(tabKeys(view.container), ["agents"]);
  // 다시 눌러도 탭은 하나다.
  click(manage);
  await flush();
  assertEquals(tabKeys(view.container), ["agents"]);
  assertEquals(lastTabs(saved), [AGENTS_TAB]);
});

Deno.test("shell/workspace#R14 [agent-I34]: 탭 줄 `+`의 Agents 단추도 같은 탭을 연다", async () => {
  const { view } = mount();
  using _ = view;
  await flush();
  const opener = one(view.container, "[data-pane] button[data-open-agents]");
  click(opener);
  await flush();
  assertEquals(tabKeys(view.container), ["agents"]);
  click(one(view.container, "[data-agents-manage]"));
  await flush();
  assertEquals(tabKeys(view.container), ["agents"]);
});

Deno.test("shell/workspace#R14 [agent-I34]: Agents 통로가 없으면 Agents 묶음도 열기 단추도 없다", async () => {
  const { view } = mount({ agents: null });
  using _ = view;
  await flush();
  assertEquals(view.container.querySelector("[data-agents]"), null);
  assertEquals(
    view.container.querySelector("[data-pane] button[data-open-agents]"),
    null,
  );
});

Deno.test("shell/workspace#R36 [agent-I34]: 탭은 source가 준 agent를 카드로 그리고 카드마다 이름·종류·model·개수를 보인다", async () => {
  const { view } = mount({ layout: layoutOf(AGENTS_TAB) });
  using _ = view;
  await flush();
  assertEquals(cardNames(view.container), [
    "lophn",
    "Context Engineer",
    "Release notes",
  ]);
  const release = one(
    view.container,
    `[data-agent-card][data-assignment='${RELEASE_ID}']`,
  );
  assertEquals(norm(one(release, "[data-agent-kind]")), "Operator");
  assertEquals(
    norm(one(release, "[data-agent-counts]")),
    "1 context · 1 skill · 1 MCP",
  );
  assert(buttonNamed(view.container, "New Operator"));
  // 구역은 source가 읽어 준 값이다.
  assert(
    norm(one(view.container, "[data-instructions-preview]")).startsWith(
      "# phroner",
    ),
  );
  assertEquals(
    all(view.container, "section[data-section=mcp] label").map((item) =>
      norm(item)
    ),
    ["github", "linear"],
  );
});

Deno.test("shell/workspace#R38 [agent-I34]: Open은 같은 탭 안에서 그 agent의 editor를 열고 layout에 남기며 Cancel은 목록으로 돌아가 필드를 지운다", async () => {
  const { view, saved } = mount({ layout: layoutOf(AGENTS_TAB) });
  using _ = view;
  await flush();
  click(one(view.container, `[data-assignment='${RELEASE_ID}'] button`));
  await flush();
  assertEquals(tabKeys(view.container), ["agents"]);
  // 정의의 이름이 Name 칸에 들어 있다.
  assertEquals(
    (input(field(view.container, "name"), "Name") as HTMLInputElement).value,
    "Release notes",
  );
  assertEquals(view.container.querySelector("[data-agent-card]"), null);
  assertEquals(lastTabs(saved), [{ ...AGENTS_TAB, agent: RELEASE_ID }]);

  click(buttonNamed(view.container, "Cancel")!);
  await flush();
  assertEquals(cardNames(view.container).length, 3);
  assertEquals(lastTabs(saved), [AGENTS_TAB]);
});

Deno.test("shell/workspace#R6 [agent-I34]: 복원한 Agents 탭은 저장된 agent의 editor를 다시 연다", async () => {
  const { view } = mount({
    layout: layoutOf({ ...AGENTS_TAB, agent: RELEASE_ID }),
  });
  using _ = view;
  await flush();
  assertEquals(
    (input(field(view.container, "name"), "Name") as HTMLInputElement).value,
    "Release notes",
  );
});

Deno.test("shell/workspace#R6 [agent-I34]: 복원한 agent가 이미 없으면 목록을 보인다", async () => {
  const { view } = mount({
    layout: layoutOf({
      ...AGENTS_TAB,
      agent: "asg_0000000000000000000000000z",
    }),
  });
  using _ = view;
  await flush();
  assertEquals(cardNames(view.container).length, 3);
});

Deno.test("shell/workspace#R38 [agent-I34]: 새 Operator를 Name·Instructions만 채워 Save하면 확인 없이 저장되어 목록과 sidebar에 나타난다", async () => {
  const { view, saved, agents } = mount({ layout: layoutOf(AGENTS_TAB) });
  using _ = view;
  await flush();
  click(buttonNamed(view.container, "New Operator")!);
  await flush();
  // 첫 저장 전이라 id가 없고 Upload image는 꺼져 있다.
  assertEquals(
    (buttonNamed(view.container, "Upload image") as HTMLButtonElement)
      .disabled,
    true,
  );
  assertEquals(buttonNamed(view.container, "Delete Operator"), null);
  typeInto(input(field(view.container, "name"), "Name"), "Weekly digest");
  typeInto(
    one(field(view.container, "instructions"), "textarea"),
    "Summarize the week.",
  );
  click(buttonNamed(view.container, "Save")!);
  await flush();

  assertEquals(document.querySelector("[role=dialog]"), null);
  assertEquals(agents!.calls.filter((call) => call.method === "saveAgent"), [
    {
      method: "saveAgent",
      assignment: null,
      hash: null,
      definition: { name: "Weekly digest", body: "Summarize the week." },
    },
  ]);
  assertEquals(cardNames(view.container), [
    "lophn",
    "Context Engineer",
    "Release notes",
    "Weekly digest",
  ]);
  assertEquals(sidebarNames(view.container).at(-1), "Weekly digest");
  // editor를 닫았으니 layout에 agent 필드는 없다.
  assertEquals(lastTabs(saved), [AGENTS_TAB]);
});

Deno.test("shell/workspace#R24 [agent-I34]: 저장이 거절되면 항목별 이유가 그 칸에 보이고 editor와 고친 값은 그대로 남는다", async () => {
  const agents = createFakeAgentsSource();
  agents.failNextSave([{ field: "name", code: "reserved_name" }]);
  const { view } = mount({ layout: layoutOf(AGENTS_TAB), agents });
  using _ = view;
  await flush();
  click(buttonNamed(view.container, "New Operator")!);
  await flush();
  typeInto(input(field(view.container, "name"), "Name"), "lophn");
  click(buttonNamed(view.container, "Save")!);
  await flush();

  const name = field(view.container, "name");
  assertEquals(
    norm(one(name, "[data-issue=reserved_name]")),
    "This name is reserved.",
  );
  assertEquals((input(name, "Name") as HTMLInputElement).value, "lophn");
  assertEquals(cardNames(view.container), []);
  // 고치고 다시 저장하면 거절 표시가 사라지고 저장된다.
  typeInto(input(name, "Name"), "Digest");
  click(buttonNamed(view.container, "Save")!);
  await flush();
  assertEquals(cardNames(view.container).at(-1), "Digest");
});

Deno.test("shell/workspace#R38 [agent-I34]: 저장이 issue 없이 실패하면 알림을 보이고 editor에 머문다", async () => {
  const agents = createFakeAgentsSource();
  agents.failNextSave([], "conflict");
  const { view } = mount({ layout: layoutOf(AGENTS_TAB), agents });
  using _ = view;
  await flush();
  click(buttonNamed(view.container, "New Operator")!);
  await flush();
  typeInto(input(field(view.container, "name"), "Name"), "Digest");
  click(buttonNamed(view.container, "Save")!);
  await flush();
  assert(view.container.querySelector("[role=alert]"), "no failure notice");
  assert(view.container.querySelector("[data-field=name]"));
  assertEquals(cardNames(view.container), []);
});

Deno.test("shell/workspace#R38 [agent-I34]: 있는 Operator를 고쳐 Save하면 그 assignment와 읽을 때의 hash로 저장하고 바꾼 칸만 정의에 든다", async () => {
  const { view, agents } = mount({ layout: layoutOf(AGENTS_TAB) });
  using _ = view;
  await flush();
  const openedHash = agents!.hashOf(RELEASE_ID);
  click(one(view.container, `[data-assignment='${RELEASE_ID}'] button`));
  await flush();
  typeInto(input(field(view.container, "name"), "Name"), "Release notes v2");
  click(buttonNamed(view.container, "Save")!);
  await flush();
  const calls = agents!.calls.filter((call) => call.method === "saveAgent");
  assertEquals(calls.length, 1);
  const call = calls[0]!;
  assert(call.method === "saveAgent");
  assertEquals(call.assignment, RELEASE_ID);
  assertEquals(call.hash, openedHash);
  assertEquals(call.definition.name, "Release notes v2");
  // 사람이 바꾸지 않은 칸(model·profile)은 정의에 없다.
  assertEquals(call.definition.model, undefined);
  assertEquals(cardNames(view.container).at(-1), "Release notes v2");
});

Deno.test("shell/workspace#R38 [agent-I34]: Delete Operator는 확인을 한 번 받은 뒤 지우고 카드와 sidebar 줄이 사라진다", async () => {
  const { view, agents } = mount({ layout: layoutOf(AGENTS_TAB) });
  using _ = view;
  await flush();
  const hash = agents!.hashOf(RELEASE_ID);
  click(one(view.container, `[data-assignment='${RELEASE_ID}'] button`));
  await flush();
  click(buttonNamed(view.container, "Delete Operator")!);
  await flush();
  assertEquals(
    agents!.calls.filter((call) => call.method === "deleteAgent"),
    [],
  );
  const dialog = one(document.body, "[role=dialog]");
  click(buttonNamed(dialog, "Delete")!);
  await flush();
  assertEquals(agents!.calls.filter((call) => call.method === "deleteAgent"), [
    {
      method: "deleteAgent",
      assignment: RELEASE_ID,
      hash,
    },
  ]);
  assertEquals(cardNames(view.container), ["lophn", "Context Engineer"]);
  assertEquals(sidebarNames(view.container), ["lophn", "Context Engineer"]);
});

Deno.test("shell/workspace#R42 [agent-I34]: Add context는 contexts source의 이 project context 가운데 아직 붙이지 않은 것을 보이고 저장하면 정의의 contexts에 든다", async () => {
  const { view, agents } = mount({ layout: layoutOf(AGENTS_TAB) });
  using _ = view;
  await flush();
  click(buttonNamed(view.container, "New Operator")!);
  await flush();
  typeInto(input(field(view.container, "name"), "Name"), "Digest");
  const contexts = field(view.container, "contexts");
  const trigger = buttonNamed(contexts, "Add context")!;
  focus(trigger);
  await pressAsync(trigger, "Enter");
  const items = [...document.querySelectorAll("[role=menuitem]")];
  assertEquals(items.map((item) => norm(item)), ["eval", "harness"]);
  click(items[0]!);
  await flush();
  assertEquals(
    all(contexts, "[data-context]").map((chip) => chip.dataset.context),
    [EVAL],
  );
  click(buttonNamed(view.container, "Save")!);
  await flush();
  const call = agents!.calls.find((item) => item.method === "saveAgent")!;
  assert(call.method === "saveAgent");
  assertEquals(call.definition.contexts, [EVAL]);
});

Deno.test("shell/workspace#R41 [agent-I34]: editor의 Model 칸은 상속한 model을 보이고 다른 model을 고르면 Changed가 붙어 저장하면 정의에 model이 든다", async () => {
  const { view, agents } = mount({ layout: layoutOf(AGENTS_TAB) });
  using _ = view;
  await flush();
  click(buttonNamed(view.container, "New Operator")!);
  await flush();
  typeInto(input(field(view.container, "name"), "Name"), "Digest");
  const model = field(view.container, "model");
  assert(
    norm(one(model, "[data-model-inherit]")).includes("Sonnet 5.5 · Medium"),
  );
  click(one(model, "[data-model-button]"));
  await flush();
  click(one(document.body, "[role=option][data-model='Haiku 5.5']"));
  await flush();
  assert(model.querySelector("[data-model-changed]"), "no Changed mark");
  click(buttonNamed(view.container, "Save")!);
  await flush();
  const call = agents!.calls.find((item) => item.method === "saveAgent")!;
  assert(call.method === "saveAgent");
  assertEquals(call.definition.model, {
    provider: ANTHROPIC,
    model_name: "Haiku 5.5",
    option_values: {},
  });
});

Deno.test("shell/workspace#R37 [agent-I34]: Models for this project에서 role의 model을 고르면 source가 받고 줄에 overrides가 붙으며 Use Workspace default가 비운다", async () => {
  const { view, agents } = mount({ layout: layoutOf(AGENTS_TAB) });
  using _ = view;
  await flush();
  const row = () =>
    one(view.container, "[data-role-model][data-role=operator]");
  assertEquals(
    norm(one(row(), "[data-role-model-line]")),
    "Use Workspace default (Sonnet 5.5 · Medium)",
  );
  click(one(row(), "[data-model-button]"));
  await flush();
  click(one(document.body, "[role=option][data-model='Haiku 5.5']"));
  await flush();
  assertEquals(
    agents!.calls.filter((call) => call.method === "changeRoleModel"),
    [{
      method: "changeRoleModel",
      role: "operator",
      choice: {
        provider: ANTHROPIC,
        model_name: "Haiku 5.5",
        option_values: {},
      },
    }],
  );
  assertEquals(
    norm(one(row(), "[data-role-model-line]")),
    "Haiku 5.5 · overrides Workspace",
  );
  click(buttonNamed(row(), "Use Workspace default")!);
  await flush();
  assertEquals(
    agents!.calls.filter((call) => call.method === "changeRoleModel").at(-1),
    { method: "changeRoleModel", role: "operator", choice: null },
  );
  assertEquals(
    norm(one(row(), "[data-role-model-line]")),
    "Use Workspace default (Sonnet 5.5 · Medium)",
  );
});

Deno.test("shell/workspace#R37 [agent-I34]: MCP server 켬·끔은 source로 가고 줄이 따라가며 실패하면 줄은 그대로고 알림이 보인다", async () => {
  const { view, agents } = mount({ layout: layoutOf(AGENTS_TAB) });
  using _ = view;
  await flush();
  const control = (name: string) => {
    const label = all(
      one(view.container, "section[data-section=mcp]"),
      "label",
    ).find((item) => norm(item) === name)!;
    return document.getElementById((label as HTMLLabelElement).htmlFor)!;
  };
  assertEquals(control("linear").getAttribute("aria-checked"), "false");
  click(control("linear"));
  await flush();
  assertEquals(agents!.calls.filter((call) => call.method === "setMcp"), [
    { method: "setMcp", name: "linear", on: true },
  ]);
  assertEquals(control("linear").getAttribute("aria-checked"), "true");

  agents!.failNextChange("unavailable");
  click(control("github"));
  await flush();
  assertEquals(control("github").getAttribute("aria-checked"), "true");
  assert(view.container.querySelector("[role=alert]"), "no failure notice");
});

Deno.test("shell/workspace#R37 [agent-I34]: Instructions의 Edit는 작업대의 project 지침 진입을 부르고 통로가 없으면 아무것도 하지 않는다", async () => {
  const calls: string[] = [];
  const { view } = mount({
    layout: layoutOf(AGENTS_TAB),
    onProjectInstructions: () => calls.push("instructions"),
  });
  using _ = view;
  await flush();
  click(
    buttonNamed(
      one(view.container, "section[data-section=instructions]"),
      "Edit",
    )!,
  );
  assertEquals(calls, ["instructions"]);
});

Deno.test("shell/workspace#R37 [agent-I34]: 탭 본문을 읽지 못하면 오류와 다시 시도를 보이고 다시 시도하면 읽는다", async () => {
  const agents = createFakeAgentsSource();
  agents.failNextOverview("unavailable");
  const { view } = mount({ layout: layoutOf(AGENTS_TAB), agents });
  using _ = view;
  await flush();
  assertEquals(view.container.querySelector("[data-agent-card]"), null);
  assertEquals(
    norm(one(view.container, "[data-state=error]")).startsWith(
      "Couldn't load",
    ),
    true,
  );
  const retry = buttonNamed(view.container, "Reload");
  assert(retry, "no retry button");
  click(retry);
  await flush();
  assertEquals(cardNames(view.container).length, 3);
});

Deno.test("shell/workspace#R38 [agent-I34]: lophn의 Open도 같은 editor이고 Name은 고정 글자이며 Contexts 칸과 Delete가 없다", async () => {
  const { view } = mount({ layout: layoutOf(AGENTS_TAB) });
  using _ = view;
  await flush();
  click(one(view.container, `[data-assignment='${LOPHN_ID}'] button`));
  await flush();
  assertEquals(norm(one(view.container, "[data-fixed-name]")), "lophn");
  assertEquals(view.container.querySelector("[data-field=contexts]"), null);
  assertEquals(buttonNamed(view.container, "Delete Operator"), null);
  act(() => {});
});
