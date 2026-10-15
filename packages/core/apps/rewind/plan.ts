import { err, ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  AppInvocation,
  RewindPlan,
  RewindPlanItem,
} from "../../../protocol/apps/calls/mod.ts";
import type { InvocationLedger } from "../ports.ts";

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// 앱 data rewind의 시작점으로 고를 수 있는지. 되돌릴 수 없는 것은 invalid_input이다.
function pickable(
  from: AppInvocation,
  active: Id<"rel">,
): Result<void> {
  if (from.mode !== "live") {
    return invalid("only a live invocation can be rewound");
  }
  if (from.release !== active) {
    return invalid("invocation is from an earlier release");
  }
  if (from.operation.kind === "data_change") {
    return invalid("a data change cannot be rewound");
  }
  if (from.effect === "read") return invalid("a read cannot be rewound");
  if (from.status === "denied") return invalid("a denied call changed nothing");
  if (from.reverted_by !== null) {
    return invalid("invocation is already rewound");
  }
  return ok(undefined);
}

function itemOf(inv: AppInvocation): Result<RewindPlanItem> {
  if (inv.started_at === null) {
    return err({ code: "internal", message: "invocation without start time" });
  }
  return ok({
    invocation: inv.id,
    started_at: inv.started_at,
    operation: inv.operation,
    caller: inv.caller,
    effect: inv.effect,
    reverts_db: inv.status === "running" || inv.changeset !== null,
    external: inv.effect === "external",
    running: inv.status === "running",
  });
}

/**
 * `from`부터 최신까지 되돌아갈 목록. id는 시간 순서라 id로 범위를 자른다.
 * 되돌림 표시가 있는 것은 이미 되돌아가 있어서 건너뛴다.
 */
export function rewindPlan(
  deps: {
    ledger: Pick<InvocationLedger, "get" | "list">;
    activeRelease(app: Id<"app">): Result<Id<"rel"> | null>;
  },
  app: Id<"app">,
  from: Id<"inv">,
): Result<RewindPlan> {
  const start = deps.ledger.get(from);
  if (!start.ok) return start;
  if (start.value === null || start.value.app !== app) {
    return err({ code: "not_found", message: "invocation not found" });
  }
  const active = deps.activeRelease(app);
  if (!active.ok) return active;
  if (active.value === null) return invalid("app has no active release");
  const picked = pickable(start.value, active.value);
  if (!picked.ok) return picked;

  const listed = deps.ledger.list({
    app,
    release: active.value,
    mode: "live",
    reverted: false,
  });
  if (!listed.ok) return listed;
  const range = listed.value
    .filter((inv) =>
      inv.id >= from && inv.effect !== "read" && inv.status !== "denied" &&
      inv.operation.kind !== "data_change"
    )
    .sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  // 목록이 잘려 `from`이 빠졌으면 일부만 되돌리게 되므로 계획을 내지 않는다.
  if (range[0]?.id !== from) {
    return err({
      code: "unavailable",
      message: "invocation list is incomplete",
    });
  }

  const items: RewindPlanItem[] = [];
  for (const inv of range) {
    const item = itemOf(inv);
    if (!item.ok) return item;
    items.push(item.value);
  }
  // 결과를 모르는 채 changeset 없이 닫힌 write는 얼마나 바뀌었는지 알 수 없다.
  const lost = range.find((inv) =>
    inv.status === "unknown" && inv.changeset === null
  );
  return ok({
    app,
    release: active.value,
    from_invocation: from,
    items,
    blocked: lost === undefined
      ? null
      : { reason: "unrecoverable_write", invocation: lost.id },
  });
}
