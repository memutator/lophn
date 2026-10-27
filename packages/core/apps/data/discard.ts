import type { Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import { eraseBlobRefs } from "../../storage/blobs/mod.ts";
import { BACKUP_BLOB_OWNER_KIND, backupBlobOwnerKey } from "./blobs.ts";

// 앱의 복구본 참조를 모두 지운다. 앱마다 복구본은 가장 최근 하나라서, 새 시도의 record_backup이 이전 것을
// 대체할 때와 activation이 성공해 복구본이 필요 없어졌을 때 부른다. 시도 기록(행)은 이력으로 남는다.
export function discardBackups(tx: Tx, app: string): Result<void> {
  const rows = tx.sql.all(
    "SELECT release, attempt FROM app_data_records WHERE app = ? AND kind = 'backup'",
    [app],
  );
  return eraseBlobRefs(
    tx,
    BACKUP_BLOB_OWNER_KIND,
    rows.map((row) =>
      backupBlobOwnerKey(String(row.release), String(row.attempt)),
    ),
  );
}
