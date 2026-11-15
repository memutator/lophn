import { acpDraft, acpSend, acpSnapshot } from "../acp/routes.ts";
import { assignmentGet } from "../approvals/assignment.ts";
import {
  shareRequestDecide,
  shareRequestList,
} from "../approvals/share-request.ts";
import { turnRequestDecide } from "../approvals/turn-request.ts";
import {
  activationConsent,
  activationConsents,
} from "../apps/activation/consent.ts";
import {
  releasesGetRecord,
  releasesListRecords,
} from "../apps/activation/activation.ts";
import { appGet, appList } from "../apps/apps.ts";
import { appInvocation, appInvocations } from "../apps/calls/invocation.ts";
import { appRewindPlan } from "../apps/calls/rewind.ts";
import { appIcon, appTools } from "../apps/declaration/read.ts";
import {
  noticeDismiss,
  noticeMarkRead,
  noticesList,
  noticesOpen,
} from "../apps/notice.ts";
import { appRuntime } from "../apps/runtime.ts";
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
import { remoteUiFile, remoteUiManifest } from "./routes.ts";

// 등록한 기기가 부를 수 있는 route의 전부다. 기기 자격의 scope가 이 이름들이고, 밖의 route는 `forbidden`이다.
// 폰은 일하는 창이다: 보고, 말하고, 답하고, 켜고 끄고, 시작하는 route만 둔다.
// 만들기·고치기·지우기(agent, job, 앱, project, workflow 정의), secret, provider·model 관리, 설정 쓰기, 기기와 pairing, `host/*`,
// `tabs/*`, `sessions/delete`(되돌릴 수 없다), `sessions/change-skip`(사람에게 묻지 않고 돌게 하는 권한 설정이다)은 넣지 않는다.
// `jobs/update`는 켜고 끄기(`enabled`)만 받는다(core/remote/call.ts). `acp/send`는 안의 route를 기기 자격으로 부르므로 대화 조작 route도 여기 있어야 한다.
// 모두 user가 부를 수 있는 route여야 한다(아니면 core가 기기 자격을 만들지 못한다).
// file·upload route의 bytes는 `call`에서 base64로 싣는다(core/remote/call.ts). 폰은 화면 bundle도 이 목록의 route로 받는다.
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
  // 대화
  acpSnapshot,
  acpDraft,
  acpSend,
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
  // 화면 bundle
  remoteUiManifest,
  remoteUiFile,
] as const;

// 등록한 기기의 `watch`가 받을 수 있는 event type의 전부다. 기기가 건 조건과 상관없이 core가 이 밖은 보내지 않는다.
// 위 route로 그리는 화면이 듣는 것이다: session 목록의 상태, 대화의 ACP 갱신, 대기 줄(물음, 동의, 공유 요청, 알림, job).
// Jobs, Agents, workflow, 앱 실행 기록은 따로 event가 없고 `StateChanged`의 이름(jobs, agents, workflow_instances, runs,
// app_activity, app_runtime, releases)으로 다시 읽는다. 앱 event(`AppEventPublished`, 앱이 정한 payload), 앱 설치·지우기·화면은 넣지 않는다.
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
] as const satisfies readonly BusEvent["type"][];
