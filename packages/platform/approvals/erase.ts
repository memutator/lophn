import { ok, type Result } from "../../base/mod.ts";
import {
  APPROVAL_BLOB_OWNER_KIND,
  type Tx,
} from "../../protocol/platform/mod.ts";
import { eraseBlobRefs } from "../blob-store/mod.ts";
import { withEraseWindow } from "../ledger/mod.ts";

// 사람이 요청한 session delete가 그 session의 run이 낸 approval request를 지운다(lophn-agent/
// conversation#R20). run이 없는 request와 다른 run의 request는 건드리지 않는다. 사용 기록과
// 본문 참조는 request보다 먼저 지운다. 지운 request의 close event는 ledger에 그대로 남는다.
export function eraseApprovalRequests(
  tx: Tx,
  runs: readonly string[],
): Result<void> {
  const requests = runs.flatMap((run) =>
    tx.sql.all("select id from approval_requests where run = ?", [run]).map(
      (row) => String(row["id"]),
    )
  );
  const refs = eraseBlobRefs(tx, APPROVAL_BLOB_OWNER_KIND, requests);
  if (!refs.ok) return refs;
  withEraseWindow(tx.sql, ["approval_uses", "approval_requests"], () => {
    for (const request of requests) {
      tx.sql.run("delete from approval_uses where approval = ?", [request]);
      tx.sql.run("delete from approval_requests where id = ?", [request]);
    }
  });
  return ok(undefined);
}
