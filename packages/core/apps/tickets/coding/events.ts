// commit 뒤 main thread가 하는 일을 모은다. agent event는 Bus로, 터미널 요청은 Gateway로 간다.
import type { AgentEvent } from "../../../../protocol/events/mod.ts";
import type { CodingTerminalRequest } from "../../../../protocol/coding-agent/terminal-requests.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { afterCommit } from "../../../storage/ledger/after-commit.ts";
import { AGENT_EVENT_TOPIC } from "../../../lophn-agent/run-loop/topics.ts";
import { createCallStore } from "../../../router/mod.ts";
import { codingPlace, type SessionRow } from "./store.ts";

export const CODING_TERMINAL_TOPIC = "coding_terminal";
export const CODING_REVOKE_TOPIC = "coding_revoke";

export function emitAgent(tx: Tx, event: AgentEvent): void {
  tx.port(afterCommit).push(AGENT_EVENT_TOPIC, event);
}

export function sendTerminal(tx: Tx, request: CodingTerminalRequest): void {
  tx.port(afterCommit).push(CODING_TERMINAL_TOPIC, request);
}

// token은 main thread의 credential registry에 있어 회수도 commit 뒤에 한다.
export function revokeToken(tx: Tx, session: string): void {
  tx.port(afterCommit).push(CODING_REVOKE_TOPIC, { session });
}

export function sessionStarted(tx: Tx, row: SessionRow): void {
  emitAgent(tx, {
    session: row.session,
    type: "SessionStarted",
    at: tx.now(),
    payload: {
      agent: { role: "coding_agent", app: row.app },
      place: codingPlace(tx.sql, row.app),
      external_session: row.external_session,
      revived: false,
    },
  } as AgentEvent);
}

export function sessionEnded(tx: Tx, session: string): void {
  emitAgent(tx, {
    session,
    type: "SessionEnded",
    at: tx.now(),
    payload: { reason: "exited" },
  } as AgentEvent);
}

// harness에 넣은 메시지다. 보낸 쪽은 call이 안다. call이 없으면 program이 넣은 것으로 둔다.
export function messageReceived(
  tx: Tx,
  session: string,
  call: string | null,
  body: string,
): void {
  const record = call === null
    ? null
    : createCallStore().read(tx, call as never);
  emitAgent(tx, {
    session,
    type: "MessageReceived",
    at: tx.now(),
    payload: {
      message: tx.newId("msg"),
      body,
      from: record?.from ?? { kind: "program", event_seq: "0" },
      call,
      reply_to: null,
      steer: false,
    },
  } as AgentEvent);
}
