// agent 설정 묶음의 page들. 동작하는 ProjectApp(과 Settings) 위에 상태 하나를 고정해 놓는다.
import { t } from "@lophn/wording";

import { OPENAI } from "../../../../../packages/shell/renderer/desktop/settings/providers/testdata/fake-providers.ts";
import {
  ANTHROPIC,
  EVAL_ANALYST_ID,
  type FakeAgentsOptions,
} from "../../../../../packages/shell/renderer/workspace/agents/fake-source.ts";
import { AGENTS_TAB_SPEC, agentTab, OperatorEditor } from "../agents-tab.tsx";
import { ProjectApp } from "../project-app.tsx";
import type { TabSpec } from "../project-window.tsx";
import { SettingsFrame } from "../settings-frame.tsx";
import { Driven } from "../../../mock/driven.tsx";
import { click, find, press, type Step } from "../../../mock/drive.ts";

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
) {
  return alone({
    ...agentTab(id),
    body: (
      <OperatorEditor id={id} onDone={() => {}} steps={steps} source={source} />
    ),
  });
}

const GRANTS_TAB: Step = () =>
  press("[role=tab]", t("agents.label.tab-grants"));

/** project의 Agents 탭. sidebar Agents 묶음 머리의 Manage가 연다. */
export const ProjectAgentsPage = () => alone(AGENTS_TAB_SPEC, true);

/** 사람이 만든 Operator의 설정. */
export const OperatorEditorPage = () => editor(EVAL_ANALYST_ID);

/** Operator의 Model 칸 picker를 연 상태. project 층에 고른 model이 있어 맨 위 줄이 "Use project default — Haiku 5.5"다. */
export const OperatorModelPickerPage = () =>
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

/** 새 Operator를 만든다. 놓을 곳을 고른다. */
export const OperatorCreatePage = () => editor("new");

/** App Engineer의 설정. project 지침은 앱 source가 속한 등록 project의 것이다. */
export const AppEngineerEditorPage = () => editor("app_engineer");

/** agent 층에서 MCP server를 더하는 form을 연 상태. */
export const AgentServerFormPage = () =>
  editor(EVAL_ANALYST_ID, [
    () => press("[data-field=mcp] button", t("settings.button.add-server")),
  ]);

/** Grants 탭. 앱, MCP tool, 부를 수 있는 agent, 설정 고치기. */
export const AgentGrantsPage = () => editor(EVAL_ANALYST_ID, [GRANTS_TAB]);

/** Grants 탭에서 앱 하나를 펼친 상태. */
export const AgentGrantsAppPage = () =>
  editor(EVAL_ANALYST_ID, [
    GRANTS_TAB,
    () => press(`[data-grant-card="Budget tracker"] button[aria-expanded]`),
  ]);

/** Settings › Agents. */
export const SettingsAgentsPage = () => <SettingsFrame pane="agents" />;

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

// 처음 provider를 붙이는 사람이 하는 것: Anthropic의 [Connect]를 눌러 API key 방법을 고른다.
const CONNECT_FIRST: readonly Step[] = [
  () => press(`[data-available="anthropic"] [data-action="connect"]`),
  () => press(`[data-method="api_key"]`),
];

/** 처음 provider를 붙인 직후. 전역 기본 model이 없어서 "Choose a default model" 대화창이 뜬다. */
export const SettingsDefaultModelPromptPage = () => (
  <SettingsFrame
    pane="providers"
    providers="none"
    noDefaultModel
    steps={CONNECT_FIRST}
  />
);

/** Settings › Tools and skills. */
export const SettingsToolsPage = () => <SettingsFrame pane="tools" />;
