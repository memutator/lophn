// 남기는 기간. annotation은 그것을 가리키는 session 기록이 있는 동안 남는다. 없어지면
// sweep이 지운다. 다른 module의 command도 자기 transaction 안에서 addRef를 부른다.
import { ok, type Result } from "../../../base/mod.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import { eraseBlobRefs } from "../../storage/blobs/mod.ts";

type RefOwner = "session_message";

// 방금 보낸 묶음은 session 기록의 ref가 붙기 전일 수 있어 이 시간이 지나야 sweep 대상이다.
const SWEEP_GRACE_MS = 60 * 60 * 1000;

export function addRef(
  sql: Sql,
  annotation: string,
  ownerKind: RefOwner,
  ownerId: string,
): void {
  sql.run(
    `INSERT OR IGNORE INTO annotation_refs (annotation, owner_kind, owner_id)
     VALUES (?, ?, ?)`,
    [annotation, ownerKind, ownerId],
  );
}

// annotation과 ref, screenshot 영구 참조를 지우고 비게 된 묶음도 지운다.
export function deleteAnnotations(
  tx: Tx,
  ids: readonly string[],
): Result<void> {
  const erased = eraseBlobRefs(tx, "annotation", ids);
  if (!erased.ok) return erased;
  for (const id of ids) {
    tx.sql.run("DELETE FROM annotation_refs WHERE annotation = ?", [id]);
    tx.sql.run("DELETE FROM annotations WHERE id = ?", [id]);
  }
  tx.sql.run(
    `DELETE FROM annotation_batches WHERE NOT EXISTS
       (SELECT 1 FROM annotations WHERE annotations.batch = annotation_batches.id)`,
    [],
  );
  return ok(undefined);
}

export function sweep(tx: Tx): Result<number> {
  const cutoff = new Date(Date.parse(tx.now()) - SWEEP_GRACE_MS).toISOString();
  const ids = tx.sql
    .all(
      `SELECT a.id FROM annotations a JOIN annotation_batches b ON b.id = a.batch
     WHERE b.sent_at < ? AND NOT EXISTS
       (SELECT 1 FROM annotation_refs r WHERE r.annotation = a.id)`,
      [cutoff],
    )
    .map((row) => String(row["id"]));
  const deleted = deleteAnnotations(tx, ids);
  return deleted.ok ? ok(ids.length) : deleted;
}
