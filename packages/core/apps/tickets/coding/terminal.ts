// shell main이 알려 준 터미널 요청의 결과와 process 끝.
import { ok, type Result } from "../../../../base/mod.ts";
import { HOOK_EVENT_TABLE } from "../../../../protocol/coding-agent/hook-signal.ts";
import { HARNESS_ADAPTERS } from "../../../../protocol/coding-agent/harness-adapter.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";
import { messageReceived } from "./events.ts";
import type { CodingMemory } from "./memory.ts";
import { endSession, ensureStarted } from "./sessions.ts";
import { loadSession, saveSession, type SessionRow } from "./store.ts";

export type TerminalResult = { request: string; ok: boolean };

// open이 ok이면 첫 prompt가 harness에 넘어갔다. hook이 있는 제품은 SessionStarted hook이 오면 그때 알린다.
function opened(tx: Tx, row: SessionRow): void {
  if (HARNESS_ADAPTERS[row.harness].prompt?.kind === "argv") {
    row.prompt_pending = true;
  }
  if (Object.keys(HOOK_EVENT_TABLE[row.harness]).length === 0) {
    ensureStarted(tx, row);
  }
}

export function applyTerminalResult(
  tx: Tx,
  memory: CodingMemory,
  result: TerminalResult,
): Result<void> {
  const pending = memory.requests.get(result.request);
  if (pending === undefined) return ok(undefined);
  memory.requests.delete(result.request);
  const row = loadSession(tx.sql, pending.session);
  if (row === null || row.ended) return ok(undefined);
  if (pending.kind === "input") {
    // 넣지 못한 메시지는 이미 Router가 배달했다고 본 것이라 되돌릴 길이 없다.
    if (result.ok) {
      messageReceived(tx, row.session, pending.call, pending.text);
    } else {
      saveSession(tx.sql, { ...row, inflight: false });
    }
    return ok(undefined);
  }
  if (!result.ok) return endSession(tx, memory, row.session);
  if (pending.kind === "open") {
    opened(tx, row);
    saveSession(tx.sql, row);
  }
  return ok(undefined);
}

export function applyTerminalExited(
  tx: Tx,
  memory: CodingMemory,
  session: string,
): Result<void> {
  return endSession(tx, memory, session);
}
