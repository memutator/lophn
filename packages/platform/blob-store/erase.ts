import { ok, type Result } from "../../base/mod.ts";
import type { Tx } from "../../contracts/platform/mod.ts";
import { withEraseWindow } from "../ledger/mod.ts";

// 사람이 요청한 session delete가 지운 기록의 blob 영구 참조를 지운다(lophn-agent/conversation
// #R20, platform/blob-store#R4의 예외). 참조 행만 지우고 blob 파일은 건드리지 않는다: 어느
// 참조에도 걸리지 않게 된 파일은 평소 정리(gc)가 거둔다. 소유 행을 지우기 전에 부른다.
export function eraseBlobRefs(
  tx: Tx,
  ownerKind: string,
  ownerKeys: readonly string[],
): Result<void> {
  withEraseWindow(tx.sql, ["blob_refs"], () => {
    for (const key of ownerKeys) {
      tx.sql.run(
        "delete from blob_refs where owner_kind = ? and owner_key = ?",
        [ownerKind, key],
      );
    }
  });
  return ok(undefined);
}
