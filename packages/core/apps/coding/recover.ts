// 켤 때 한 번. 살아 있는 session이 없으므로 끝나지 않은 모든 session 행을 끝낸 것으로 둔다. token은 저장하지
// 않아 회수할 것이 없고, 앱 줄과 대기열은 메모리 값이라 비운다. call은 여기서 닫지 않는다. 열린 coding call은
// Router의 `RecoverCalls`가 닫는다. 이번에 끝난 session 행은 다음 켤 때까지 남겨 Router의 `find`가 앞 실행에서
// 끝난 coding session을 닫힌 것으로 답하게 한다(`router-registration.ts`의 `withCodingSessions`).
import type { Result } from "../../../base/mod.ts";
import { ok } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";

export function recoverCoding(tx: Tx): Result<void> {
  tx.sql.run("DELETE FROM coding_sessions WHERE ended = 1", []);
  tx.sql.run("UPDATE coding_sessions SET ended = 1 WHERE ended = 0", []);
  tx.sql.run("DELETE FROM coding_lines", []);
  tx.sql.run("DELETE FROM coding_inputs", []);
  return ok(undefined);
}
