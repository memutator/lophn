// 선언이 앱 data를 어디로 보내는가. 선언의 sync 설정(`runs_on`, `sync`, 옛 release의 `sync_to`)을 읽는 곳은 이것
// 하나다. 의존성이 없어 컴퓨터의 core·앱 process와 폰이 같이 쓴다.
import type { AppDeclaration } from "./types.ts";

export type SyncPlan = {
  // 폰에서도 도는 앱. 폰 길은 모든 table을 그대로 다룬다(폰 사본은 DB 통째다).
  phone: boolean;
  // table을 보내는 destination 이름 → 그리 가는 table. table 집합이 null이면 모든 table이다: 옛 release의 봉인한 선언이
  // `sync_to`를 가졌다. 보내는 table이 없으면 비었다.
  destinations: ReadonlyMap<string, ReadonlySet<string> | null>;
};

// table을 고르는 함수. null은 모든 table이다(거르지 않는다).
export type TableFilter = ((table: string) => boolean) | null;

// 봉인한 선언은 고쳐 쓸 수 없어(hash) 옛 release의 `sync_to`는 "모든 table을 그 destination으로"로 읽는다. 읽지 않으면 그
// 앱이 말없이 clock을 찍지 않게 되고, 다시 맞출 때 그 사이의 로컬 수정이 다른 기계의 옛 값에 덮인다.
export function syncPlanOf(
  declaration: Pick<AppDeclaration, "runs_on" | "sync" | "sync_to">,
): SyncPlan {
  const phone = declaration.runs_on?.includes("phone") ?? false;
  const destinations = new Map<string, Set<string> | null>();
  if (typeof declaration.sync_to === "string") {
    destinations.set(declaration.sync_to, null);
    return { phone, destinations };
  }
  for (const [table, destination] of Object.entries(declaration.sync ?? {})) {
    const tables = destinations.get(destination) ?? new Set<string>();
    tables.add(table);
    destinations.set(destination, tables);
  }
  return { phone, destinations };
}

/** 컴퓨터에서 sync 앱인가: 폰에도 돌거나 table을 다른 기계로 보낸다(clock 표, sync log). */
export function syncsData(plan: SyncPlan): boolean {
  return plan.phone || plan.destinations.size > 0;
}

/** table을 보내는 destination 이름(글자 순서). */
export function sendsTo(plan: SyncPlan): string[] {
  return [...plan.destinations.keys()].sort();
}

/**
 * 보내는 table. `destination`을 주면 그 destination으로 가는 table이고(폴더로 내보내는 changeset, snapshot, 합치기가 이것으로
 * 거른다. 그리 보내지 않으면 아무 table도 아니다), 주지 않으면 어디로든 보내는 table 모두다.
 */
export function sentTables(plan: SyncPlan, destination?: string): TableFilter {
  if (destination !== undefined) {
    if (!plan.destinations.has(destination)) return () => false;
    const tables = plan.destinations.get(destination)!;
    return tables === null ? null : (table) => tables.has(table);
  }
  const names = sentTableNames(plan);
  if (names === null) return null;
  const all = new Set(names);
  return (table) => all.has(table);
}

/** 어디로든 보내는 table의 이름. 옛 release(모든 table)면 null이다. */
export function sentTableNames(plan: SyncPlan): string[] | null {
  const names: string[] = [];
  for (const tables of plan.destinations.values()) {
    if (tables === null) return null;
    names.push(...tables);
  }
  return names.sort();
}

/**
 * clock을 찍고 sync log에 남기는 table. 폰 앱은 폰 길이 모든 table을 맞추므로 모두이고, 그 밖에는 보내는 table뿐이다:
 * 보내지 않는 table의 clock은 아무도 읽지 않는다.
 */
export function clockedTables(plan: SyncPlan): TableFilter {
  return plan.phone ? null : sentTables(plan);
}
