// agent 설정 묶음의 page들. 동작하는 ProjectApp(과 Workspace) 위에 상태 하나를 고정해 놓는다.
import { t } from "@lophn/wording";

import { OPENAI } from "../../../../../packages/shell/renderer/desktop/lophn-space/settings/providers/testdata/fake-providers.ts";
import { EVAL_ANALYST_ID } from "../../../../../packages/shell/renderer/workspace/agents/fake-source.ts";
import { AGENTS_TAB_SPEC, agentTab, OperatorEditor } from "../agents-tab.tsx";
import { ProjectApp } from "../project-app.tsx";
import type { TabSpec } from "../project-window.tsx";
import { WorkspaceWithoutProject } from "../workspace-page.tsx";
import { Driven } from "../workspace-settings.tsx";
import { bySelector, byText, type Step } from "./drive.ts";

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
function editor(id: string, steps: readonly Step[] = []) {
  return alone({
    ...agentTab(id),
    body: <OperatorEditor id={id} onDone={() => {}} steps={steps} />,
  });
}

const GRANTS_TAB = byText("[role=tab]", t("agents.label.tab-grants"));

/** project의 Agents 탭. sidebar Agents 묶음 머리의 Manage가 연다. */
export const ProjectAgentsPage = () => alone(AGENTS_TAB_SPEC, true);

/** 사람이 만든 Operator의 설정. */
export const OperatorEditorPage = () => editor(EVAL_ANALYST_ID);

/** 새 Operator를 만든다. 놓을 곳을 고른다. */
export const OperatorCreatePage = () => editor("new");

/** App Engineer의 설정. project 지침은 앱 source가 속한 등록 project의 것이다. */
export const AppEngineerEditorPage = () => editor("app_engineer");

/** agent 층에서 MCP server를 더하는 form을 연 상태. */
export const AgentServerFormPage = () =>
  editor(EVAL_ANALYST_ID, [
    byText("[data-field=mcp] button", t("settings.button.add-server")),
  ]);

/** Grants 탭. 앱, MCP tool, 부를 수 있는 agent, 설정 고치기. */
export const AgentGrantsPage = () => editor(EVAL_ANALYST_ID, [GRANTS_TAB]);

/** Grants 탭에서 앱 하나를 펼친 상태. */
export const AgentGrantsAppPage = () =>
  editor(EVAL_ANALYST_ID, [
    GRANTS_TAB,
    bySelector(`[data-grant-card="Budget tracker"] button[aria-expanded]`),
  ]);

/** Settings › Agents. */
export const SettingsAgentsPage = () => (
  <WorkspaceWithoutProject screen="settings" pane="agents" />
);

/** Settings › Agents › lophn. [Open lophn settings]를 눌러 연 둘째 화면이다. */
export const SettingsLophnPage = () => (
  <Driven steps={[byText("button", t("agents.button.settings-open-lophn"))]}>
    <WorkspaceWithoutProject screen="settings" pane="agents" />
  </Driven>
);

/** Settings › Providers. */
export const SettingsProvidersPage = () => (
  <WorkspaceWithoutProject screen="settings" pane="providers" />
);

// OpenAI의 연결을 끊고 Add a provider에서 다시 [Connect]를 눌러 연 연결 창 하나.
const CONNECT_OPENAI = [
  bySelector(`[data-provider="${OPENAI}"] [data-action="disconnect"]`),
  bySelector(`[data-action="confirm-disconnect"]`),
  bySelector(`[data-available="openai"] [data-action="connect"]`),
] as const;

/** provider 연결 창. */
export const SettingsConnectPage = () => (
  <Driven global steps={CONNECT_OPENAI}>
    <WorkspaceWithoutProject screen="settings" pane="providers" />
  </Driven>
);

/** Settings › Tools and skills. */
export const SettingsToolsPage = () => (
  <WorkspaceWithoutProject screen="settings" pane="tools" />
);
