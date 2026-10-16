// 켤 때 한 번. 살아 있는 session이 없으므로 claim이 남은 모든 session을 정산한다. token은 저장하지 않아
// 회수할 것이 없고, 앱 줄과 대기열은 메모리 값이라 비운다. 정산한 session의 call을 Reactor가 찾을 수 있게
// 이번에 끝난 session 행은 다음 켤 때까지 남긴다.
import type { Result } from "../../../../base/mod.ts";
import { ok } from "../../../../base/mod.ts";
import { TicketSessionEnd } from "../../../../protocol/coding-agent/ticket/ports.ts";
import type { Tx } from "../../../../protocol/server/mod.ts";

export function recoverCoding(tx: Tx): Result<{ settled: number }> {
  const settled = tx.port(TicketSessionEnd).settleAll();
  if (!settled.ok) return settled;
  tx.sql.run("DELETE FROM coding_sessions WHERE ended = 1", []);
  tx.sql.run("UPDATE coding_sessions SET ended = 1 WHERE ended = 0", []);
  tx.sql.run("DELETE FROM coding_lines", []);
  tx.sql.run("DELETE FROM coding_inputs", []);
  return ok({ settled: settled.value });
}
