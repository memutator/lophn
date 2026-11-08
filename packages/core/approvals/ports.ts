import type { Result } from "../../base/mod.ts";
import type {
  GateCall,
  Judgment,
  TurnRequest,
  TurnRequestOutcome,
} from "../../protocol/approvals/mod.ts";
import type {
  AgentId,
  Workspace,
} from "../../protocol/lophn-agent/workspaces.ts";
import type { TurnMode } from "../../protocol/lophn-agent/turn-values.ts";
import type { ExtensionGrant } from "./gate/mod.ts";

// `always`를 고르면 그 kind의 request에 하는 일. request의 `always_patterns`를 규칙으로 더하는 등이다.
export type AlwaysEffect = (
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

// 부모가 ask call에 답했거나 끝났을 때 조립이 알려 주는 입구다. approvals는 Router를 모르고, call과 request의 짝은 조립이 갖는다.
export type AskReplies = {
  answered(data: {
    call: string;
    decision: "allow" | "reject" | null;
    text: string;
  }): void;
  ended(data: { call: string }): void;
};

// Gate를 부르는 쪽이 쓰는 한 입구. Bus는 생성자에서 받는다.
export interface Approvals {
  // 할당과 shell 규칙을 읽어 Gate를 돌린다.
  judge(
    call: GateCall,
    who: {
      agent: AgentId;
      session: string;
      workspace: Workspace | null;
      mode: TurnMode;
      // spawned_by가 있고 skip이 아닌 session이면 true. 이때 shell ask는 mode와 상관없이 부모에게 간다.
      toParent: boolean;
    },
  ): Promise<Result<Judgment>>;
  // `extension_tool`을 판정하는 재료(그 agent의 정의 `extensions`와 켜진 extension의 tool 목록)를 읽는 길을 등록한다.
  // 등록하지 않으면 모든 extension tool은 `not_assigned`다.
  useExtensions(
    read: (agent: AgentId) => Promise<Result<ExtensionGrant>>,
  ): void;
  // 메모리에 두고 Bus에 TurnRequestOpened를 낸다.
  openTurnRequest(
    origin: TurnOrigin,
    subject: TurnRequest["subject"],
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
}
