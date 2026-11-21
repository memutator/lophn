// 선언이 앱 data를 어디로 보내는가. 선언의 sync 설정(`runs_on`, `sync`, 옛 release의 `sync_to`)을 읽는 곳은 이것
// 하나다. 의존성이 없어 컴퓨터의 core·앱 process와 폰이 같이 쓴다.
import type { AppDeclaration } from "./types.ts";

export type SyncPlan = {
  // 폰에서도 도는 앱. 폰 길은 모든 table을 그대로 다룬다(폰 사본은 DB 통째다).
  phone: boolean;
  // table을 보내는 destination 이름. 보내는 table이 없으면 null.
  destination: string | null;
  // destination으로 가는 table. null이면 모든 table이다: 옛 release의 봉인한 선언이 `sync_to`를 가졌다.
  tables: ReadonlySet<string> | null;
};

// table을 고르는 함수. null은 모든 table이다(거르지 않는다).
export type TableFilter = ((table: string) => boolean) | null;

// 봉인한 선언은 고쳐 쓸 수 없어(hash) 옛 release의 `sync_to`는 "모든 table을 그 destination으로"로 읽는다. 읽지 않으면 그
// 앱이 말없이 clock을 찍지 않게 되고, 다시 맞출 때 그 사이의 로컬 수정이 다른 기계의 옛 값에 덮인다.
export function syncPlanOf(
  declaration: Pick<AppDeclaration, "runs_on" | "sync" | "sync_to">,
): SyncPlan {
  const phone = declaration.runs_on?.includes("phone") ?? false;
  if (typeof declaration.sync_to === "string") {
    return { phone, destination: declaration.sync_to, tables: null };
  }
  const entries = Object.entries(declaration.sync ?? {});
  return {
    phone,
    // 지금은 값이 모두 같다(선언 검사).
    destination: entries[0]?.[1] ?? null,
    tables: new Set(entries.map(([table]) => table)),
  };
}

/** 컴퓨터에서 sync 앱인가: 폰에도 돌거나 table을 다른 기계로 보낸다(clock 표, sync log). */
export function syncsData(plan: SyncPlan): boolean {
  return plan.phone || plan.destination !== null;
}

/** destination으로 가는 table. 폴더로 내보내는 changeset, snapshot, 합치기가 이것으로 거른다. */
export function sentTables(plan: SyncPlan): TableFilter {
  const tables = plan.tables;
  return tables === null ? null : (table) => tables.has(table);
}

/**
 * clock을 찍고 sync log에 남기는 table. 폰 앱은 폰 길이 모든 table을 맞추므로 모두이고, 그 밖에는 보내는 table뿐이다:
 * 보내지 않는 table의 clock은 아무도 읽지 않는다.
 */
export function clockedTables(plan: SyncPlan): TableFilter {
  return plan.phone ? null : sentTables(plan);
}
