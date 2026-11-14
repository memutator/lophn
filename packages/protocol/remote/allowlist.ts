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
