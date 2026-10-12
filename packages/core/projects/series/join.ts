// document.save가 같은 command tx 안에서 부르는 series 가입 seam.
// 저장한 Document가 활성 가족 draft의 예정 문서이면 그 draft key로 가입하고
// 일치 draft를 비운다(series#R2, R3, R11, versions#R15). 별도 후속 command는 없다.
// 가입 검사가 거절하면 저장도 같은 tx와 함께 거절이다.

import { ok, type Result } from "../../../base/mod.ts";
import type { Document } from "../../../protocol/projects/mod.ts";
import {
  parseActor,
  type RequestContext,
  TargetAuthorization,
  type Tx,
} from "../../../protocol/platform/mod.ts";
import { actingApp, isAppPlace } from "../addressing/mod.ts";
import { applyJoin, checkJoin } from "./commands.ts";
import { loadSeries, updateSeries } from "./store.ts";

// scope 판정이 가입을 허용하는 가족만 대상이다. 범위 밖 가족은 없는 가족과 같게
// 가입 없이 지나가고 존재를 새지 않는다.
function inScope(tx: Tx, ctx: RequestContext, id: string): Result<boolean> {
  const decision = tx.port(TargetAuthorization)(
    ctx,
    "series.add_instance",
    { series: id },
  );
  if (decision.ok) return ok(true);
  return decision.error.code === "forbidden" ||
      decision.error.code === "not_found"
    ? ok(false)
    : decision;
}

export function joinSeriesOnSave(
  tx: Tx,
  ctx: RequestContext,
  document: Document,
): Result<void> {
  // lophn agent는 가족 멤버 추가 통로가 없다(series#R9). 없는 가족과 같다.
  if (parseActor(ctx.actor)?.kind === "agent") return ok(undefined);
  const rows = tx.sql.all(
    `SELECT id FROM series
     WHERE status = 'active' AND draft IS NOT NULL
       AND json_extract(draft, '$.document') = ?
     ORDER BY id`,
    [document.id],
  );
  for (const row of rows) {
    const id = String(row["id"]);
    const visible = inScope(tx, ctx, id);
    if (!visible.ok) return visible;
    if (!visible.value) continue;
    const loaded = loadSeries(tx.sql, id);
    if (!loaded.ok) return loaded;
    const family = loaded.value;
    if (family === null || family.draft === null) continue;
    // 앱의 저장은 자기 앱 place의 가족에만 가입한다. 다른 자리의 가족은 없는 가족과 같다.
    const app = actingApp(ctx);
    if (app !== null && !isAppPlace(app, family.place)) continue;
    const joinable = checkJoin(tx, family, document.id, family.draft.key);
    if (!joinable.ok) return joinable;
    const applied = applyJoin(
      tx,
      family,
      document.id,
      family.draft.key,
      null,
      null,
    );
    if (!applied.ok) return applied;
    updateSeries(tx, applied.value);
  }
  return ok(undefined);
}
