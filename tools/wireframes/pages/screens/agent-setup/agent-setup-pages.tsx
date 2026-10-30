// agent 설정 묶음의 page들. 동작하는 ProjectApp(과 Settings) 위에 상태 하나를 고정해 놓는다.
import { t } from "@lophn/wording";

import { OPENAI } from "../../../../../packages/shell/renderer/desktop/settings/providers/testdata/fake-providers.ts";
import {
  ANTHROPIC,
  BUDGET_REVIEWER_ID,
  EVAL_ANALYST_ID,
  type FakeAgentsOptions,
} from "../../../../../packages/shell/renderer/workspace/agents/fake-source.ts";
import {
  AGENTS_TAB_SPEC,
  AgentSettingsEditor,
  agentTab,
} from "../agents-tab.tsx";
import { ProjectApp } from "../project-app.tsx";
import type { TabSpec } from "../project-window.tsx";
import { SettingsFrame } from "../settings-frame.tsx";
import { Driven } from "../../../mock/driven.tsx";
import { click, find, press, type Step, type } from "../../../mock/drive.ts";

const SIDEBAR = { foldersClosed: true } as const;

// 탭 하나만 열린 project 창.
function alone(tab: TabSpec, scrollToAgents = false) {
  return (
    <ProjectApp
      sidebar={scrollToAgents ? { ...SIDEBAR, scrollToAgents } : SIDEBAR}
      panes={[{ tabs: [tab], selected: tab.key }]}
    />
  );
}

// agent 설정 화면을 직접 그린 탭. steps는 mount 뒤에 눌러 상태를 고정한다.
function editor(
  id: string,
  steps: readonly Step[] = [],
  source?: FakeAgentsOptions,
  place: "project" | "app" = "project",
) {
  return alone({
    ...agentTab(id),
    body: (
      <AgentSettingsEditor
        id={id}
        place={place}
        onDone={() => {}}
        steps={steps}
        source={source}
      />
    ),
  });
}

const GRANTS_TAB: Step = () =>
  press("[role=tab]", t("agents.label.tab-grants"));

/** project의 Agents 탭. sidebar Agents 묶음 머리의 Manage가 연다. */
export const ProjectAgentsPage = () => alone(AGENTS_TAB_SPEC, true);

/** 사람이 만든 agent의 설정. */
export const AgentEditorPage = () => editor(EVAL_ANALYST_ID);

/** agent의 Model 칸 picker를 연 상태. project 층에 고른 model이 있어 맨 위 줄이 "Use project default — Haiku 5.5"다. */
export const AgentModelPickerPage = () =>
  editor(
    EVAL_ANALYST_ID,
    [
      // 목록이 창 아래로 잘리지 않게 Model 칸을 위로 올린 뒤 연다.
      async () =>
        (await find("[data-model-field]")).scrollIntoView({ block: "start" }),
      () => click("[data-model-field] [data-model-button]"),
    ],
    {
      projectModel: {
        provider: ANTHROPIC,
        model_name: "Haiku 5.5",
        option_values: {},
      },
    },
  );

/** 새 agent를 만든다. */
export const AgentCreatePage = () => editor("new");

/** lophn의 설정. 이름·profile이 잠기고 Delete가 없다. */
export const LophnEditorPage = () => editor("lophn");

/** 앱 자리에서 연 agent의 설정. 앱에는 project 지침이 없어 지침 블록에 안내만 있다. */
export const AppPlaceEditorPage = () =>
  editor(BUDGET_REVIEWER_ID, [], undefined, "app");

/** agent 층에서 MCP server를 더하는 form을 열고 web 주소와 OAuth 2.1 로그인을 고른 상태. */
export const AgentServerFormPage = () =>
  editor(EVAL_ANALYST_ID, [
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

/** Settings › Agents › lophn. [Open lophn settings]를 눌러 연 둘째 화면이다. */
export const SettingsLophnPage = () => (
  <Driven
    steps={[() => press("button", t("agents.button.settings-open-lophn"))]}
  >
    <SettingsFrame pane="agents" />
  </Driven>
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
