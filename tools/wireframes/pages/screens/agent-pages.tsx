// Part 2: agent 부르기·대화·관리 화면. 모두 동작하는 ProjectApp(과 Workspace) 위에 고정 상태로 놓는다.
import {
  type ChatInit,
  SESSIONS,
  sessionTab,
  weeklyTab,
  workingTab,
} from "../../mock/agents-data.ts";
import {
  ApprovalDenyScene,
  ApprovalScene,
  ApprovalSettingsScene,
  ApprovalStatesScene,
  CallOpenScene,
  CallRepliesScene,
  ConversationScene,
  PermissionsScene,
  QuestionAnsweredScene,
  QuestionEndedScene,
  QuestionScene,
  QueuedMessageScene,
  RecapScene,
  RequestErrorScene,
  RewindScene,
  SenderChipsScene,
} from "./agent-tab/scenes.tsx";
import { ProjectApp, type ProjectAppProps } from "./project-app.tsx";
import { documentTab } from "../../mock/phroner-data.ts";
import type { TabSpec } from "./project-window.tsx";

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

/** 대화 탭. 일하는 중 steer로 보낸 메시지, 앱 카드. */
export const AgentConversation = ConversationScene;
/** 일하는 중에 보낸 메시지가 쌓인 "다음 turn" 줄과 [Send now]. */
export const AgentQueuedMessage = QueuedMessageScene;
/** model picker를 펼친 상태. 연결된 provider 묶음, 고른 model의 option 축, 맨 아래 Manage models 줄, 머리의 층 한 줄("이 대화"). */
export const AgentModelPicker = () =>
  weekly({
    stage: "report",
    modelDemo: "picker",
    picker: { layer: "session" },
  });
/** 붙인 provider가 없는 picker. 안내와 Connect provider 줄만 있다. */
export const ModelPickerEmpty = () =>
  weekly({
    stage: "report",
    modelDemo: "picker",
    picker: { providers: "none", layer: null },
  });
/** 이 대화에서 model을 고르지 않아 project default를 따르는 picker. */
export const ModelPickerInherited = () =>
  weekly({
    stage: "report",
    modelDemo: "picker",
    picker: { layer: "project" },
  });
/** custom provider(provider가 알려 준 목록)의 묶음이 있는 picker. */
export const ModelPickerCustom = () =>
  weekly({
    stage: "report",
    modelDemo: "picker",
    picker: { providers: "custom", current: "llama-3.3-70b", layer: "session" },
  });
/** [Refresh models]가 실패해 앞 목록이 그대로 있고 picker 안에 실패 한 줄이 있다. */
export const ModelPickerRefreshFailed = () =>
  weekly({
    stage: "report",
    modelDemo: "refresh",
    picker: {
      providers: "custom",
      current: "llama-3.3-70b",
      layer: "session",
    },
  });
/** model을 바꾼 뒤 provider가 요청을 거절한 오류 메시지. */
export const AgentRequestError = RequestErrorScene;
/** 받은 메시지의 보낸 쪽 chip 셋과 펼친 panel. */
export const AgentSenderChips = SenderChipsScene;
/** 보낸 session의 call 블록(끝나지 않음). */
export const AgentCallOpen = CallOpenScene;
/** call이 끝난 뒤의 답·실패 메시지와 취소한 줄. */
export const AgentCallReplies = CallRepliesScene;
/** agent header의 session switcher. */
export const AgentSessions = () =>
  weekly({ stage: "report", switcher: "open" });
/** 이름 고치기 input과 삭제 확인(열린 call이 실패한다고 알린다). */
export const AgentSessionsEdit = () =>
  weekly({ stage: "report", switcher: "edit" });
/** archive한 session을 열면 기록만 보이고 입력칸이 없다. */
export const AgentSessionArchived = () =>
  withTab(sessionTab(SESSIONS.find((row) => row.id === "old-1")!));
/** 입력칸에 "/"를 친 명령 메뉴. */
export const AgentCommands = () => weekly({ stage: "report", slash: "/" });
/** 일하는 중 "/re"로 걸러진 메뉴. 고른 명령은 다음 turn에 들어간다. */
export const AgentCommandsFiltered = () =>
  withTab(workingTab({ slash: "/re" }));
/** `/recap`의 결과. */
export const AgentRecap = RecapScene;
/** `/permissions`의 보기. */
export const AgentPermissions = PermissionsScene;
/** 질문 카드. */
export const AgentQuestion = QuestionScene;
/** 질문에 답한 뒤. */
export const AgentQuestionAnswered = QuestionAnsweredScene;
/** 기다리는 중 메시지를 보내 질문이 끝난 뒤. */
export const AgentQuestionEnded = QuestionEndedScene;
/** 승인 카드(MCP tool). */
export const AgentApproval = ApprovalScene;
/** [Deny]를 눌러 이유를 적는 모습. */
export const AgentApprovalDeny = ApprovalDenyScene;
/** 설정 고치기(LOPHN.md) 승인 카드. */
export const AgentApprovalSettings = ApprovalSettingsScene;
/** 결정 뒤 상태 넷. */
export const AgentApprovalStates = ApprovalStatesScene;
/** rewind panel. */
export const AgentRewind = RewindScene;
