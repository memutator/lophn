// Part 2: agent 부르기·대화·관리 화면. 모두 동작하는 ProjectApp(과 Workspace) 위에 고정 상태로 놓는다.
import {
  AGENTS_TAB,
  askEngineerTab,
  type ChatInit,
  operatorTab,
  weeklyTab,
  workingTab,
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

/** A1: sidebar의 Agents 묶음(session 목록은 sidebar에 없다). 탭 줄에 Weekly report · lophn Agent 탭이 열려 있다. */
export function AgentSidebar() {
  return withTab(weeklyTab({ stage: "question" }), {
    sidebar: { ...SIDEBAR, hoverAgent: "lophn", scrollToAgents: true },
  });
}

/** A2: lophn이 가진 사건(context 계약 위반)을 알리는 toast. [Ask Context Engineer]가 그 사건을 첫 context로 붙여 Agent 탭을 연다. */
export function AgentToast() {
  return (
    <ProjectApp
      sidebar={SIDEBAR}
      panes={[{ tabs: [DOC], selected: DOC.key }]}
      askToast
    />
  );
}

/** A2b: [Ask Context Engineer]를 누른 뒤. 새 Agent 탭에 context chip이 붙고 입력칸은 비어 있다. */
export function AgentToastOpened() {
  return withTab(askEngineerTab());
}

/** A3: 대화 탭. */
export const AgentConversation = () => weekly({ stage: "report" });
/** A3b: model picker를 펼친 상태. Favorites 묶음이 맨 위이고 고른 model의 option 축만 보인다. */
export const AgentModelPicker = () =>
  weekly({ stage: "report", modelDemo: "picker" });
/** A3c: model을 바꿔 없는 effort가 가까운 약한 값으로 맞춰진 직후. */
export const AgentModelChanged = () =>
  weekly({ stage: "report", modelDemo: "switched" });
/** A11: agent header의 session switcher. */
export const AgentSessions = () =>
  weekly({ stage: "report", switcher: "open" });
/** A11b: 이름 고치기 input과 삭제 확인. */
export const AgentSessionsEdit = () =>
  weekly({ stage: "report", switcher: "edit" });
/** A12: 입력칸에 "/"를 친 명령 메뉴. */
export const AgentCommands = () => weekly({ stage: "report", slash: "/" });
/** A12b: "/co"로 걸러진 메뉴. 작업 중이라 Fork가 흐리다. */
export const AgentCommandsFiltered = () =>
  withTab(workingTab({ slash: "/co" }));
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
export const OperatorEditorPage = () => withTab(operatorTab("eval-analyst"));

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
