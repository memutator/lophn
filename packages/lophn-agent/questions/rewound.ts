import { ok, type Result } from "../../base/mod.ts";
import { questionCancelled } from "../../protocol/lophn-agent/mod.ts";
import type { Tx } from "../../protocol/platform/mod.ts";
import { closeGroup } from "./commands.ts";

// rewind가 숨기는 구간에서 기다리던 질문 묶음을 답 없이 닫는다(lophn-agent/revert "대화 밖 상태", R15).
// 숨긴 구간의 질문에 답이 오면 사라진 대화에 답이 붙으므로 사람의 미루기(Skip)와 같은 모양으로 묶음 전체를
// 닫는다. 이유 글을 받지 않는 닫음이라 blob 없이 닫을 수 있는 이유는 deferred뿐이다. Rewind command와 같은
// transaction이므로 하나라도 닫지 못하면 rewind 전체가 되돌려진다. 닫은 묶음 수를 돌려준다.
export function cancelGroupsFrom(
  tx: Tx,
  session: string,
  fromSeq: string,
): Result<number> {
  const waiting = tx.sql.all(
    `select id, created_seq from question_groups
      where run in (select id from runs where session = ?)
        and status = 'pending' and created_seq >= ?
      order by created_seq`,
    [session, Number(fromSeq)],
  );
  for (const row of waiting) {
    const id = String(row["id"]);
    const seq = tx.emit(questionCancelled, id, {
      created_seq: String(row["created_seq"]),
      closed_reason_blob: null,
      deferred: true,
    });
    closeGroup(tx, { id }, { status: "cancelled", seq, reason: "deferred" });
  }
  return ok(waiting.length);
}
