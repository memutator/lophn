// 다른 기계가 폴더로 낸 앱의 새 release를 이 기계가 스스로 따라간다. 고른 release를 들이기와 같은 길(take-in)로 prepared에
// 설치하고 지금 activation에 넘긴다: 동의 판정(늘어난 바깥 자원·다른 앱 tool·data 손실)은 activation 그대로다.
// 설치 실패와 사람이 거절한 동의는 이 core가 도는 동안만 기억한다: ledger에 두면 schema step이 든다.
import type { Result } from "../../../base/mod.ts";
import type {
  ReleaseActivateOutput,
  ReleaseRecord,
} from "../../../protocol/apps/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  chooseRelease,
  type FollowRelease,
  type IsAncestor,
  type OfferedRelease,
} from "./order.ts";

export type FollowState = {
  state:
    | "current"
    | "installing"
    | "activating"
    | "waiting_consent"
    | "declined"
    | "lophn_update"
    | "install_failed"
    | "activation_failed"
    | "diverged";
  /** 따라가려는(또는 막힌) release의 bundle hash. `current`면 null. */
  release: string | null;
  reason: string | null;
};

/** 이 기계에서 폴더로 맞추는 앱(활성 release가 있고 보관하지 않은). */
export type FollowApp = {
  app: Id<"app">;
  source_path: string | null;
  release: FollowRelease;
};

export type FollowDeps = {
  apps(): readonly FollowApp[];
  /** 다른 기계들의 그 앱 활성 release(앱 기록 사본). */
  offered(app: Id<"app">): readonly OfferedRelease[];
  releases(
    app: Id<"app">,
  ): Result<
    readonly Pick<ReleaseRecord, "id" | "bundle_hash" | "status" | "failure">[]
  >;
  /** 그 release의 동의 줄. 허락한 줄은 activation sweep이 시작한다. */
  consent(release: string): "waiting" | "allowed" | null;
  isAncestor(
    source: string,
    ...commits: Parameters<IsAncestor>
  ): ReturnType<IsAncestor>;
  takeIn(input: {
    app: Id<"app">;
    from: Id<"mch">;
    release: string;
  }): Promise<Result<{ release: string }>>;
  activate(release: string): Promise<Result<ReleaseActivateOutput>>;
};

export type Follow = {
  state(app: Id<"app">): FollowState;
  onChange(listener: (app: Id<"app">, state: FollowState) => void): () => void;
  /** 앱마다 한 번에 하나만 돈다. 도는 중에 부르면 끝난 뒤 한 번 더 돈다. */
  sweep(app?: Id<"app">): Promise<void>;
  /** 동의 줄이 닫혔다(`ActivationConsentClosed`). 거절이면 그 release를 다시 묻지 않는다. */
  consentClosed(
    app: Id<"app">,
    release: string,
    outcome: "allow" | "reject" | "cancelled",
  ): void;
};

const CURRENT: FollowState = { state: "current", release: null, reason: null };

type GaveUp = {
  bundle: string;
  state: "install_failed" | "lophn_update" | "declined";
  reason: string | null;
};

export function createFollow(deps: FollowDeps): Follow {
  const states = new Map<Id<"app">, FollowState>();
  // 같은 bundle을 이 core가 도는 동안 다시 하지 않는다. 다른 목표가 오면 지운다.
  const gaveUp = new Map<Id<"app">, GaveUp>();
  const listeners = new Set<(app: Id<"app">, state: FollowState) => void>();
  const lanes = new Map<Id<"app">, { done: Promise<void>; again: boolean }>();

  const stateOf = (app: Id<"app">) => states.get(app) ?? CURRENT;
  function set(app: Id<"app">, next: FollowState) {
    const was = stateOf(app);
    if (
      was.state === next.state &&
      was.release === next.release &&
      was.reason === next.reason
    ) {
      return;
    }
    if (next.state === "current") states.delete(app);
    else states.set(app, next);
    for (const listener of listeners) listener(app, next);
  }

  async function once(app: Id<"app">): Promise<void> {
    const local = deps.apps().find((each) => each.app === app);
    if (local === undefined) {
      gaveUp.delete(app);
      set(app, CURRENT);
      return;
    }
    const rows = deps.releases(app);
    if (!rows.ok) return;
    const byHash = new Map(rows.value.map((row) => [row.bundle_hash, row]));
    const offered = deps.offered(app);
    const source = local.source_path;
    const choice = await chooseRelease({
      current: local.release,
      offered,
      dropped: new Set(
        rows.value
          .filter(
            (row) => row.status === "superseded" || row.status === "failed",
          )
          .map((row) => row.bundle_hash),
      ),
      isAncestor: (a, d) =>
        source === null
          ? Promise.resolve({ ok: true, value: "missing" as const })
          : deps.isAncestor(source, a, d),
    });

    if (choice.kind === "current") {
      // 따라가던 release가 activation에 실패했으면(실패한 release는 고르지 않는다) 다른 기계가 그것을 돌리는 동안 이유를 둔다.
      const was = stateOf(app).release;
      const failed = was === null ? undefined : byHash.get(was);
      if (
        failed?.status === "failed" &&
        failed.failure !== null &&
        offered.some((each) => each.bundle_hash === was)
      ) {
        set(app, {
          state: "activation_failed",
          release: was,
          reason: `${failed.failure.code}: ${failed.failure.summary}`,
        });
      } else set(app, CURRENT);
      return;
    }
    const bundle = choice.release.bundle_hash;
    if (choice.kind === "diverged") {
      set(app, { state: "diverged", release: bundle, reason: null });
      return;
    }
    const given = gaveUp.get(app);
    if (given !== undefined && given.bundle === bundle) {
      set(app, { state: given.state, release: bundle, reason: given.reason });
      return;
    }
    gaveUp.delete(app);

    const row = byHash.get(bundle);
    if (row?.status === "activating") {
      set(app, { state: "activating", release: bundle, reason: null });
      return;
    }
    let release = row?.id as string | undefined;
    if (release === undefined) {
      const before = stateOf(app);
      set(app, { state: "installing", release: bundle, reason: null });
      const taken = await deps.takeIn({
        app,
        from: choice.release.machine,
        release: bundle,
      });
      if (!taken.ok) {
        const details = taken.error.details as
          | { reason?: string; packages?: string[] }
          | undefined;
        // release 폴더가 아직 다 오지 않았다. 다음 계기에 다시 한다.
        if (
          taken.error.code === "invalid_input" &&
          details?.reason === "release_incomplete"
        ) {
          set(app, before);
          return;
        }
        const failed: GaveUp =
          taken.error.code === "conflict" && details?.reason === "sdk_missing"
            ? {
                bundle,
                state: "lophn_update",
                reason: (details.packages ?? []).join(", ") || null,
              }
            : { bundle, state: "install_failed", reason: taken.error.message };
        gaveUp.set(app, failed);
        set(app, {
          state: failed.state,
          release: bundle,
          reason: failed.reason,
        });
        return;
      }
      release = taken.value.release;
    }

    // 사람을 기다리는 줄이 있으면 다시 묻지 않는다(다시 물으면 허락한 줄도 대기로 돌아간다).
    const consent = deps.consent(release);
    if (consent !== null) {
      set(app, {
        state: consent === "waiting" ? "waiting_consent" : "activating",
        release: bundle,
        reason: null,
      });
      return;
    }
    const before = stateOf(app);
    set(app, { state: "activating", release: bundle, reason: null });
    const done = await deps.activate(release);
    // 같은 앱에 도는 시도가 있거나(conflict) activation을 아직 못 한다(unavailable). 다음 계기에 다시 한다.
    if (!done.ok) {
      set(app, before.state === "installing" ? CURRENT : before);
      return;
    }
    const out = done.value;
    if (out.status === "active") set(app, CURRENT);
    else if (out.status === "failed") {
      set(app, {
        state: "activation_failed",
        release: bundle,
        reason: `${out.failure.code}: ${out.failure.summary}`,
      });
    } else {
      set(app, {
        state:
          out.status === "waiting_consent" ? "waiting_consent" : "activating",
        release: bundle,
        reason: null,
      });
    }
  }

  function run(app: Id<"app">): Promise<void> {
    const lane = lanes.get(app);
    if (lane !== undefined) {
      lane.again = true;
      return lane.done;
    }
    const next = { done: Promise.resolve(), again: false };
    lanes.set(app, next);
    next.done = (async () => {
      try {
        do {
          next.again = false;
          await once(app);
        } while (next.again);
      } finally {
        lanes.delete(app);
      }
    })();
    return next.done;
  }

  return {
    state: stateOf,
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async sweep(app) {
      const ids =
        app === undefined ? deps.apps().map((each) => each.app) : [app];
      // 앱이 빠졌으면 남은 상태를 지운다.
      if (app === undefined) {
        for (const id of states.keys()) if (!ids.includes(id)) ids.push(id);
      }
      await Promise.all(ids.map(run));
    },
    consentClosed(app, release, outcome) {
      if (outcome !== "reject") return;
      const rows = deps.releases(app);
      if (!rows.ok) return;
      const bundle = rows.value.find((row) => row.id === release)?.bundle_hash;
      // 따라가던 release만. 사람이나 agent가 연 다른 activation의 거절은 이 기억과 상관없다.
      if (bundle === undefined || stateOf(app).release !== bundle) return;
      gaveUp.set(app, { bundle, state: "declined", reason: null });
    },
  };
}
