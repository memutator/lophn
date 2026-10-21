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
import {
  ANTHROPIC,
  CUSTOM_INFO_MODEL,
  CUSTOM_PROVIDER,
  type FakeAgentsOptions as FakeEditorOptions,
  OPENAI,
} from "../../../../packages/shell/renderer/workspace/agents/fake-source.ts";
import { click, press, type Step, type } from "../../mock/drive.ts";
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

const weekly = (chat: ChatInit, extra: Partial<ProjectAppProps> = {}) =>
  withTab(weeklyTab(chat), extra);

/** 대화 탭. 일하는 중 steer로 보낸 메시지, 앱 카드. */
export const AgentConversation = ConversationScene;
/** 일하는 중에 보낸 메시지가 쌓인 "다음 turn" 줄과 [Send now]. */
export const AgentQueuedMessage = QueuedMessageScene;
/** model picker를 펼친 상태. 켠 model의 provider 묶음, 고른 model의 option 축, 맨 아래 Manage models 줄, 머리의 층 한 줄("이 대화"). 꺼 둔 model은 목록에 없다. */
export const AgentModelPicker = () =>
  weekly({
    stage: "report",
    modelDemo: "picker",
    picker: { layer: "session", hidden: ["Haiku 5.5", "GPT-6.1 Mini"] },
  });
/** 보일 model이 없는 picker(provider를 붙이지 않은 상태). 안내와 Manage models 줄만 있다. */
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
    picker: { layer: "project", hidden: ["Haiku 5.5", "GPT-6.1 Mini"] },
  });

// Manage models 창이 읽는 상태. 셋이 연결돼 있고 Anthropic의 Haiku와 OpenAI의 Mini는 꺼져 있다.
const MANAGE: FakeEditorOptions = {
  providers: "several",
  hidden: [
    { provider: ANTHROPIC, model_name: "Haiku 5.5" },
    { provider: OPENAI, model_name: "GPT-6.1 Mini" },
  ],
};

// 대화의 picker를 열고 맨 아래 Manage models 줄을 눌러 창을 연다.
const manage = (
  models: FakeEditorOptions,
  afterManage: readonly Step[] = [],
) =>
  weekly(
    { stage: "report", modelDemo: "manage", afterManage },
    { models },
  );

/** Manage models 창. 연결된 provider 셋의 묶음마다 provider toggle과 model toggle이 있고 일부 model이 꺼져 있다. */
export const ManageModels = () => manage(MANAGE);
/** custom provider의 묶음. 머리에 Refresh models가 있고 그 아래에 model 이름을 더하는 칸이 있다. */
export const ManageModelsCustom = () =>
  manage({
    providers: "custom",
    hidden: [{ provider: CUSTOM_PROVIDER, model_name: "qwen-3-coder" }],
  });
/** [Refresh models]가 실패해 앞 목록이 그대로 있고 창 안에 실패 한 줄이 보인다. */
export const ManageModelsRefreshFailed = () =>
  manage({ providers: "custom", refreshFails: true }, [
    () => click("[data-refresh-models]"),
  ]);
/** [Connect provider]를 눌러 provider 연결 창이 Manage models 창 위에 열린 상태. */
export const ManageModelsConnect = () =>
  manage(MANAGE, [
    () => click("[data-manage-models] button", /^Connect provider$/),
  ]);

// custom provider의 정보가 있는 model 행의 [Edit]을 눌러 form을 연다.
const editInfo = () =>
  click(`[data-model="${CUSTOM_INFO_MODEL}"] [data-edit-model]`);

/** 내장(Anthropic)과 custom provider를 같이 둔 Manage models. 줄마다 입력 media icon과 context, custom 줄의 [Edit], 묶음 아래 [Add model]. */
export const ModelInfoManage = () => manage({ providers: "custom" });
/** [Add model]을 눌러 연 빈 form. 한도 칸에는 기본값이 회색 placeholder로 보인다. */
export const ModelInfoAdd = () =>
  manage({ providers: "custom" }, [
    () => click("[data-manage-section=add-model] button"),
  ]);
/** 정보가 있는 model의 [Edit]으로 연 form. image 입력, effort 넷과 기본값, 가격이 채워져 있다. */
export const ModelInfoEdit = () => manage({ providers: "custom" }, [editInfo]);
/** 다른 창이 판을 바꾼 뒤 [Save]를 눌러 conflict 한 줄이 뜬 form. 값은 그대로다. */
export const ModelInfoConflict = () =>
  manage({ providers: "custom", infoGoesStale: true }, [
    editInfo,
    () => click("[role=dialog] button", /^Save$/),
  ]);
// Manage models의 [Connect provider]로 Custom provider를 붙인다: 목록에서 Custom provider를 고르고 form을 채워 [Connect]를 누른다.
// 같은 id의 custom provider(Local server)를 agents fake가 알고, 연결 뒤 host가 목록을 한 번 읽는다.
const CONNECT_CUSTOM: readonly Step[] = [
  () => click("[data-manage-models] button", /^Connect provider$/),
  () => press(`[data-available="custom"] [data-action="connect"]`),
  () => type("[data-custom-field=id]", "local-server"),
  () => type("[data-custom-field=name]", "Local server"),
  () => type("[data-custom-field=url]", "https://llm.example.com/v1"),
  () => click("[role=dialog] button", /^Connect$/),
];

/** Manage models에서 Custom provider를 붙이고 `/models` 목록을 읽은 직후. 새 provider 묶음이 맨 위에 있고 창 안에 "Found 2 models on Local server." 한 줄이 보인다. */
export const ModelInfoConnectFound = () =>
  manage({ providers: "custom", customListed: false }, CONNECT_CUSTOM);
/** Manage models에서 Custom provider를 붙였는데 목록을 읽지 못한 직후. 그 provider의 Add model form이 바로 열려 있고 form 맨 위에 목록을 받지 못했다는 한 줄이 보인다. */
export const ModelInfoConnectEmpty = () =>
  manage(
    { providers: "custom", customListed: false, refreshFails: true },
    CONNECT_CUSTOM,
  );
/** 정보를 적은 custom model을 고른 picker. 적은 effort가 option 축으로 보인다. */
export const ModelInfoPicker = () =>
  weekly({
    stage: "report",
    modelDemo: "picker",
    picker: {
      providers: "custom",
      layer: "session",
      current: CUSTOM_INFO_MODEL,
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
/** 허락 카드(shell 명령). */
export const AgentApproval = ApprovalScene;
/** [Deny]를 눌러 이유를 적는 모습. */
export const AgentApprovalDeny = ApprovalDenyScene;
/** 결정 뒤 상태 넷. */
export const AgentApprovalStates = ApprovalStatesScene;
/** rewind panel. */
export const AgentRewind = RewindScene;
