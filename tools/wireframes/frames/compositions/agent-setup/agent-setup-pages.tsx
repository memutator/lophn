// agent 설정 묶음의 page들. 동작하는 ProjectApp(과 Workspace) 위에 상태 하나를 고정해 놓는다.
import { ProjectApp } from "../project-app.tsx";
import type { TabSpec } from "../project-window.tsx";
import { WorkspaceWithoutProject } from "../workspace-page.tsx";
import { AgentsPane } from "../workspace-settings.tsx";
import { SettingsTools } from "./settings-agents.tsx";
import { AgentEditor, type AgentEditorProps } from "./agent-editor.tsx";
import { AGENTS_TAB_SPEC, agentTab } from "./setup-data.ts";

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

// agent 설정 화면을 직접 그린 탭.
function editor(props: Omit<AgentEditorProps, "onDone">) {
  return alone({ ...agentTab(props.id), body: <AgentEditor {...props} /> });
}

/** project의 Agents 탭. sidebar Agents 묶음 머리의 Manage가 연다. */
export const ProjectAgentsPage = () => alone(AGENTS_TAB_SPEC, true);

/** 사람이 만든 Operator의 설정. */
export const OperatorEditorPage = () => editor({ id: "eval-analyst" });

/** 새 Operator를 만든다. 놓을 곳을 고른다. */
export const OperatorCreatePage = () => editor({ id: "new" });

/** App Engineer의 설정. project 지침은 앱 source가 속한 등록 project의 것이다. */
export const AppEngineerEditorPage = () => editor({ id: "app-engineer" });

/** agent 층에서 MCP server를 더하는 form을 연 상태. */
export const AgentServerFormPage = () =>
  editor({ id: "eval-analyst", serverForm: true });

/** Grants 탭. 앱, MCP tool, 부를 수 있는 agent, 설정 고치기. */
export const AgentGrantsPage = () =>
  editor({ id: "eval-analyst", section: "grants" });

/** Grants 탭에서 앱 하나를 펼친 상태. */
export const AgentGrantsAppPage = () =>
  editor({ id: "eval-analyst", section: "grants", openApp: "Budget tracker" });

/** Settings › Agents. */
export const SettingsAgentsPage = () => (
  <WorkspaceWithoutProject screen="settings" pane="agents" />
);

/** Settings › Agents › lophn. */
export const SettingsLophnPage = () => (
  <WorkspaceWithoutProject
    screen="settings"
    pane="agents"
    panes={{ agents: <AgentsPane initialView="lophn" /> }}
  />
);

/** Settings › Providers. */
export const SettingsProvidersPage = () => (
  <WorkspaceWithoutProject screen="settings" pane="providers" />
);

/** provider 연결 창 둘. */
export const SettingsConnectPage = () => (
  <WorkspaceWithoutProject screen="settings" pane="providers" connectStatic />
);

/** Settings › Tools and skills. */
export const SettingsToolsPage = () => (
  <WorkspaceWithoutProject
    screen="settings"
    pane="tools"
    panes={{ tools: <SettingsTools /> }}
  />
);
