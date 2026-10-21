// session 하나의 시작과 끝. 표 읽기·쓰기는 store.ts, 줄은 lines.ts가 맡는다.
import { ok, type Result } from "../../../base/mod.ts";
import { firstPromptOf } from "../../../protocol/coding-agent/launch-plan.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import { closeCall } from "./close-call.ts";
import {
  messageReceived,
  revokeToken,
  sessionEnded,
  sessionStarted,
} from "./events.ts";
import { openNext } from "./lines.ts";
import type { CodingMemory } from "./memory.ts";
import {
  clearInputs,
  loadSession,
  saveSession,
  type SessionRow,
} from "./store.ts";

// SessionStarted를 아직 내지 않았으면 낸다. 첫 prompt를 argv로 넘겼으면 이어서 MessageReceived를 낸다.
// 둘의 순서가 바뀌지 않게, 터미널 결과가 hook보다 늦게 와도 여기서 첫 prompt를 알린다.
// row를 바꾼다. 부른 쪽이 저장한다.
export function ensureStarted(tx: Tx, row: SessionRow): void {
  if (!row.started) {
    row.started = true;
    sessionStarted(tx, row);
  }
  if (row.prompt_pending) {
    row.prompt_pending = false;
    messageReceived(
      tx,
      row.session,
      row.call,
      firstPromptOf(row.app, row.prompt),
    );
  }
}

// process가 끝났거나 띄우지 못했다. 맡긴 call을 닫고 token을 회수하고 줄의 다음 call을 연다.
export function endSession(
  tx: Tx,
  memory: CodingMemory,
  session: string,
): Result<void> {
  const row = loadSession(tx.sql, session);
  if (row === null || row.ended) return ok(undefined);
  saveSession(tx.sql, {
    ...row,
    ended: true,
    running: false,
    inflight: false,
    permissions: [],
    paste_until: null,
  });
  clearInputs(tx.sql, session);
  if (row.started) sessionEnded(tx, session);
  revokeToken(tx, session);
  const closed = closeCall(tx, { call: row.call, session, app: row.app });
  if (!closed.ok) return closed;
  return openNext(tx, memory, row.app);
}
