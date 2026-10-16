import type { AgentEvent } from "../../../protocol/events/mod.ts";
import type { TurnOutcome } from "../../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import { AGENT_EVENT_TOPIC } from "./topics.ts";

// core가 turn을 시작하고 끝낼 때 Bus로 내는 agent event. turn 행을 바꾸는 쪽(command, 켤 때·session 끝날 때
// 닫기)이 같은 자리에서 낸다. Bus는 메모리라 놓칠 수 있고 정본은 turn 행이다.

// handler는 writer Worker에서 돌아 Bus에 닿지 못한다. 보낼 event는 tx가 commit된 뒤 main thread가 낸다
// (`publishAfterCommit`). tx가 되돌아가면 내지 않는다.
export type PublishAgentEvent = (tx: Tx, event: AgentEvent) => void;

export const publishAfterCommit: PublishAgentEvent = (tx, event) =>
  tx.port(afterCommit).push(AGENT_EVENT_TOPIC, event);

// 끝난 turn의 session 기록에서 이 turn이 가진 message다.
function messagesOf(tx: Tx, turn: string): string[] {
  return tx.sql.all(
    "select id from messages where turn = ? order by created_seq",
    [turn],
  ).map((row) => String(row["id"]));
}

export function publishTurnEnded(
  tx: Tx,
  publish: PublishAgentEvent | undefined,
  turn: { id: string; session: string },
  outcome: TurnOutcome,
): void {
  if (publish === undefined) return;
  publish(tx, {
    session: turn.session,
    type: "TurnEnded",
    at: tx.now(),
    payload: {
      turn: turn.id,
      outcome,
      messages: messagesOf(tx, turn.id),
      error: outcome.kind === "failed"
        ? { code: outcome.reason, message: outcome.reason.replaceAll("_", " ") }
        : null,
    },
  } as AgentEvent);
}
