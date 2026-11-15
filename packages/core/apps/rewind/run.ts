import { Buffer } from "node:buffer";
import { err, invertAll, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { At } from "../../../protocol/base/values.ts";
import type { Rewind } from "../../../protocol/apps/calls/mod.ts";
import type { Sql } from "../../../protocol/server/mod.ts";
import type {
  AppIntake,
  AppProcessLink,
  AppRewind,
  AppViewSignal,
  InvocationLedger,
} from "../ports.ts";
import type { SyncRecorder } from "../sync/log.ts";
import { rewindPlan } from "./plan.ts";
import {
  finishRewind,
  insertApplyingRewind,
  loadApplyingRewind,
} from "./store.ts";

// 도는 호출이 끝나기를 기다리는 유예. 넘으면 rewind를 취소한다.
const DEFAULT_GRACE_MS = 60_000;

export type RewindDeps = {
  ledger: Pick<
    InvocationLedger,
    "get" | "list" | "changesetOf" | "markReverted"
  >;
  link: Pick<AppProcessLink, "apply">;
  intake: Pick<AppIntake, "close" | "whenIdle" | "open">;
  signal: AppViewSignal;
  // 기록 표(`app_rewinds`)를 쓰는 ledger 연결.
  sql: Sql;
  // 그 앱의 지금 활성 release. 없으면 null.
  activeRelease(app: Id<"app">): Result<Id<"rel"> | null>;
  now(): At;
  newId(): Id<"rwd">;
  graceMs?: number;
  // sync 앱이면 rewind가 실제로 바꾼 것을 sync log에 남겨 폰이 받는다.
  sync?: Pick<SyncRecorder, "rewound">;
};

export function createAppRewind(deps: RewindDeps): AppRewind {
  const graceMs = deps.graceMs ?? DEFAULT_GRACE_MS;

  function cancel(
    id: Id<"rwd">,
    code: "conflict" | "app_unavailable",
    message: string,
  ): Result<Rewind> {
    return finishRewind(
      deps.sql,
      id,
      { status: "cancelled", reason: { code, message } },
      deps.now(),
    );
  }

  // 접수가 닫힌 동안의 일. 어떤 길로 끝나도 호출하는 쪽이 접수를 다시 연다.
  async function drainAndApply(
    app: Id<"app">,
    from: Id<"inv">,
    id: Id<"rwd">,
  ): Promise<Result<Rewind>> {
    const idle = await deps.intake.whenIdle(app, graceMs);
    if (!idle.idle) {
      return cancel(id, "conflict", "running calls did not finish");
    }
    // 도는 호출이 끝나며 늘어난 것까지 다시 계산한다.
    const plan = rewindPlan(deps, app, from);
    if (!plan.ok) return cancel(id, "conflict", plan.error.message);
    if (plan.value.blocked !== null) {
      return cancel(
        id,
        "conflict",
        "a write with an unknown result is in range",
      );
    }
    const ids = plan.value.items.map((item) => item.invocation as Id<"inv">);

    const changesets: Uint8Array[] = [];
    for (const inv of ids) {
      const changeset = await deps.ledger.changesetOf(inv);
      if (!changeset.ok) return cancel(id, "conflict", changeset.error.message);
      if (changeset.value !== null) changesets.push(changeset.value);
    }
    const inverted = invertAll(changesets);
    if (!inverted.ok) return cancel(id, "conflict", inverted.error.message);

    if (inverted.value.length > 0) {
      const applied = await deps.link.apply(app, {
        changesets: inverted.value.map((bytes) =>
          Buffer.from(bytes).toString("base64"),
        ),
      });
      if (!applied.ok) {
        return cancel(id, "app_unavailable", applied.error.message);
      }
      if (applied.value.status === "conflict") {
        return cancel(id, "conflict", applied.value.message);
      }
      // 새 clock이 찍혀 폰이 이미 받은 것을 이긴다.
      const { effective, hlc } = applied.value;
      if (effective && hlc !== undefined) {
        await deps.sync?.rewound(
          app,
          plan.value.release as Id<"rel">,
          new Uint8Array(Buffer.from(effective, "base64")),
          hlc,
        );
      }
    }

    const marked = deps.ledger.markReverted(ids, id);
    if (!marked.ok) return marked;
    const finished = finishRewind(
      deps.sql,
      id,
      { status: "applied", invocations: ids },
      deps.now(),
    );
    if (finished.ok) deps.signal.changed(app, "rewind");
    return finished;
  }

  return {
    plan: (app, from) => rewindPlan(deps, app, from),

    async apply(app, from, by) {
      if (by !== "user") {
        return err({ code: "forbidden", message: "only a person can rewind" });
      }
      const plan = rewindPlan(deps, app, from);
      if (!plan.ok) return plan;
      if (plan.value.blocked !== null) {
        return err({
          code: "conflict",
          message: "a write with an unknown result is in range",
        });
      }
      const running = loadApplyingRewind(deps.sql, app);
      if (!running.ok) return running;
      if (running.value !== null) {
        return err({
          code: "conflict",
          message: "a rewind is already applying",
        });
      }

      const id = deps.newId();
      insertApplyingRewind(deps.sql, {
        id,
        app,
        release: plan.value.release,
        from_invocation: from,
        requested_by: by,
        invocations: plan.value.items.map((item) => item.invocation),
        started_at: deps.now(),
      });
      deps.intake.close(app, "rewind");
      try {
        return await drainAndApply(app, from, id);
      } finally {
        deps.intake.open(app);
      }
    },
  };
}
