import { acpDraft, acpSend, acpSnapshot } from "../acp/routes.ts";
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
  noticeDismiss,
  noticeMarkRead,
  noticesList,
  noticesOpen,
} from "../apps/notice.ts";
import type { BusEvent } from "../events/bus.ts";
import { sessionSnapshotsList } from "../events/snapshot.ts";
import {
  jobApprove,
  jobDecideHold,
  jobHolds,
  jobPending,
} from "../jobs/jobs.ts";
import { workspaceSessionList } from "../lophn-agent/agent-sessions.ts";
import { askAnswer, askRead } from "../lophn-agent/ask-tool.ts";

// 등록한 기기가 부를 수 있는 route의 전부다. 기기 자격의 scope가 이 이름들이고, 밖의 route는 `forbidden`이다.
// 대화와 Inbox가 쓰는 것에서 시작한다. secret, provider, 설정 쓰기, 기기와 pairing, 앱 지우기, `host/*`는 넣지 않는다.
// 모두 user가 부를 수 있는 route여야 한다(아니면 core가 기기 자격을 만들지 못한다).
export const REMOTE_ALLOWED_ROUTES = [
  // 대화
  workspaceSessionList,
  sessionSnapshotsList,
  acpSnapshot,
  acpDraft,
  acpSend,
  askRead,
  askAnswer,
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
] as const;

// 등록한 기기의 `watch`가 받을 수 있는 event type의 전부다. 기기가 건 조건과 상관없이 core가 이 밖은 보내지 않는다.
// 위 route로 그리는 대화와 Inbox 화면이 듣는 것이다: session 목록의 상태, 대화의 ACP 갱신, 대기 줄(물음, 동의, 공유 요청, 알림, job).
// 앱 event(`AppEventPublished`, 앱이 정한 payload), 설정, 앱 설치·지우기·화면, workflow는 넣지 않는다.
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
