// 선언이 앱 data를 어디로 보내는가. 선언의 sync 설정(`runs_on`, `sync`, 옛 release의 `sync_to`, `sdk_dependencies`)과
// 선택적인 기계별 정책 override(`sync.app_policies`)를 읽는 곳은 이것 하나다. 의존성이 없어 컴퓨터의 core·앱 process와 폰이 같이 쓴다.
import {
  type AppDeclaration,
  DEFAULT_SYNC_DESTINATION,
  LOCAL_SYNC_POLICY,
  type SDKDependency,
  type SyncConflictStrategy,
} from "./types.ts";

export type SyncPolicyOverride = "default" | "computers" | "local";

export type SyncPlanInput = Pick<
  AppDeclaration,
  "runs_on" | "sync" | "sync_to"
> & {
  sdk_dependencies?: readonly Pick<SDKDependency, "name" | "version">[];
};

export type SyncPlan = {
  // 폰에서도 도는 앱. 폰 길은 모든 table을 그대로 다룬다(폰 사본은 DB 통째다).
  phone: boolean;
  // table을 보내는 destination 이름 → 그리 가는 table.
  // table 집합이 null이면 명시적으로 다른 destination이나 "local"에 두지 않은 나머지 모든 table이다
  // (옛 release의 `sync_to`, `@lophn/declaration >= 6.0.0` 기본 `"computers"`, 5.0–5.2 phone+computer 기본 `"computers"`).
  // 보내는 table이 없으면 비었다.
  destinations: ReadonlyMap<string, ReadonlySet<string> | null>;
  // "local"로 뺀 table 이름들(기본 destination에서 제외된다).
  localTables: ReadonlySet<string>;
  // table별 충돌 전략("keep_both"로 선언한 table만 담는다; 나머지는 기본 "lww").
  conflicts: ReadonlyMap<string, SyncConflictStrategy>;
};

// table을 고르는 함수. null은 모든 table이다(거르지 않는다).
export type TableFilter = ((table: string) => boolean) | null;

function declarationMajor(
  dependencies?: readonly Pick<SDKDependency, "name" | "version">[],
): number | null {
  const found = dependencies?.find(
    (item) => item.name === "@lophn/declaration",
  );
  if (!found || typeof found.version !== "string") return null;
  const match = /^(\d+)\.\d+\.\d+/.exec(found.version);
  return match ? Number(match[1]) : null;
}

// 봉인한 선언은 고쳐 쓸 수 없어(hash) 옛 release의 `sync_to`는 "모든 table을 그 destination으로"로 읽는다.
// version-gate 규칙:
// - `@lophn/declaration >= 6.0.0`: `sync: "local"`이 아니면 명시적으로 `"local"`로 뺀 표 외의 모든 표가 기본 `"computers"`다.
// - `5.0.0–5.2.0`: `runs_on`에 `"computer"`와 `"phone"`이 함께 있고 `sync`·`sync_to`가 생략된 경우에만 기본 `"computers"`다.
// - `<= 5.2.0`의 computer-only 앱은 `sync`·`sync_to`가 없으면 기존처럼 local을 유지한다.
// - `override`: `"local"`이면 이 기계에서 컴퓨터 간 동기화를 끄고, `"computers"`이면 legacy 앱도 기본 `"computers"`로 켠다.
export function syncPlanOf(
  declaration: SyncPlanInput,
  override?: SyncPolicyOverride,
): SyncPlan {
  const phone = declaration.runs_on?.includes("phone") ?? false;
  const phoneOnly =
    declaration.runs_on?.length === 1 && declaration.runs_on[0] === "phone";
  const phoneAndComputer = phone && !phoneOnly;
  const localTables = new Set<string>();
  const conflicts = new Map<string, SyncConflictStrategy>();
  const explicitByDest = new Map<string, Set<string>>();

  if (
    declaration.sync !== undefined &&
    declaration.sync !== LOCAL_SYNC_POLICY &&
    typeof declaration.sync === "object"
  ) {
    for (const [table, entry] of Object.entries(declaration.sync)) {
      const destination =
        typeof entry === "string"
          ? entry
          : (entry.destination ?? DEFAULT_SYNC_DESTINATION);
      const conflict: SyncConflictStrategy =
        typeof entry === "string" ? "lww" : (entry.conflict ?? "lww");
      if (destination === LOCAL_SYNC_POLICY) {
        localTables.add(table);
        continue;
      }
      const tables = explicitByDest.get(destination) ?? new Set<string>();
      tables.add(table);
      explicitByDest.set(destination, tables);
      if (conflict === "keep_both") conflicts.set(table, "keep_both");
    }
  }

  if (override === LOCAL_SYNC_POLICY || phoneOnly) {
    return { phone, destinations: new Map(), localTables, conflicts };
  }

  const destinations = new Map<string, Set<string> | null>();
  if (
    override !== DEFAULT_SYNC_DESTINATION &&
    typeof declaration.sync_to === "string"
  ) {
    destinations.set(declaration.sync_to, null);
    return { phone, destinations, localTables, conflicts };
  }

  const major = declarationMajor(declaration.sdk_dependencies);
  const defaultToComputers =
    override === DEFAULT_SYNC_DESTINATION
      ? true
      : declaration.sync === LOCAL_SYNC_POLICY
        ? false
        : major !== null && major >= 6
          ? true
          : major !== null &&
              major >= 5 &&
              major < 6 &&
              phoneAndComputer &&
              declaration.sync === undefined
            ? true
            : false;

  if (defaultToComputers) {
    if (
      phone &&
      explicitByDest.size > 0 &&
      !explicitByDest.has(DEFAULT_SYNC_DESTINATION)
    ) {
      // 폰에서도 도는 앱은 destination 하나만 쓰므로 명시된 단일 destination을 유지한다.
      for (const [dest, tables] of explicitByDest) {
        destinations.set(dest, tables);
      }
    } else {
      for (const [dest, tables] of explicitByDest) {
        if (dest !== DEFAULT_SYNC_DESTINATION) destinations.set(dest, tables);
      }
      destinations.set(DEFAULT_SYNC_DESTINATION, null);
    }
  } else {
    for (const [dest, tables] of explicitByDest) {
      destinations.set(dest, tables);
    }
  }

  return { phone, destinations, localTables, conflicts };
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
    if (tables !== null) return (table) => tables.has(table);
    const excluded = new Set(plan.localTables);
    for (const [otherDest, otherTables] of plan.destinations) {
      if (otherDest !== destination && otherTables !== null) {
        for (const table of otherTables) excluded.add(table);
      }
    }
    return excluded.size === 0 ? null : (table) => !excluded.has(table);
  }
  const names = sentTableNames(plan);
  if (names === null) {
    return plan.localTables.size === 0
      ? null
      : (table) => !plan.localTables.has(table);
  }
  const all = new Set(names);
  return (table) => all.has(table);
}

/** 어디로든 보내는 table의 이름. 기본/전체 destination이 있으면 null이다. */
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

/** table 하나의 충돌 전략. 선언하지 않았으면 기본 "lww"다. */
export function conflictStrategyOf(
  plan: SyncPlan,
  table: string,
): SyncConflictStrategy {
  return plan.conflicts.get(table) ?? "lww";
}
