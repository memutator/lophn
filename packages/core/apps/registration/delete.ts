// 앱 하나가 혼자 가진 ledger 기록을 한 Tx에서 지운다. 파일(source 폴더, bundle, data DB, log)과 shell 쪽 남은 것은
// commit 뒤 core/main이 지운다(wiring/apps-delete.ts). ledger를 먼저 지우므로 중간에 끊겨도 "설치된 척하는 반쯤 지운 앱"은 없다.
import { ok, type Result } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import { deleteAnnotations } from "../annotations/retention.ts";
import { discardBackups } from "../data/discard.ts";
import { CHANGESET_OWNER_KIND } from "../invocations/changesets.ts";
import { eraseAppNotices } from "../notices/commands.ts";
import { eraseAppReviews } from "../sdk-status/review-store.ts";
import { eraseBlobRefs } from "../../storage/blobs/mod.ts";
import { withEraseWindow } from "../../storage/ledger/mod.ts";

// DELETE trigger가 평소 막는 표다. 이 창 안에서만 지울 수 있다(storage/ledger/erase.ts).
// 지우지 않고 남기는 것: events와 command_results(immutable), program notices와 workflow_lines(기록),
// jobs의 run 기록과 runs(job·다른 앱의 이력), packages(공개 묶음), secret 값(이름은 앱 사이에 공유된다).
// 지운 앱이 주인인 package는 주인 없음이 된다. 지운 앱 id는 다시 쓰이지 않아, 남겨 두면 누구도 새 판을 내지 못한다.
const WINDOW_TABLES = [
  "apps",
  "releases",
  "grants",
  "invocations",
  "app_rewinds",
] as const;

export function eraseApp(tx: Tx, app: string): Result<void> {
  // blob 참조는 소유 행보다 먼저 지운다. 파일은 평소 gc가 거둔다.
  const backups = discardBackups(tx, app);
  if (!backups.ok) return backups;
  const invocations = tx.sql
    .all("SELECT id FROM invocations WHERE app = ?", [app])
    .map((row) => String(row["id"]));
  const changesets = eraseBlobRefs(tx, CHANGESET_OWNER_KIND, invocations);
  if (!changesets.ok) return changesets;
  const annotations = tx.sql
    .all(
      `SELECT a.id FROM annotations a JOIN annotation_batches b ON b.id = a.batch
       WHERE b.app = ?`,
      [app],
    )
    .map((row) => String(row["id"]));
  const annotated = deleteAnnotations(tx, annotations);
  if (!annotated.ok) return annotated;
  tx.sql.run("DELETE FROM annotation_batches WHERE app = ?", [app]);
  eraseAppNotices(tx, app);
  tx.sql.run("DELETE FROM app_event_publications WHERE publisher = ?", [app]);
  eraseAppReviews(tx, app);
  tx.sql.run("UPDATE packages SET owner_app = NULL WHERE owner_app = ?", [app]);

  withEraseWindow(tx.sql, WINDOW_TABLES, () => {
    // releases를 가리키는 표부터 지운다.
    tx.sql.run("DELETE FROM activation_consents WHERE app = ?", [app]);
    tx.sql.run(
      "DELETE FROM activation_requests WHERE release IN (SELECT id FROM releases WHERE app = ?)",
      [app],
    );
    tx.sql.run("DELETE FROM app_data_records WHERE app = ?", [app]);
    tx.sql.run("DELETE FROM invocations WHERE app = ?", [app]);
    tx.sql.run("DELETE FROM app_rewinds WHERE app = ?", [app]);
    tx.sql.run("DELETE FROM grants WHERE app = ?", [app]);
    tx.sql.run("DELETE FROM releases WHERE app = ?", [app]);
    tx.sql.run("DELETE FROM app_folders WHERE app = ?", [app]);
    tx.sql.run("DELETE FROM app_icons WHERE app = ?", [app]);
    tx.sql.run("DELETE FROM apps WHERE id = ?", [app]);
  });
  return ok(undefined);
}
