import {
  acpDraft,
  acpImageRead,
  acpImageUpload,
  acpSend,
  acpSnapshot,
  acpToolBodyRead,
} from "../acp/routes.ts";
import { assignmentGet } from "../approvals/assignment.ts";
import {
  shareRequestDecide,
  shareRequestList,
} from "../approvals/share-request.ts";
import { turnRequestDecide } from "../approvals/turn-request.ts";
import { presenceReport, unseenDismiss, unseenList } from "../attention/mod.ts";
import {
  activationConsent,
  activationConsents,
} from "../apps/activation/consent.ts";
import {
  releasesGetRecord,
  releasesListRecords,
} from "../apps/activation/activation.ts";
import {
  appSyncPull,
  appSyncPush,
  appSyncSnapshot,
  appSyncSnapshotFile,
} from "../apps/app-sync.ts";
import { appGet, appList } from "../apps/apps.ts";
import { appRemoteCall } from "../apps/calls/remote.ts";
import { appInvocation, appInvocations } from "../apps/calls/invocation.ts";
import { appRewindPlan } from "../apps/calls/rewind.ts";
import { appScreenFile } from "../apps/calls/screen.ts";
import { appIcon, appTools } from "../apps/declaration/read.ts";
import {
  noticeDismiss,
  noticeMarkRead,
  noticesList,
  noticesOpen,
} from "../apps/notice.ts";
import { appPhoneFile, appPhoneScreens } from "../apps/phone.ts";
import { appRuntime } from "../apps/runtime.ts";
import { appGrantsList } from "../apps/grants.ts";
import { appViewsCall, appViewsClose, appViewsOpen } from "../apps/views.ts";
import { appWidgetsList } from "../apps/widget.ts";
import {
  codingSessionsCliSessions,
  codingSessionsList,
  codingSessionsOpen,
  codingSessionsRewindPreview,
  codingSessionsSwitch,
  codingSessionsSwitchPlan,
} from "../coding-agent/relay.ts";
import {
  terminalViewResize,
  terminalViewSnapshot,
  terminalViewWatch,
} from "../coding-agent/terminal-view.ts";
import {
  terminalsClose,
  terminalsInput,
  terminalsList,
  terminalsOpen,
  terminalsRestart,
} from "../coding-agent/terminals.ts";
import { CARRY_ROUTES } from "./carry.ts";
import {
  PAGE_VIEW_ROUTES,
  pageViewControl,
  pageViewInput,
  pageViewOpen,
} from "../lophn-agent/page-view.ts";
import {
  appSessionsEnd,
  appSessionsList,
  appSessionsOpen,
  appSessionsStatus,
  appSessionsStop,
} from "../lophn-agent/session-lifecycle.ts";
import type { BusEvent } from "../events/bus.ts";
import { sessionSnapshotsList } from "../events/snapshot.ts";
import {
  jobApprove,
  jobDecideHold,
  jobHolds,
  jobList,
  jobPending,
  jobRunList,
  jobUpdate,
} from "../jobs/jobs.ts";
import { settingsList, settingsUpdate } from "../config/file.ts";
import { diagnosticsStatus } from "../diagnostics/diagnostics.ts";
import {
  agentCard,
  agentChange,
  agentCreate,
  agentDelete,
  agentList,
  agentProfileImageRead,
  agentProfileImageUpload,
  agentRead,
} from "../lophn-agent/agent-definitions.ts";
import {
  workspaceSessionList,
  workspaceSessionOpen,
  workspaceSessionRead,
} from "../lophn-agent/agent-sessions.ts";
import {
  appAgentsList,
  appCallsCancel,
  appCallsList,
  appCallsRead,
  appCallsSend,
} from "../lophn-agent/app-calls.ts";
import { askAnswer, askRead } from "../lophn-agent/ask-tool.ts";
import { agentCallRead, callCancel } from "../lophn-agent/calls.ts";
import { extensionToolsCatalog } from "../lophn-agent/extension-tools.ts";
import {
  inputRequestAnswerSecret,
  inputRequestCancel,
  inputRequestRead,
} from "../lophn-agent/input-request.ts";
import {
  editQueued,
  moveQueued,
  removeQueued,
  sendMessage,
  steerQueuedNow,
} from "../lophn-agent/inputs.ts";
import {
  messageImageRead,
  messageImageUpload,
} from "../lophn-agent/message-images.ts";
import { messageSearch } from "../lophn-agent/message-search.ts";
import {
  mcpAuthState,
  workspaceExtensionSettingsRead,
  workspaceExtensionSettingsChange,
} from "../lophn-agent/mcp-settings.ts";
import { messageBody } from "../lophn-agent/messages.ts";
import {
  changeShownModels,
  modelCatalogRead,
  modelDefaultChange,
  modelDefaultRead,
  removeUserModelInfo,
  saveUserModelInfo,
  shownModelsRead,
  userModelInfoRead,
  workspaceModelChange,
  workspaceModelRead,
} from "../lophn-agent/models.ts";
import {
  connectProvider,
  disconnectProvider,
  loginCancel,
  providerConnectKey,
  providerConnectLocal,
  providerDefinitions,
  providerList,
  providerRead,
  providerSignIn,
  providerSignInState,
  recordProviderModels,
  refreshProviderModels,
} from "../lophn-agent/providers.ts";
import { receivedMessageRead } from "../lophn-agent/received-messages.ts";
import {
  sessionRewind,
  sessionRewindPreview,
} from "../lophn-agent/session-rewinds.ts";
import {
  archiveSession,
  changeSessionModel,
  forkSession,
  renameSession,
  requestSessionCompact,
} from "../lophn-agent/sessions.ts";
import { skillsRead } from "../lophn-agent/skill-settings.ts";
import { turnBodyView, turnList, turnRead } from "../lophn-agent/turn-reads.ts";
import { stopTurn } from "../lophn-agent/turns.ts";
import { projectAdd, projectBrowse } from "../projects/add-api.ts";
import { projectIdentityApi } from "../projects/identity-api.ts";
import { projectApi } from "../projects/project-api.ts";
import {
  projectFilesList,
  projectFilesRead,
} from "../projects/project-files.ts";
import { projectSearch } from "../projects/project-search.ts";
import { runList, runRead } from "../runs/runs.ts";
import {
  secretDelete,
  secretPut,
  secretStatus,
} from "../secrets/secret-file.ts";
import {
  workflowInstanceList,
  workflowInstanceRead,
  workflowList,
  workflowStart,
  workflowStop,
} from "../workflows/routes.ts";
import { devicesSetPush, rosterLeave } from "./routes.ts";

// 기기가 부를 수 있는 route는 두 목록이다. 기기 자격의 scope는 두 목록의 합이고, 밖의 route는 `forbidden`이다.
// - REMOTE_ALLOWED_ROUTES(아래): 모든 기기의 목록. 폰은 일하는 창이다: 보고, 말하고, 답하고, 켜고 끄고, 시작하는 route만 둔다.
// - REMOTE_PERSON_ROUTES(이 file 끝): 사람이 이 기기의 터미널 입력을 허락한 기기에만 여는 목록(secret, provider·model, 설정 쓰기,
//   agent·project 만들고 고치기). 허락은 이 컴퓨터가 그 기기의 화면(`by`가 없는 폰, 컴퓨터의 `screen` 요청)에게만 사람의 route를 연다는 뜻이다. 컴퓨터의 `terminal`·`agent`·`app` 요청은
//   허락이 있어도 못 받는다. 거르기는 core/remote/call.ts가 한다.
// 모든 기기의 목록에 넣지 않는 것: 만들기·고치기·지우기(agent, job, 앱, project, workflow 정의), secret, provider·model 관리, 설정 쓰기, 기기와 명단(자기를 명단에서 빼는
// `roster/leave`와 자기 push 설정 `devices/set_push`만 둔다),
// `tabs/*`, `sessions/delete`(되돌릴 수 없다), `sessions/change-skip`(사람에게 묻지 않고 돌게 하는 권한 설정이다)은 넣지 않는다.
// 컴퓨터의 coding agent(`coding_sessions/*`)는 폰이 목록을 보고 view를 바꾸고 새로 연다. 폰이 시작한 switch도
// `confirmed: true`가 있어야 한다(도는 turn이 끊긴다). 터미널은 `terminals/open|input`으로 열고 치고, 화면은 `terminal_view/*`로 본다.
// `terminals/input`은 목록에 있어도 사람이 컴퓨터에서 이 기기의 터미널 입력을 켰을 때만 core가 받는다. 그 스위치
// (`roster/set_terminal_input`)와 `host/*`는 넣지 않는다.
// `jobs/update`는 켜고 끄기(`enabled`)만 받는다(core/remote/call.ts). `acp/send`는 안의 route를 기기 자격으로 부르므로 대화 조작 route도 여기 있어야 한다.
// 두 목록 모두 user가 부를 수 있는 route여야 하고(아니면 core가 기기 자격을 만들지 못한다), 서로 겹치지 않는다.
// 다 본 session의 표시(`unseen/list|dismiss`)를 둔다: 보는 것이 읽음을 만들고 읽음은 host에 있다(어느 기기에서 봐도 같이 꺼진다).
// file·upload route의 bytes는 `call`에서 base64로 싣는다(core/remote/call.ts). 폰은 화면 bundle도 이 목록의 route로 받는다.
// 앱의 폰 화면: 목록(`apps/phone_screens`), 화면 file(`apps/screen_file`), 폰 backend file(`apps/phone_file`), view binding(`app_views/*`)만 둔다. 폰 화면 bridge는
// view id로만 앱을 부르고, 부를 수 있는 operation은 core가 그 view에 묶인 release의 선언에 있는 것만으로 판정한다. 그래서
// 앱을 직접 부르는 `apps/call_tool`과 grant를 바꾸는 `app_grants/*`는 넣지 않는다(읽기 `app_grants/list`만 둔다). 화면 오류를 쓰는
// `apps/log_view_error`도 넣지 않는다: 입력의 앱을 부르는 쪽이 정해서 다른 앱의 log에 쓸 수 있다.
// 다른 컴퓨터의 창에 뜬 이 기계의 앱 화면: 그 화면의 agent 길(`app_sessions/*`, `app_calls/*`, `app_agents/list`)을 둔다. 기기는 자기가 연
// view를 실어야 하고 앱은 core가 그 view로 정한다(입력의 앱을 믿지 않는다).
// 폰에서 도는 앱: 폰이 앱 backend와 migration file(`apps/phone_file`)을 받고 자기 사본을 컴퓨터와 맞춘다(`app_sync/*`). `app_sync/push`는
// 기기 자격(principal `device:<id>`)만 받는다.
export const REMOTE_ALLOWED_ROUTES = [
  // session 목록
  workspaceSessionList,
  workspaceSessionRead,
  workspaceSessionOpen,
  archiveSession,
  sessionSnapshotsList,
  appList,
  appGet,
  projectApi.list,
  projectApi.get,
  projectApi.icon,
  appIcon,
  // 새 session: 그 workspace에서 일할 수 있는 agent
  agentList,
  // 컴퓨터의 coding agent: 목록, view 바꾸기(미리 보기와 바꾸기), 새로 열기. 대화는 아래 `acp/*`다
  codingSessionsList,
  codingSessionsSwitchPlan,
  codingSessionsSwitch,
  codingSessionsOpen,
  // 다른 컴퓨터의 coding agent GUI가 읽는 것: 그 CLI의 지난 session 목록, rewind로 되돌아갈 file 이름
  codingSessionsCliSessions,
  codingSessionsRewindPreview,
  // 터미널 화면: 화면 읽기, 보는 동안의 lease, 보는 터미널의 PTY 크기를 폰에 맞추기
  terminalViewSnapshot,
  terminalViewWatch,
  terminalViewResize,
  // core가 여는 터미널: 목록, 열기와 입력. 입력은 허락받은 기기만 core가 받는다
  terminalsList,
  terminalsOpen,
  terminalsInput,
  // agent의 browser page를 멀리서 보기: 목록, 그림, lease, 입력·잡기·열기. 다루는 것은 터미널 입력을 허락받은 기기만 core가 받는다
  ...PAGE_VIEW_ROUTES,
  // 대화
  acpSnapshot,
  acpDraft,
  acpSend,
  // coding session: 펼친 tool 줄의 본문, 붙이는 그림과 대화의 그림
  acpToolBodyRead,
  acpImageUpload,
  acpImageRead,
  askRead,
  askAnswer,
  agentRead,
  providerRead,
  assignmentGet,
  turnRead,
  turnList,
  turnBodyView,
  messageBody,
  receivedMessageRead,
  messageSearch,
  agentCallRead,
  callCancel,
  sendMessage,
  stopTurn,
  steerQueuedNow,
  removeQueued,
  editQueued,
  moveQueued,
  changeSessionModel,
  renameSession,
  forkSession,
  requestSessionCompact,
  sessionRewind,
  sessionRewindPreview,
  appRewindPlan,
  inputRequestRead,
  inputRequestCancel,
  messageImageRead,
  messageImageUpload,
  // Inbox
  turnRequestDecide,
  unseenList,
  unseenDismiss,
  noticesList,
  noticesOpen,
  noticeMarkRead,
  noticeDismiss,
  activationConsents,
  activationConsent,
  jobHolds,
  jobDecideHold,
  jobPending,
  jobApprove,
  shareRequestList,
  shareRequestDecide,
  // Agents
  agentCard,
  agentProfileImageRead,
  skillsRead,
  // Jobs
  jobList,
  jobRunList,
  jobUpdate,
  // project workspace: workflow, file 내용 검색, file 목록과 글 읽기
  workflowList,
  workflowInstanceList,
  workflowInstanceRead,
  workflowStart,
  workflowStop,
  projectSearch,
  projectFilesList,
  projectFilesRead,
  // 다른 컴퓨터가 넘긴 앱 command의 입구. 허락받은 컴퓨터만 core가 받는다(`by` 없는 폰은 forbidden)
  appRemoteCall,
  // 앱 workspace: 실행 기록과 판
  runList,
  runRead,
  appInvocations,
  appInvocation,
  appTools,
  appRuntime,
  releasesListRecords,
  releasesGetRecord,
  // 앱의 폰 화면
  appPhoneScreens,
  appScreenFile,
  appPhoneFile,
  appViewsOpen,
  appViewsCall,
  appViewsClose,
  // 다른 컴퓨터의 창에 뜬 앱 화면: 그 앱이 받은 허락 읽기, 화면의 agent session과 call(기기는 자기가 연 view의 앱으로만)
  appGrantsList,
  appSessionsList,
  appSessionsStatus,
  appSessionsStop,
  appSessionsOpen,
  appSessionsEnd,
  appCallsSend,
  appCallsRead,
  appCallsCancel,
  appCallsList,
  appAgentsList,
  // 폰 홈 화면 위젯의 값: 폰이 위젯을 그리려면 읽어야 한다
  appWidgetsList,
  // 폰에서 도는 앱: 설치(snapshot)와 맞추기(push, pull)
  appSyncPush,
  appSyncPull,
  appSyncSnapshot,
  appSyncSnapshotFile,
  // 컴퓨터끼리 맞추는 file을 나른다(연결된 컴퓨터, 폰). 받는 쪽은 명단의 컴퓨터가 서명한 manifest에 맞는 file만 둔다
  ...CARRY_ROUTES,
  // 기기가 자기를 내 기기 명단에서 뺀다
  rosterLeave,
  // push: 폰이 자기 token과 알림 설정을 두고, 지금 앞에 보이는지를 알린다
  devicesSetPush,
  presenceReport,
] as const;

// 터미널 입력을 허락받은 기기에만 여는 사람의 route다. 허락이 있어도 넣지 않는 것: 기기·pairing·명단 관리(`devices/*`, `roster/*`),
// 터미널 입력 허락 바꾸기, `always_on/*`, `machine/rename`, `logins/*`, `sessions/delete`, `sessions/change-skip`, `tabs/*`, `host/*`,
// `terminal_sessions/*`, `apps/call_tool`, grant 바꾸기(`app_grants/*`의 쓰기), 할당 쓰기, 그 기계의 loopback으로 돌아오는 로그인(`agent-mcp-auth/*`의 시작·완료·취소, `apps/oauth_*`).
// MCP 로그인 상태 읽기(`agent-mcp-auth/state`)는 Tools and skills가 보이므로 연다.
// 확인이 필요한 command(`providers/disconnect`)는 core가 그 자리에서 확인 handle을 붙인다(core/remote/call.ts).
export const REMOTE_PERSON_ROUTES = [
  // 터미널 닫기와 다시 띄우기(다른 컴퓨터의 터미널 탭). 다시 띄우기는 core가 입력과 같은 허락을 한 번 더 본다
  terminalsClose,
  terminalsRestart,
  // secret: 값은 upload body로 오고 secret 저장소에만 간다
  secretPut,
  secretDelete,
  secretStatus,
  // provider: 연결과 끊기, 로그인. 안에서 부른 사람의 자격으로 `providers/connect`와 `provider-credentials/record-models`를 writer에 보낸다
  connectProvider,
  disconnectProvider,
  providerList,
  providerDefinitions,
  refreshProviderModels,
  recordProviderModels,
  loginCancel,
  providerConnectKey,
  providerConnectLocal,
  providerSignIn,
  providerSignInState,
  inputRequestAnswerSecret,
  // model
  changeShownModels,
  shownModelsRead,
  saveUserModelInfo,
  removeUserModelInfo,
  userModelInfoRead,
  modelCatalogRead,
  modelDefaultRead,
  modelDefaultChange,
  workspaceModelRead,
  workspaceModelChange,
  // 설정: General, Shell rules, Diagnostics, Tools and skills
  settingsList,
  settingsUpdate,
  diagnosticsStatus,
  workspaceExtensionSettingsRead,
  workspaceExtensionSettingsChange,
  mcpAuthState,
  extensionToolsCatalog,
  // agent
  agentCreate,
  agentChange,
  agentDelete,
  agentProfileImageUpload,
  // project. `project.add`는 안에서 부른 사람의 자격으로 `projects/create`를 writer에 보낸다
  projectApi.register,
  projectApi.edit,
  projectApi.relinkFolder,
  projectApi.archive,
  projectApi.unarchive,
  projectIdentityApi.identity,
  projectIdentityApi.createIdentity,
  projectIdentityApi.renewIdentity,
  projectIdentityApi.match,
  projectAdd,
  projectBrowse,
] as const;

// 다른 컴퓨터의 agent와 앱이 요청한 call이 받는 기계에서 닿는 route다(scope가 아니라 거르기용이다. 모두 REMOTE_ALLOWED_ROUTES에도 있다):
// 앱 목록과 그 command 목록(`machines/app_tools`가 읽는다)과 앱 command 입구. 사람의 route와 확인이 필요한 command는 이 밖이다.
export const REMOTE_AGENT_ROUTES = [
  appList,
  appGet,
  appTools,
  appRemoteCall,
] as const;

// 컴퓨터가 요청한 쪽(`by`) 없이 보내는 frame은 그 컴퓨터의 core가 스스로 하는 일이다(사람이나 agent가 시킨 것이 아니다). 받는 기계는 이 목록
// 하나만 연다. 컴퓨터의 `by` 없는 call이 이 밖이면 `invalid_input`이고, `by`가 있는 call은 이 목록 때문에 더 받는 것이 없다.
// 지금은 폴더로 나르는 file의 pull과 push(`carry/*`)다.
export const REMOTE_CORE_ROUTES = [...CARRY_ROUTES] as const;

// 터미널에서 친 요청(`by: terminal`)이 기기 목록에서 받지 못하는 route다. `terminal`은 사람이 친 것인지 그 사람의 CLI token을 쥔 coding
// agent가 친 것인지 가를 수 없고, 터미널 입력 허락은 그 컴퓨터의 화면에게 준 것이지 그 컴퓨터의 shell에서 도는 것에게 준 것이 아니다.
// 그래서 (가) 터미널·browser page를 움직이는 route는 컴퓨터의 허락이 있어도 `screen` 요청만 받고(`terminals/open`은 빈 터미널도
// 같이 막는다. `terminals/close|restart`는 REMOTE_PERSON_ROUTES라 어차피 못 받는다), (나) agent가 사람에게 물은 것에 사람의 결정을
// 남기는 route(turn request, 질문 답, job 승인, 동의, 공유 요청)는 받지 않는다. `acp/send`는 안에서 그 결정 route들을 부르는 입구라
// 같이 막는다. 요청한 쪽이 `screen`이거나 `by`가 없는 폰이면 이 목록을 보지 않는다. `agent`·`app` 요청은 REMOTE_AGENT_ROUTES뿐이다.
export const REMOTE_TERMINAL_DENIED = [
  terminalsInput,
  terminalsOpen,
  pageViewInput,
  pageViewControl,
  pageViewOpen,
  turnRequestDecide,
  askAnswer,
  jobDecideHold,
  jobApprove,
  activationConsent,
  shareRequestDecide,
  acpSend,
] as const;

// 등록한 기기의 `watch`가 받을 수 있는 event type의 전부다. 기기가 건 조건과 상관없이 core가 이 밖은 보내지 않는다.
// 위 route로 그리는 화면이 듣는 것이다: session 목록의 상태, 대화의 ACP 갱신, 대기 줄(물음, 동의, 공유 요청, 알림, job).
// Jobs, Agents, workflow, 앱 실행 기록은 따로 event가 없고 `StateChanged`의 이름(jobs, agents, workflow_instances, runs,
// app_activity, app_runtime, releases)으로 다시 읽는다. 앱 event는 `AppViewEvent`로만 받는다: 묶인 release가 구독을 선언한 view의
// owner에게만 가고, Gateway가 이 기기(owner)가 연 view의 것만 보낸다. `AppSyncChanged`(앱 id와 seq만 싣는다)도 받는다. `AppEventPublished`(모든 앱의 event 원본)는 폰에
// 내주지 않는다(컴퓨터만 받는다: `REMOTE_COMPUTER_EVENTS`). `AppViewChanged`, 앱 설치·지우기도 넣지 않는다.
export const REMOTE_ALLOWED_EVENTS = [
  // 대화
  "SessionStarted",
  "SessionEnded",
  "TurnStarted",
  "TurnEnded",
  "TurnRequestOpened",
  "TurnRequestClosed",
  "QuestionAsked",
  "QuestionResolved",
  "AcpUpdated",
  // Inbox
  "ActivationConsentRequested",
  "ActivationConsentClosed",
  "ShareRequestOpened",
  "ShareRequestClosed",
  "NoticePosted",
  "NoticeClosed",
  "NoticeRead",
  // 화면 갱신의 공통 event. 바뀐 대상 이름과 id만 싣고 내용은 없다. Inbox가 job hold 등을 이것으로 다시 읽는다.
  "StateChanged",
  // 앱의 폰 화면
  "AppViewEvent",
  // 앱이 지워졌다. 다른 컴퓨터의 창이 그 앱의 화면을 닫는다
  "AppRemoved",
  // 보는 터미널의 화면이 바뀌었다(내용 없이 seq만. 폰이 `terminal_view/snapshot`을 다시 읽는다)
  "TerminalScreenChanged",
  // 터미널이 열리고 끝나고 크기와 이름이 바뀌었다(출력은 싣지 않는다). 다른 컴퓨터의 터미널 탭이 따라간다
  "TerminalRuntimeChanged",
  // 터미널의 coding agent가 사람에게 알릴 계기(물음, 끝, 실패). 다른 컴퓨터의 창이 toast와 OS 알림을 고른다
  "TerminalAgentSignaled",
  // 보는 browser page의 그림이나 상태가 바뀌었다(내용 없이 seq만. `page_view/snapshot`을 다시 읽는다)
  "PageViewChanged",
  // 폰에서 도는 앱: sync log에 줄이 생기면 폰이 pull한다
  "AppSyncChanged",
] as const satisfies readonly BusEvent["type"][];

// 명단의 컴퓨터가 위 목록에 더해 받는 event다. 다른 컴퓨터의 앱 event를 구독하는 job과 앱이 건다. core가 내용으로 한 번 더 가린다: 앱이 선언해 낸
// event(audience가 없다)이고 그 앱의 workspace가 이 기계의 call 정책에서 private이 아닌 것만 간다(`lophn`이 낸 event와 다른 기계에서 와 이 기계가 낸 것은 안 간다).
export const REMOTE_COMPUTER_EVENTS = [
  "AppEventPublished",
] as const satisfies readonly BusEvent["type"][];
