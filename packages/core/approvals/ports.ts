import type { Result } from "../../base/mod.ts";
import type {
  GateCall,
  Judgment,
  TurnRequest,
  TurnRequestOutcome,
} from "../../protocol/approvals/mod.ts";
import type { AgentId, Place } from "../../protocol/lophn-agent/places.ts";
import type { TurnMode } from "../../protocol/lophn-agent/turn-values.ts";

// `always`를 고르면 그 kind의 request에 하는 일. request의 `always_patterns`를 규칙으로 더하는 등이다.
export type AlwaysEffect = (
  request: TurnRequest,
  place: Place | null,
) => Promise<Result<void>>;

// request가 열린 자리. 어느 turn의 어느 tool call이 기다리는가.
export type TurnOrigin = {
  session: string;
  turn: string;
  tool_call: string;
  place: Place | null;
};

// Gate를 부르는 쪽이 쓰는 한 입구. Bus는 생성자에서 받는다.
export interface Approvals {
  // 할당과 shell 규칙을 읽어 Gate를 돌린다.
  judge(
    call: GateCall,
    who: {
      agent: AgentId;
      session: string;
      place: Place | null;
      mode: TurnMode;
    },
  ): Promise<Result<Judgment>>;
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
