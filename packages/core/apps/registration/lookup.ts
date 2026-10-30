import { ok, type Result } from "../../../base/mod.ts";
import type { AppRegistration } from "../../../protocol/apps/mod.ts";
import type { SqlRow, Tx } from "../../../protocol/server/mod.ts";
import { appFromRow } from "./rows.ts";

// documents가 자리 해석에서 부르는 존재·status·slug 조회. runtime 상태는 없다.
// archived도 돌려주므로 caller가 필요한 status를 검사한다.
export function lookupAppRegistration(
  sql: Pick<Tx["sql"], "get">,
  app: string,
): Result<AppRegistration | null> {
  const row = sql.get(
    "SELECT id, slug, name, description, planning_version, source_path, active_release, run_enabled, revision, status FROM apps WHERE id = ?",
    [app],
  );
  if (row === undefined) return ok(null);
  // 등록 조회는 존재·status·slug만 쓰므로 폴더 행을 읽지 않는다.
  const parsed = appFromRow(row as SqlRow, []);
  if (!parsed.ok) return parsed;
  return ok({
    id: parsed.value.id,
    slug: parsed.value.slug,
    status: parsed.value.status,
  });
}
