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
import { appViewsCall, appViewsClose, appViewsOpen } from "../apps/views.ts";
import { appWidgetsList } from "../apps/widget.ts";
import {
  codingSessionsList,
  codingSessionsOpen,
  codingSessionsSwitch,
  codingSessionsSwitchPlan,
} from "../coding-agent/relay.ts";
import {
  terminalViewResize,
  terminalViewSnapshot,
  terminalViewWatch,
} from "../coding-agent/terminal-view.ts";
import { terminalsInput, terminalsOpen } from "../coding-agent/terminals.ts";
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
import {
  agentCard,
  agentList,
  agentProfileImageRead,
  agentRead,
} from "../lophn-agent/agent-definitions.ts";
import {
  workspaceSessionList,
  workspaceSessionOpen,
  workspaceSessionRead,
} from "../lophn-agent/agent-sessions.ts";
import { askAnswer, askRead } from "../lophn-agent/ask-tool.ts";
import { agentCallRead, callCancel } from "../lophn-agent/calls.ts";
import {
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
import { messageBody } from "../lophn-agent/messages.ts";
import { providerRead } from "../lophn-agent/providers.ts";
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
import { projectApi } from "../projects/project-api.ts";
import {
  projectFilesList,
  projectFilesRead,
} from "../projects/project-files.ts";
import { projectSearch } from "../projects/project-search.ts";
import { runList, runRead } from "../runs/runs.ts";
import {
  workflowInstanceList,
  workflowInstanceRead,
  workflowList,
  workflowStart,
  workflowStop,
} from "../workflows/routes.ts";
import { devicesSetPush, rosterLeave } from "./routes.ts";

// 등록한 기기가 부를 수 있는 route의 전부다. 기기 자격의 scope가 이 이름들이고, 밖의 route는 `forbidden`이다.
// 폰은 일하는 창이다: 보고, 말하고, 답하고, 켜고 끄고, 시작하는 route만 둔다.
// 만들기·고치기·지우기(agent, job, 앱, project, workflow 정의), secret, provider·model 관리, 설정 쓰기, 기기와 명단(자기를 명단에서 빼는
// `roster/leave`와 자기 push 설정 `devices/set_push`만 둔다),
// `tabs/*`, `sessions/delete`(되돌릴 수 없다), `sessions/change-skip`(사람에게 묻지 않고 돌게 하는 권한 설정이다)은 넣지 않는다.
// 컴퓨터의 coding agent(`coding_sessions/*`)는 폰이 목록을 보고 view를 바꾸고 새로 연다. 폰이 시작한 switch도
// `confirmed: true`가 있어야 한다(도는 turn이 끊긴다). 터미널은 `terminals/open|input`으로 열고 치고, 화면은 `terminal_view/*`로 본다.
// `terminals/input`은 목록에 있어도 사람이 컴퓨터에서 이 기기의 터미널 입력을 켰을 때만 core가 받는다. 그 스위치
// (`roster/set_terminal_input`)와 `host/*`는 넣지 않는다.
// `jobs/update`는 켜고 끄기(`enabled`)만 받는다(core/remote/call.ts). `acp/send`는 안의 route를 기기 자격으로 부르므로 대화 조작 route도 여기 있어야 한다.
// 모두 user가 부를 수 있는 route여야 한다(아니면 core가 기기 자격을 만들지 못한다).
// 다 본 session의 표시(`unseen/list|dismiss`)를 둔다: 보는 것이 읽음을 만들고 읽음은 host에 있다(어느 기기에서 봐도 같이 꺼진다).
// file·upload route의 bytes는 `call`에서 base64로 싣는다(core/remote/call.ts). 폰은 화면 bundle도 이 목록의 route로 받는다.
// 앱의 폰 화면: 목록(`apps/phone_screens`), 화면 file(`apps/screen_file`), 폰 backend file(`apps/phone_file`), view binding(`app_views/*`)만 둔다. 폰 화면 bridge는
// view id로만 앱을 부르고, 부를 수 있는 operation은 core가 그 view에 묶인 release의 선언에 있는 것만으로 판정한다. 그래서
// 앱을 직접 부르는 `apps/call_tool`과 grant(`app_grants/*`)는 넣지 않는다. 화면 오류를 쓰는 `apps/log_view_error`도 넣지 않는다:
// 입력의 앱을 부르는 쪽이 정해서 다른 앱의 log에 쓸 수 있다.
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
  // 터미널 화면: 화면 읽기, 보는 동안의 lease, 보는 터미널의 PTY 크기를 폰에 맞추기
  terminalViewSnapshot,
  terminalViewWatch,
  terminalViewResize,
  // core가 여는 터미널: 열기와 입력. 입력은 허락받은 기기만 core가 받는다
  terminalsOpen,
  terminalsInput,
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
  // 폰 홈 화면 위젯의 값: 폰이 위젯을 그리려면 읽어야 한다
  appWidgetsList,
  // 폰에서 도는 앱: 설치(snapshot)와 맞추기(push, pull)
  appSyncPush,
  appSyncPull,
  appSyncSnapshot,
  appSyncSnapshotFile,
  // 기기가 자기를 내 기기 명단에서 뺀다
  rosterLeave,
  // push: 폰이 자기 token과 알림 설정을 두고, 지금 앞에 보이는지를 알린다
  devicesSetPush,
  presenceReport,
] as const;

// 등록한 기기의 `watch`가 받을 수 있는 event type의 전부다. 기기가 건 조건과 상관없이 core가 이 밖은 보내지 않는다.
// 위 route로 그리는 화면이 듣는 것이다: session 목록의 상태, 대화의 ACP 갱신, 대기 줄(물음, 동의, 공유 요청, 알림, job).
// Jobs, Agents, workflow, 앱 실행 기록은 따로 event가 없고 `StateChanged`의 이름(jobs, agents, workflow_instances, runs,
// app_activity, app_runtime, releases)으로 다시 읽는다. 앱 event는 `AppViewEvent`로만 받는다: 묶인 release가 구독을 선언한 view의
// owner에게만 가고, Gateway가 이 기기(owner)가 연 view의 것만 보낸다. `AppSyncChanged`(앱 id와 seq만 싣는다)도 받는다. `AppEventPublished`(모든 앱의 event 원본), `AppViewChanged`,
// 앱 설치·지우기는 넣지 않는다.
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
  // 보는 터미널의 화면이 바뀌었다(내용 없이 seq만. 폰이 `terminal_view/snapshot`을 다시 읽는다)
  "TerminalScreenChanged",
  // 폰에서 도는 앱: sync log에 줄이 생기면 폰이 pull한다
  "AppSyncChanged",
] as const satisfies readonly BusEvent["type"][];
