import { ok, type Result } from "../../base/mod.ts";
import {
  type AppRegistration,
  appRegistrationLookup,
} from "../../contracts/apps/mod.ts";
import type { SqlRow, Tx } from "../../contracts/platform/mod.ts";
import { defineTxPort } from "../../platform/ledger/mod.ts";
import { appFromRow } from "./rows.ts";

// documents가 자리 해석에서 부르는 존재·status·slug 조회. runtime 상태는 없다.
// archived도 돌려주므로 호출한 concern이 필요한 status를 검사한다.
export function appRegistrationLookupPort(tx: Tx) {
  return defineTxPort(appRegistrationLookup, () => ({
    get(app: string): Result<AppRegistration | null> {
      const row = tx.sql.get(
        "SELECT id, slug, name, description, planning_version, source_path, active_release, run_enabled, revision, status FROM apps WHERE id = ?",
        [app],
      );
      if (row === undefined) return ok(null);
      const parsed = appFromRow(row as SqlRow);
      if (!parsed.ok) return parsed;
      return ok({
        id: parsed.value.id,
        slug: parsed.value.slug,
        status: parsed.value.status,
      });
    },
  }));
}
