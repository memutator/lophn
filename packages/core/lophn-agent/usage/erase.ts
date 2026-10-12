import { ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";

// 본문 참조를 지우는 platform 함수다. core가 넘긴다(concern 사이는 contracts만 거친다).
type EraseBlobRefs = (
  tx: Tx,
  ownerKind: string,
  ownerKeys: readonly string[],
) => Result<void>;

// session을 delete할 때 그 session의 run이 부른 model 호출 기록과 Compact의 요약 호출을 지운다
// (conversation#R20). 요약 호출은 run이 아니라 session을 가리킨다. 연결 시험 호출은 session이 없어
// 그대로다. 보완 근거와 본문 참조를 호출보다 먼저 지운다. 다시 시도한
// 호출은 앞선 호출을 가리키고 FK가 restrict라 나중 시도부터 지운다. 호출 행은 끝난 run의 것만
// trigger가 지우게 한다.
export function deleteSessionModelCalls(
  tx: Tx,
  session: string,
  eraseBlobRefs: EraseBlobRefs,
): Result<void> {
  const scope =
    "(run in (select id from runs where session = ?) or (run is null and session = ?))";
  const calls = tx.sql.all(
    `select id from model_calls where ${scope} order by attempt_order desc`,
    [session, session],
  ).map((row) => String(row["id"]));
  const refs = eraseBlobRefs(tx, "model_call", calls);
  if (!refs.ok) return refs;
  for (const call of calls) {
    tx.sql.run("delete from model_call_supplements where call = ?", [call]);
  }
  for (const call of calls) {
    tx.sql.run("delete from model_calls where id = ?", [call]);
  }
  return ok(undefined);
}
