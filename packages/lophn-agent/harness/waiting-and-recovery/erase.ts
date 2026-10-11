import { ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../contracts/platform/mod.ts";

// session을 delete할 때 그 session의 run이 기다린 결과 기록을 지운다(conversation#R20). 이 행은
// tool call을 가리키므로 tool call 기록보다 먼저 지운다. 요청(질문 묶음·approval request) 자체는
// 각 소유 concern이 지운다.
export function deleteSessionWaitResolutions(
  tx: Tx,
  session: string,
): Result<void> {
  tx.sql.run(
    "delete from run_wait_resolutions where run in (select id from runs where session = ?)",
    [session],
  );
  return ok(undefined);
}
