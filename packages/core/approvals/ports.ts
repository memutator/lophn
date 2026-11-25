import type { Result } from "../../base/mod.ts";
import type {
  GateCall,
  Judgment,
  PermissionDenial,
  RecentDenial,
  TurnRequest,
  TurnRequestChoiceKind,
  TurnRequestOutcome,
} from "../../protocol/approvals/mod.ts";
import type { McpTrust } from "../../protocol/lophn-agent/mcp-settings.ts";
import type {
  ExecutionContext,
  PermissionMode,
} from "../../protocol/lophn-agent/turn-values.ts";
import type {
  AgentId,
  Workspace,
} from "../../protocol/lophn-agent/workspaces.ts";
import type { SessionGrantStore } from "./session-grants.ts";

// `always`를 고르면 그 kind의 request에 하는 일. request의 `always_patterns`를 규칙으로 더하는 등이다.
export type AlwaysEffect = (
  request: TurnRequest,
  workspace: Workspace | null,
) => Promise<Result<void>>;

// `session`을 고르면 이 대화 동안 허락을 기록하는 일.
export type SessionEffect = (
  request: TurnRequest,
  workspace: Workspace | null,
) => Promise<Result<void>>;

// request가 열린 자리. 어느 turn의 어느 tool call이 기다리는가.
export type TurnOrigin = {
  session: string;
  turn: string;
  tool_call: string;
  workspace: Workspace | null;
  // 팀 자식의 request면 true: 사람이 아니라 부모가 푼다(카드도 always도 없다).
  toParent: boolean;
};

export type OpenTurnRequestOptions = {
  readonly allowedChoices?: readonly TurnRequestChoiceKind[];
  readonly reason?: string | null;
  readonly outsideRewind?: boolean;
  readonly alwaysPatterns?: readonly string[];
};

// 부모가 ask call에 답했거나 끝났을 때 조립이 알려 주는 입구다. approvals는 Router를 모르고, call과 request의 짝은 조립이 갖는다.
export type AskReplies = {
  answered(data: {
    call: string;
    decision: "allow" | "reject" | null;
    text: string;
  }): void;
  ended(data: { call: string }): void;
};

export type JudgeWho = {
  agent: AgentId;
  session: string;
  workspace: Workspace | null;
  mode: PermissionMode;
  context: ExecutionContext;
  tool?: string;
  mcpTrust?: McpTrust;
};

// Gate를 부르는 쪽이 쓰는 한 입구. Bus는 생성자에서 받는다.
export interface Approvals {
  // 할당·권한 규칙·session grant를 읽어 통합 판정 엔진을 돌린다.
  judge(call: GateCall, who: JudgeWho): Promise<Result<Judgment>>;
  // 메모리에 두고 Bus에 TurnRequestOpened를 낸다.
  openTurnRequest(
    origin: TurnOrigin,
    subject: TurnRequest["subject"],
    options?: OpenTurnRequestOptions,
  ): Result<TurnRequest>;
  waitTurnDecision(request: string): Promise<TurnRequestOutcome>;
  // turn 끝, session 닫힘, 시작 때 정리. TurnRequestClosed(cancelled)를 낸다.
  cancelTurnRequests(
    session: string,
    cause: Extract<TurnRequestOutcome, { outcome: "cancelled" }>["cause"],
  ): void;
  // session snapshot이 읽는다.
  turnRequests(session: string): TurnRequest[];
  // `always`가 그 kind에서 하는 일을 등록한다. 같은 kind를 두 번 등록하면 뒤 것이 쓰인다.
  remember(kind: GateCall["kind"], effect: AlwaysEffect): void;
  // `session` 선택지 효과를 덮어쓰거나 덧붙인다.
  rememberSession(effect: SessionEffect): void;
  // 거부 기록을 session 메모리에 남기고 Bus에 PermissionDenied event를 낸다.
  publishDenial(
    origin: { session: string; turn: string; tool_call: string },
    denial: PermissionDenial,
  ): RecentDenial;
  // 이 대화 동안 허락·최근 거부 저장소.
  readonly sessionGrants: SessionGrantStore;
}
