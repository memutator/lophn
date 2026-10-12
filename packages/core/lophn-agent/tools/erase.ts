import { ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";

// 본문 참조를 지우는 platform 함수다. core가 넘긴다(concern 사이는 contracts만 거친다).
type EraseBlobRefs = (
  tx: Tx,
  ownerKind: string,
  ownerKeys: readonly string[],
) => Result<void>;

// session을 delete할 때 그 session의 run이 낸 tool call 기록을 지운다(conversation#R20). 이 call을
// 가리키는 기다림 결과(waiting-and-recovery)는 먼저 지워 둔다. 보완 사실과 본문 참조를 call보다
// 먼저 지운다. 다시 시도한 call(attempt 1)은 첫 시도를 가리키고 FK가 restrict라 먼저 지운다.
export function deleteSessionToolCalls(
  tx: Tx,
  session: string,
  eraseBlobRefs: EraseBlobRefs,
): Result<void> {
  const calls = tx.sql.all(
    `select id from tool_calls
     where run in (select id from runs where session = ?) order by attempt desc`,
    [session],
  ).map((row) => String(row["id"]));
  const refs = eraseBlobRefs(tx, "tool_call", calls);
  if (!refs.ok) return refs;
  for (const call of calls) {
    tx.sql.run("delete from tool_call_supplements where tool_call = ?", [call]);
  }
  for (const call of calls) {
    tx.sql.run("delete from tool_calls where id = ?", [call]);
  }
  return ok(undefined);
}
