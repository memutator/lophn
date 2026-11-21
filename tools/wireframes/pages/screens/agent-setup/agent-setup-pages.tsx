// agent 설정 묶음의 page들. 동작하는 ProjectApp(과 Settings) 위에 상태 하나를 고정해 놓는다.
import { type MessageKey, t } from "@lophn/i18n";
import { useMemo, useState } from "react";

import { appList } from "../../../../../packages/protocol/apps/apps.ts";
import { appTools } from "../../../../../packages/protocol/apps/declaration/read.ts";
import {
  createFakeSource,
  fakeAnswer,
} from "../../../../../packages/shell/renderer/desktop/connection/events/fake-source.ts";
import { MachinesProvider } from "../../../../../packages/shell/renderer/desktop/machines/context.tsx";
import type {
  MachineData,
  MachineHub,
} from "../../../../../packages/shell/renderer/desktop/machines/data.ts";
import { MachineHubProvider } from "../../../../../packages/shell/renderer/desktop/machines/scope.tsx";
import { fakeMachines } from "../../../../../packages/shell/renderer/desktop/machines/testdata/fake-source.ts";
import { COMPUTER_APPS } from "../../../../../packages/shell/renderer/workspace/agents/fake-data.ts";
import { OPENAI } from "../../../../../packages/shell/renderer/desktop/settings/providers/testdata/fake-providers.ts";
import {
  ANTHROPIC,
  BROKEN_AGENT_ID,
  BUDGET_REVIEWER_ID,
  CODEX_RUNNER_ID,
  EVAL_ANALYST_ID,
  EXPERIMENT_PLANNER_ID,
  createFakeAgentsSource,
  type FakeAgentsOptions,
  HOME_LOPHN_ID,
  PROJECT_LOPHN_ID,
  QUEUE_WATCHER_ID,
} from "../../../../../packages/shell/renderer/workspace/agents/fake-source.ts";
import { AgentsPage } from "../../../../../packages/shell/renderer/workspace/agents/agents-page.tsx";
import { AgentsTabs } from "../../../../../packages/shell/renderer/workspace/agents/tab-state.ts";
import {
  AGENTS_TAB_SPEC,
  AgentSettingsEditor,
  AgentsBody,
  type AgentsAt,
  FakeAgentEvents,
  agentTab,
} from "../agents-tab.tsx";
import { ProjectApp } from "../project-app.tsx";
import type { TabSpec } from "../project-window.tsx";
import { SettingsFrame } from "../settings-frame.tsx";
import { Driven } from "../../../mock/driven.tsx";
import { click, find, press, type Step, type } from "../../../mock/drive.ts";

const SIDEBAR = { foldersClosed: true } as const;

// 탭 하나만 열린 project 창.
function alone(tab: TabSpec) {
  return (
    <ProjectApp
      sidebar={SIDEBAR}
      panes={[{ tabs: [tab], selected: tab.key }]}
    />
  );
}

// agent 설정 화면을 직접 그린 탭. steps는 mount 뒤에 눌러 상태를 고정한다.
function editor(
  id: string,
  steps: readonly Step[] = [],
  source?: FakeAgentsOptions,
  workspace: AgentsAt = "project",
) {
  return alone({
    ...agentTab(id),
    body: (
      <AgentSettingsEditor
        id={id}
        workspace={workspace}
        onDone={() => {}}
        steps={steps}
        source={source}
      />
    ),
  });
}

// editor의 탭 하나를 고른다. 칸은 탭마다 따로 있어서 그 칸을 보이려면 먼저 고른다.
const tab =
  (label: MessageKey): Step =>
  () =>
    press("[role=tab]", t(label));
const GRANTS_TAB = tab("agents.label.tab-grants");

/** project의 Agents 탭. 탭 줄의 + menu에서 연다. */
export const ProjectAgentsPage = () => alone(AGENTS_TAB_SPEC);

// Home이나 앱의 Agents 탭. 같은 화면이 그 workspace의 층을 읽는다.
const agentsAt = (
  at: AgentsAt,
  title: string,
  source?: FakeAgentsOptions,
  steps: readonly Step[] = [],
) =>
  alone({
    ...AGENTS_TAB_SPEC,
    title,
    body: <AgentsBody at={at} source={source} steps={steps} />,
  });

/** Home의 Agents 탭. 목록은 모든 agent(전역과 project·앱 범위)이고 카드마다 범위가 보인다. Home lophn 카드의 범위는 Home이고, Home의 지침(LOPHN.md)·memory·model·skill·MCP 층이 있다. */
export const HomeAgentsPage = () => agentsAt("home", "Home · Agents");

/** Home 목록에서 project 범위 agent를 열었다. editor는 그 agent의 workspace(phroner)로 열린다. */
export const HomeAgentsOpenScopedPage = () => {
  const [agent, setAgent] = useState<string | null>(EXPERIMENT_PLANNER_ID);
  const source = useMemo(() => createFakeAgentsSource(), []);
  const tabs = useMemo(() => new AgentsTabs(), []);
  return alone({
    ...AGENTS_TAB_SPEC,
    title: "Home · Agents",
    body: (
      <FakeAgentEvents source={source}>
        <AgentsPage
          workspace="home"
          workspaceName="Home"
          source={source}
          tabKey="agents"
          tabs={tabs}
          agent={agent}
          onAgent={setAgent}
          askLeave={() => Promise.resolve(true)}
          onAddExtension={() => {}}
        />
      </FakeAgentEvents>
    ),
  });
};

/** 앱의 Agents 탭. 지침은 앱 source의 AGENTS.md다. */
export const AppAgentsPage = () => agentsAt("app", "Budget tracker · Agents");

/** source를 잇지 않은 앱의 Agents 탭. AGENTS.md 칸이 비어 있고 [Edit]이 없다. */
export const AppAgentsNoSourcePage = () =>
  agentsAt("app", "Budget tracker · Agents", { appHasSource: false });

// 칸을 창 위로 올려 보인다. editor가 길어서 아래 칸은 열자마자 잘린다.
const scrollTo =
  (selector: string, block: ScrollLogicalPosition = "start"): Step =>
  async () =>
    (await find(selector)).scrollIntoView({ block });

/** custom agent의 설정. runtime이 custom이라 Tools 칸에서 tool을 체크로 고르고 skill도 고른 것만 받는다. skill 하나를 더 골랐다. */
export const AgentEditorCustomPage = () =>
  editor(QUEUE_WATCHER_ID, [
    tab("agents.label.tab-skills"),
    () => click(`[data-skill="plain-writing"] [role=switch]`),
  ]);

/** custom agent의 Tools 탭. 내장 tool을 체크로 고르고 lophn 명령·앱 command·MCP tool은 이름을 적어 더한다. 아래에 MCP servers와 Shell extensions가 이어진다. */
export const AgentToolsTabPage = () =>
  editor(QUEUE_WATCHER_ID, [tab("agents.label.tab-tools")]);

/** Runtime 탭. runtime을 고르고 model은 대화와 같은 picker로 고른다(위 층이 정한 값이면 따르기 줄이 맨 위다). */
export const AgentRuntimeTabPage = () =>
  editor(EVAL_ANALYST_ID, [tab("agents.label.tab-runtime")]);

/** Instructions 탭. workspace 지침(이 자리에서 고친다)과 이 agent의 지침을 같이 보인다. */
export const AgentInstructionsTabPage = () =>
  editor(EVAL_ANALYST_ID, [tab("agents.label.tab-instructions")]);

/** Memory 탭. 이 agent의 memory(8 KiB 대비 크기와 [Edit]). */
export const AgentMemoryTabPage = () =>
  editor(EVAL_ANALYST_ID, [tab("agents.label.tab-memory")]);

/** Agents 탭에서 agent를 열고 이름을 고친 상태. 위쪽 ← →가 목록으로 돌아가는 길이고, 저장하지 않은 편집은 탭 줄에 표시가 뜬다. */
export const AgentsOpenedEditedPage = () =>
  agentsAt("project", "phroner · Agents", undefined, [
    () =>
      click(
        "[data-agent-card] button",
        t("project-workspace.button.open-agent"),
        1,
      ),
    () => type("[data-field=name] input", "Eval analyst (draft)"),
  ]);

/** harness runtime(Codex) agent의 설정. 지침은 있고 model·tool·skill·MCP 칸이 없다. */
export const AgentEditorHarnessPage = () =>
  editor(CODEX_RUNNER_ID, [tab("agents.label.tab-runtime")]);

/** Delete agent를 눌러 확인 창이 뜬 상태. 확인을 한 번 받은 뒤에만 지운다. */
export const AgentDeleteConfirmPage = () =>
  editor(EVAL_ANALYST_ID, [
    () => press("button", t("project-workspace.button.agent-editor-delete")),
  ]);

/** Delete를 확인했는데 그 사이 정의가 바뀌어(hash가 달라) 지워지지 않고 toast가 뜬 상태. */
export const AgentDeleteFailedPage = () =>
  editor(
    EVAL_ANALYST_ID,
    [
      () => press("button", t("project-workspace.button.agent-editor-delete")),
      () =>
        click(
          "[role=dialog] button",
          t("project-workspace.button.agent-editor-delete-confirm"),
        ),
    ],
    { deleteFails: "conflict" },
  );

/** 저장이 거절되어 항목별 이유가 그 칸 안에 붙은 상태. 이 form에서 저장한 것은 바뀌지 않았다. */
export const AgentSaveIssuesPage = () =>
  editor(
    EVAL_ANALYST_ID,
    [
      () => click("button", /^Save$/),
      tab("agents.label.tab-tools"),
      scrollTo("[data-field=mcp]", "end"),
    ],
    {
      saveFails: {
        issues: [
          { field: "skills.0", code: "unknown" },
          { field: "mcp_servers.1.name", code: "reserved_name" },
        ],
      },
    },
  );

/** 다른 창이 먼저 저장해 hash가 달라서 저장이 conflict로 거절되고 toast가 뜬 상태. */
export const AgentSaveConflictPage = () =>
  editor(EVAL_ANALYST_ID, [() => click("button", /^Save$/)], {
    saveFails: { issues: [], code: "conflict" },
  });

// 숨은 file input에 이미지 파일 하나를 골라 준다.
const pickImage: Step = async () => {
  const input = await find<HTMLInputElement>("input[type=file]");
  const transfer = new DataTransfer();
  transfer.items.add(new File(["png"], "avatar.png", { type: "image/png" }));
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
};

/** 사람이 만든 agent의 profile 이미지를 올려 character 대신 그 이미지가 profile로 보이는 상태(저장 전). */
export const AgentImageUploadedPage = () =>
  editor(QUEUE_WATCHER_ID, [pickImage]);

/** 이미지 올리기가 거절되어 toast가 뜬 상태. profile은 그대로다. */
export const AgentImageUploadFailedPage = () =>
  editor(QUEUE_WATCHER_ID, [pickImage], { uploadFails: true });

/** 정의 file이 틀린 agent가 있는 Agents 탭. 그 줄은 개수 대신 "can't be counted"를 보이고 명함이 없다. */
export const AgentsBrokenPage = () =>
  agentsAt("project", "phroner · Agents", { brokenAgent: true }, [
    scrollTo(`[data-assignment="${BROKEN_AGENT_ID}"]`, "end"),
  ]);

/** 틀린 정의 file의 agent를 연 설정. 틀린 칸(frontmatter)의 이유가 form 밑에 붙는다. */
export const AgentEditorBrokenPage = () =>
  alone({
    key: `agent-edit:${BROKEN_AGENT_ID}`,
    kind: "agent-settings",
    title: "Broken notes",
    sub: BROKEN_AGENT_ID,
    body: (
      <AgentSettingsEditor
        id={BROKEN_AGENT_ID}
        onDone={() => {}}
        steps={[scrollTo("[data-field=skip]", "end")]}
        source={{ brokenAgent: true }}
      />
    ),
  });

/** agent의 Model 칸 picker를 연 상태. project 층에 고른 model이 있어 맨 위 줄이 "Use workspace default — Haiku 5.5"다. */
export const AgentModelPickerPage = () =>
  editor(
    EVAL_ANALYST_ID,
    [
      tab("agents.label.tab-runtime"),
      // 목록이 창 아래로 잘리지 않게 Model 칸을 위로 올린 뒤 연다.
      async () =>
        (await find("[data-model-field]")).scrollIntoView({ block: "start" }),
      () => click("[data-model-field] [data-model-button]"),
    ],
    {
      workspaceModel: {
        provider: ANTHROPIC,
        model_name: "Haiku 5.5",
        option_values: {},
      },
    },
  );

/** 새 agent를 만든다. */
export const AgentCreatePage = () => editor("new");

/** project의 lophn 설정. profile과 handle이 잠기고 Delete가 없다. */
export const LophnEditorPage = () => editor(PROJECT_LOPHN_ID);

/** 앱 자리에서 연 agent의 설정. 앱 source의 AGENTS.md가 workspace 지침으로 보인다. */
export const AppWorkspaceEditorPage = () =>
  editor(BUDGET_REVIEWER_ID, [], undefined, "app");

/** Home lophn의 설정. 범위가 Home으로 보이고 workspace memory는 Agents 탭에서 고친다. */
export const HomeLophnEditorPage = () =>
  editor(HOME_LOPHN_ID, [], undefined, "home");

/** agent 층에서 MCP server를 더하는 form을 열고 web 주소와 OAuth 2.1 로그인을 고른 상태. */
export const AgentServerFormPage = () =>
  editor(EVAL_ANALYST_ID, [
    tab("agents.label.tab-tools"),
    () => press("[data-field=mcp] button", t("settings.button.add-server")),
    () => press("[data-server-field=transport] [role=combobox]"),
    () => click("[role=option]", t("settings.label.over-web")),
    () => press("[data-server-field=auth] [role=combobox]"),
    () => click("[role=option]", t("agents.label.auth-oauth2")),
    () => type("[data-server-field=issuer]", "https://mcp.notion.com"),
    () => type("[data-server-field=client-id]", "notion-client"),
    () => type("[data-server-field=scopes]", "read write"),
  ]);

/** Grants 탭. 붙인 앱과 앱마다 뺀 tool. MCP server는 설정한 층이 할당이라 한 줄 안내만 있다. */
export const AgentGrantsPage = () => editor(EVAL_ANALYST_ID, [GRANTS_TAB]);

/** Grants 탭에서 앱 하나를 펼친 상태. */
export const AgentGrantsAppPage = () =>
  editor(EVAL_ANALYST_ID, [
    GRANTS_TAB,
    () => press(`[data-grant-card="Budget tracker"] button[aria-expanded]`),
  ]);

// 연결된 다른 컴퓨터의 core. 앱 목록과 선언을 그 컴퓨터가 답하는 것처럼 fake data로 준다(화면은 진짜 읽기 길을 탄다).
function computersHub(): MachineHub {
  const cores = new Map<string, MachineData>();
  const loose = <T,>(value: unknown) => value as T;
  return {
    get(machine) {
      let found = cores.get(machine ?? "");
      if (found === undefined) {
        const apps = COMPUTER_APPS[machine ?? ""] ?? [];
        const core = createFakeSource({
          snapshots: [],
          consents: [],
          answers: [
            fakeAnswer(appList, () =>
              loose({
                apps: apps.map((app) => ({
                  id: app.app,
                  name: app.name,
                  status: "active",
                })),
              }),
            ),
            fakeAnswer(appTools, ({ app }) =>
              loose({
                tools: (apps.find((one) => one.app === app)?.tools ?? []).map(
                  (tool) => ({
                    name: tool.tool,
                    description: tool.detail,
                    effect: tool.effect,
                    public: tool.public,
                  }),
                ),
              }),
            ),
          ],
        });
        found = { machine, core } as unknown as MachineData;
        cores.set(machine ?? "", found);
      }
      return found;
    },
    stop: () => {},
  };
}

/**
 * Grants 탭의 Other computers 묶음. Home server(연결됨)의 Weekly report는 펼쳐 command마다 고르고(비공개 command는 목록에 없다),
 * 꺼진 Work laptop의 앱은 저장된 이름과 꺼짐 표시로 남는다. 둘 다 빼기는 된다.
 */
export const AgentGrantsOtherComputerPage = () => {
  const [machines] = useState(() => fakeMachines().source);
  const [hub] = useState(computersHub);
  return alone({
    ...agentTab(EXPERIMENT_PLANNER_ID),
    body: (
      <MachineHubProvider hub={hub}>
        <MachinesProvider source={machines}>
          <AgentSettingsEditor
            id={EXPERIMENT_PLANNER_ID}
            workspace="project"
            onDone={() => {}}
            steps={[
              GRANTS_TAB,
              () =>
                press(
                  `[data-grant-card="Weekly report"] button[aria-expanded]`,
                ),
            ]}
          />
        </MachinesProvider>
      </MachineHubProvider>
    ),
  });
};

/** Settings › Agents. 전역 기본 model 칸의 picker를 연 상태: 맨 아래에 Manage models 줄이 있다. */
export const SettingsAgentsPage = () => (
  <SettingsFrame
    pane="agents"
    steps={[() => click("[data-model-field] [data-model-button]")]}
  />
);

/** Settings › Agents에서 모든 project의 지침 [Edit]을 눌러 그 자리에서 markdown 편집기로 고치는 중. */
export const SettingsAgentsInstructionsPage = () => (
  <SettingsFrame
    pane="agents"
    steps={[() => click("[data-action=edit-instructions]")]}
  />
);

/** Settings › Providers. */
export const SettingsProvidersPage = () => <SettingsFrame pane="providers" />;

// OpenAI의 연결을 끊고 Add a provider에서 다시 [Connect]를 눌러 연 연결 창 하나.
const CONNECT_OPENAI: readonly Step[] = [
  () => press(`[data-provider="${OPENAI}"] [data-action="disconnect"]`),
  () => press(`[data-action="confirm-disconnect"]`),
  () => press(`[data-available="openai"] [data-action="connect"]`),
];

/** provider 연결 창. */
export const SettingsConnectPage = () => (
  <Driven steps={CONNECT_OPENAI}>
    <SettingsFrame pane="providers" />
  </Driven>
);

// Add a provider의 Custom provider를 골라 form을 채우고 [Connect]를 누른다. agents fake가 같은 id의 custom provider(Local server)를 안다.
const CONNECT_CUSTOM: readonly Step[] = [
  () => press(`[data-available="custom"] [data-action="connect"]`),
  () => type("[data-custom-field=id]", "local-server"),
  () => type("[data-custom-field=name]", "Local server"),
  () => type("[data-custom-field=url]", "https://llm.example.com/v1"),
  () => click("[role=dialog] button", /^Connect$/),
];

/** Custom provider를 붙이고 목록을 찾은 직후. 전역 기본 model이 있어 다른 창이 뜨지 않는다. 그 provider 줄 아래에 "Found 2 models on Local server."와 [Manage models]가 남는다. */
export const SettingsProvidersConnectedFoundPage = () => (
  <SettingsFrame
    pane="providers"
    customList="found"
    steps={[
      ...CONNECT_CUSTOM,
      async () => {
        await find("[data-models-result=found]");
      },
    ]}
  />
);

/** Custom provider를 붙였는데 목록이 없어 Manage models가 Add model form과 함께 떴다가 닫은 뒤. 그 줄 아래에 "Local server didn't list its models. Add them by name."과 [Add model]이 남는다. */
export const SettingsProvidersConnectedEmptyPage = () => (
  <SettingsFrame
    pane="providers"
    customList="empty"
    steps={[...CONNECT_CUSTOM, () => click("[role=dialog] button", /^Close$/)]}
  />
);

/** Custom provider 연결 창. Provider ID, Display name, API(Chat Completions, Responses, Anthropic Messages 중 고르기), Base URL과 그 아래 주소 안내. 웹 주소라 key를 보호 입력으로 받는다는 안내가 보인다. */
export const SettingsConnectCustomPage = () => (
  <Driven
    steps={[
      () => press(`[data-available="custom"] [data-action="connect"]`),
      () => type("[data-custom-field=id]", "hive"),
      () => type("[data-custom-field=name]", "Hive"),
      () => type("[data-custom-field=url]", "https://api.hive.example/v1"),
    ]}
  >
    <SettingsFrame pane="providers" />
  </Driven>
);

// 처음 provider를 붙이는 사람이 하는 것: Anthropic의 [Connect]를 눌러 API key 방법을 고른다.
const CONNECT_FIRST: readonly Step[] = [
  () => press(`[data-available="anthropic"] [data-action="connect"]`),
  () => press(`[data-method="api_key"]`),
];

/** 처음 provider를 붙인 직후. 전역 기본 model이 없어서 "Choose a default model" 대화창이 뜨고 그 안의 picker를 연 상태다. 창 위에 창을 겹치지 않으므로 Manage models 줄이 없다. */
export const SettingsDefaultModelPromptPage = () => (
  <SettingsFrame
    pane="providers"
    providers="none"
    noDefaultModel
    steps={[...CONNECT_FIRST, () => click("[role=dialog] [data-model-button]")]}
  />
);

/** Settings › Tools and skills. */
export const SettingsToolsPage = () => <SettingsFrame pane="tools" />;

/** Settings › Tools and skills: 전역 server를 더하는 form에 web 주소와 OAuth 2.1 로그인을 고른 상태. */
export const SettingsToolsOAuthFormPage = () => (
  <SettingsFrame
    pane="tools"
    steps={[
      () => press('[data-action="add-server"]'),
      () => press("[data-server-field=transport] [role=combobox]"),
      () => click("[role=option]", t("settings.label.over-web")),
      () => press("[data-server-field=auth] [role=combobox]"),
      () => click("[role=option]", t("agents.label.auth-oauth2")),
      () => type("[data-server-field=issuer]", "https://mcp.notion.com"),
      () => type("[data-server-field=client-id]", "notion-client"),
      () => type("[data-server-field=scopes]", "read write"),
    ]}
  />
);
