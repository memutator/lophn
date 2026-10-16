// harness hook을 agent event로 바꾸고 session 상태를 고친다. 상태는 event에서만 계산한다.
import { ok, type Result } from "../../../../base/mod.ts";
import { choicesFor } from "../../../../protocol/approvals/requests.ts";
import type { HarnessId } from "../../../../protocol/coding-agent/harness-id.ts";
import {
  type HookSignal,
  hookSignalOf,
} from "../../../../protocol/coding-agent/hook-signal.ts";
import { firstPromptOf } from "../../../../protocol/coding-agent/launch-plan.ts";
import type { AgentEvent } from "../../../../protocol/events/mod.ts";
import type { Intent } from "../../../../protocol/approvals/mod.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { intentFingerprint } from "../../../approvals/mod.ts";
import { emitAgent } from "./events.ts";
import { deliverInput } from "./input.ts";
import type { CodingMemory } from "./memory.ts";
import { ensureStarted } from "./sessions.ts";
import {
  loadSession,
  saveSession,
  type SessionRow,
  shiftInput,
} from "./store.ts";

export type HookInput = {
  session: string;
  harness: HarnessId;
  event: string;
  payload: unknown;
};

const OUTCOMES = {
  completed: { kind: "completed", reason: "answer_completed" },
  failed: { kind: "failed", reason: "model_error" },
  interrupted: { kind: "interrupted", reason: "user_stopped" },
} as const;

function emit(
  tx: Tx,
  row: SessionRow,
  type: AgentEvent["type"],
  payload: unknown,
): void {
  emitAgent(tx, {
    session: row.session,
    type,
    at: tx.now(),
    payload,
  } as AgentEvent);
}

// harness가 묻는 권한은 lophn이 답하지 않고 대기 목록에 보이기만 한다. 요청의 모양은 turn 요청을 빌린다.
function permissionRequest(
  tx: Tx,
  row: SessionRow,
  turn: string,
  request: NonNullable<HookSignal["request"]>,
) {
  const tool_call = tx.newId("tcl");
  const intent = {
    kind: "mcp_tool",
    actor: { kind: "program", seq: "0" },
    target: {
      kind: "mcp_tool",
      server: `harness:${row.harness}`,
      tool: request.tool ?? "permission",
    },
    effect: "write",
    input: request.summary === null ? {} : { summary: request.summary },
    origin: { kind: "turn", session: row.session, turn, tool_call },
  } as Intent;
  return {
    id: tx.newId("apr"),
    session: row.session,
    turn,
    tool_call,
    intent,
    choices: [...choicesFor("mcp_tool")],
    fingerprint: intentFingerprint(intent),
    created_at: tx.now(),
  };
}

// 도는 turn과 권한 물음이 없을 때 대기열의 메시지 하나를 넣는다.
function drain(tx: Tx, memory: CodingMemory, row: SessionRow): void {
  if (row.running || row.inflight || row.permissions.length > 0) return;
  const next = shiftInput(tx.sql, row.session);
  if (next !== null) deliverInput(tx, memory, row, next.call, next.text);
}

function apply(
  tx: Tx,
  memory: CodingMemory,
  row: SessionRow,
  signal: HookSignal,
): void {
  switch (signal.type) {
    case "SessionStarted":
      row.external_session = signal.external_session ?? row.external_session;
      ensureStarted(tx, row);
      // 첫 prompt를 argv로 못 넘기는 제품은 이 hook 뒤에 넣는다. 기한이 지나면 넣지 않는다.
      if (row.paste_until !== null) {
        if (tx.now() <= row.paste_until) {
          deliverInput(tx, memory, row, row.call, firstPromptOf(row.ticket));
        }
        row.paste_until = null;
      }
      return;
    case "TurnStarted":
      ensureStarted(tx, row);
      row.running = true;
      row.inflight = false;
      row.turn = tx.newId("trn");
      emit(tx, row, "TurnStarted", {
        turn: row.turn,
        input_message: tx.newId("msg"),
      });
      return;
    case "TurnEnded": {
      ensureStarted(tx, row);
      const outcome = OUTCOMES[signal.outcome ?? "completed"];
      emit(tx, row, "TurnEnded", {
        turn: row.turn ?? tx.newId("trn"),
        outcome,
        messages: [],
        error: outcome.kind === "failed"
          ? {
            code: "harness_failed",
            message: "the harness ended the turn with a failure",
          }
          : null,
      });
      row.running = false;
      row.inflight = false;
      row.turn = null;
      drain(tx, memory, row);
      return;
    }
    case "PermissionRequested": {
      ensureStarted(tx, row);
      const request = permissionRequest(
        tx,
        row,
        row.turn ?? tx.newId("trn"),
        signal.request ?? { tool: null, summary: null },
      );
      row.permissions.push(request.id);
      emit(tx, row, "PermissionRequested", { request });
      return;
    }
    case "PermissionResolved": {
      // 대기 중인 물음이 없으면 tool이 그냥 실행된 것이다.
      const id = row.permissions.shift();
      if (id !== undefined) {
        emit(tx, row, "PermissionResolved", { request: id, outcome: "allow" });
        drain(tx, memory, row);
      }
      return;
    }
    case "SessionEnded":
      // 끝은 터미널 process의 exit으로만 정한다.
      return;
  }
}

export function applyHook(
  tx: Tx,
  memory: CodingMemory,
  input: HookInput,
): Result<{ accepted: boolean }> {
  const row = loadSession(tx.sql, input.session);
  if (row === null || row.ended || row.harness !== input.harness) {
    return ok({ accepted: false });
  }
  const signal = hookSignalOf(row.harness, input.event, input.payload);
  if (signal === null) return ok({ accepted: false });
  row.heard = true;
  apply(tx, memory, row, signal);
  saveSession(tx.sql, row);
  return ok({ accepted: true });
}
