// Part 2: agent 부르기·대화·관리 화면. 모두 동작하는 ProjectApp(과 Workspace) 위에 고정 상태로 놓는다.
import {
  AGENTS_TAB,
  askLophnTab,
  type ChatInit,
  operatorTab,
  weeklyTab,
} from "./agents-data.ts";
import { ProjectApp, type ProjectAppProps } from "./project-app.tsx";
import { documentTab } from "./phroner-data.ts";
import type { TabSpec } from "./project-window.tsx";
import { WorkspaceWithoutProject } from "./workspace-page.tsx";

const DOC = documentTab("eval/experiments/exp-008-query-tools.md");
const SIDEBAR = { foldersClosed: true } as const;

// 문서 탭 하나 뒤에 이 탭을 열어 고른 한 칸.
function withTab(tab: TabSpec, extra: Partial<ProjectAppProps> = {}) {
  return (
    <ProjectApp
      sidebar={SIDEBAR}
      panes={[{ tabs: [DOC, tab], selected: tab.key }]}
      {...extra}
    />
  );
}

const weekly = (chat: ChatInit) => withTab(weeklyTab(chat));

/** A1: sidebar의 Agents 묶음과 최근 Conversations. 탭 줄에 Weekly report · lophn 대화가 열려 있다. */
export function AgentSidebar() {
  return withTab(weeklyTab({ stage: "question" }), {
    sidebar: { ...SIDEBAR, hoverAgent: "lophn", scrollToAgents: true },
  });
}

/** A2: program이 판정한 일을 알리는 toast. [Ask lophn]이 그 일을 첫 context로 붙여 대화를 연다. */
export function AgentToast() {
  return (
    <ProjectApp
      sidebar={SIDEBAR}
      panes={[{ tabs: [DOC], selected: DOC.key }]}
      askToast
    />
  );
}

/** A2b: [Ask lophn]을 누른 뒤. 새 대화에 context chip이 붙고 입력칸은 비어 있다. */
export function AgentToastOpened() {
  return withTab(askLophnTab());
}

/** A3: 대화 탭. */
export const AgentConversation = () => weekly({ stage: "report" });
/** A3b: model picker를 펼친 상태. */
export const AgentModelPicker = () => weekly({ stage: "report", model: true });
/** A4: 질문 카드. */
export const AgentQuestion = () => weekly({ stage: "question" });
/** A4b: 질문에 답한 뒤. */
export const AgentQuestionAnswered = () => weekly({ stage: "answered" });
/** A5: 승인 카드. Allow ▾를 펼친 상태. */
export const AgentApproval = () =>
  weekly({ stage: "approval", allowMenu: true });
/** A6: 내 메시지의 Rewind menu. */
export const AgentRewind = () => weekly({ stage: "report", rewind: true });

/** A7: project의 Agents 탭. */
export const ProjectAgents = () => withTab(AGENTS_TAB);
/** A8: Operator 편집 탭. */
export const OperatorEditorPage = () =>
  withTab(operatorTab("weekly-eval-report"));

/** A9: Workspace › Settings › Providers. */
export const SettingsProviders = () => (
  <WorkspaceWithoutProject screen="settings" pane="providers" />
);
/** A9b: provider 연결 창. */
export const SettingsConnect = () => (
  <WorkspaceWithoutProject screen="settings" pane="providers" connectStatic />
);
/** A10: Workspace › Settings › Agents. */
export const SettingsAgents = () => (
  <WorkspaceWithoutProject screen="settings" pane="agents" />
);
