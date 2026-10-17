import type { Result } from "../../base/mod.ts";
import type {
  AgentGrant,
  ApplyResult,
  GateGrants,
  GateVerdict,
  Intent,
  PendingApproval,
  ReactionGrant,
  TurnDecision,
  TurnPermissionRequest,
} from "../../protocol/approvals/mod.ts";
import type { AppGrant } from "../../protocol/apps/grants.ts";
import type { AgentRef } from "../../protocol/lophn-agent/places.ts";

// Gate는 intent와 그때의 grant만 보는 순수 함수다. IO가 없다.
export type Gate = (intent: Intent, grants: GateGrants) => GateVerdict;

// grant의 주인. 앱 grant는 activation, agent grant는 할당, reaction grant는 Settings에서 온다.
export interface Grants {
  appGrants(app: string): Promise<Result<AppGrant[]>>;
  agentGrant(agent: AgentRef): Promise<Result<AgentGrant>>;
  reactionGrant(): Promise<Result<ReactionGrant>>;
  // "항상" 선택의 효과: 그 대상의 agent grant를 never로 바꾼다.
  setAlways(agent: AgentRef, target: Intent["target"]): Promise<Result<void>>;
}

// "이 session 동안" 허락. 메모리에만 두고 저장하지 않는다.
// 재시작하면 사라지고 fork가 가져가지 않는다. session이 닫히거나 archive되거나 지워질 때 clear를 부른다.
// key는 intent에서 만든 대상 key 문자열이다.
export interface SessionAllowances {
  allow(session: string, key: string): void;
  has(session: string, key: string): boolean;
  clear(session: string): void;
}

// 보류 request가 허락됐을 때 그 종류를 다시 검사하고 실행한다. 소유 module(releases, events)이 등록한다.
export type ApprovalApplier = (
  request: PendingApproval,
) => Promise<Result<ApplyResult>>;

// Gate를 부르는 쪽이 쓰는 한 입구. Bus는 생성자에서 받는다.
export interface Approvals {
  // grant를 읽어 Gate를 돌린다. intent 출처가 turn이면 SessionAllowances를 보고,
  // 허락돼 있으면 ask를 run으로 바꾼다.
  judge(intent: Intent): Promise<Result<GateVerdict>>;
  // 메모리에 두고 Bus에 PermissionRequested를 낸다.
  openTurnRequest(intent: Intent): Result<TurnPermissionRequest>;
  waitTurnDecision(request: string): Promise<TurnDecision>;
  // 허락은 그 intent에 한 번만 쓰인다. 실행 직전에 fingerprint를 다시 비교해 다르면 conflict.
  consumeTurnAllow(request: string, current: Intent): Promise<Result<void>>;
  // turn 끝, session 닫힘, 시작 때 정리. PermissionResolved(cancelled)를 낸다.
  cancelTurnRequests(
    session: string,
    cause: Extract<TurnDecision, { outcome: "cancelled" }>["cause"],
  ): void;
  // session snapshot이 읽는다.
  turnRequests(session: string): TurnPermissionRequest[];
  // approval_requests에 쓰고 commit 뒤 ApprovalRequested를 낸다.
  createPending(intent: Intent): Promise<Result<PendingApproval>>;
  registerApplier(
    kind: "activation" | "reaction",
    applier: ApprovalApplier,
  ): void;
  // 더 새 release의 activation이 시작되면 이전 보류 request를 cancelled로 만든다.
  cancelPendingFor(app: string, release?: string): Promise<Result<number>>;
  // activation이 보류 request를 읽는다. 없는 id는 null이다.
  request(id: string): Promise<Result<PendingApproval | null>>;
  pending(): Promise<Result<PendingApproval[]>>;
}
