// `apps.automations` read. 선언·현재 실행 가능 여부·실제 호출 관측을 서로 다른 사실로 구분해 보인다
// (apps/automations#R10). 선언은 현재 release 선언, 실행 가능 여부는 App 값(archive·실행 허용·active
// release)·external 켜기 승인(`automation.run` grant)·현재 supervisor 관측, 관측은 이 release의 live
// invocation 중 trigger가 그 automation인 것이 있는지다. 시작하지 못한 회차는 invocation이 아니므로
// 실행 가능 여부의 reason으로만 보이고 실패한 호출과 섞이지 않는다.
import { err, ok, type Result } from "../../base/mod.ts";
import {
  type App,
  appAutomations,
  type AutomationView,
  type RuntimeObservation,
  type RuntimeReason,
} from "../../contracts/apps/mod.ts";
import type { ReadDefinition, Sql } from "../../contracts/platform/mod.ts";
import { authorizeApp, loadApp } from "../registration/mod.ts";
import {
  type AppDeclarations,
  declarationsAt,
  effectiveScope,
  loadGrants,
} from "../permissions/mod.ts";

// 같은 reason code를 reader와 메인 덮기가 함께 쓴다.
export const AUTOMATION_REASONS = {
  preparing: "preparing",
  archived: "archived",
  executionDisabled: "execution_disabled",
  releaseNotActive: "release_not_active",
  permissionRequired: "permission_required",
  // 현재 supervisor 관측이 없다. 과거 event로 실행 중이라고 하지 않는다.
  noObservation: "no_observation",
  notAccepting: "not_accepting",
} as const;

function reason(code: string, summary: string): RuntimeReason {
  return { code, summary };
}

type RuntimeApp = Pick<App, "active_release" | "status" | "run_enabled">;

// App 값만으로 정해지는 닫힘. 관측과 무관하다.
function appGate(
  app: RuntimeApp,
  release: string,
): RuntimeReason | null {
  if (app.active_release === null) {
    return reason(AUTOMATION_REASONS.preparing, "app has no active release");
  }
  if (app.status !== "active") {
    return reason(AUTOMATION_REASONS.archived, "app is archived");
  }
  if (!app.run_enabled) {
    return reason(
      AUTOMATION_REASONS.executionDisabled,
      "app execution is off",
    );
  }
  if (app.active_release !== release) {
    return reason(
      AUTOMATION_REASONS.releaseNotActive,
      "declared release is not the active release",
    );
  }
  return null;
}

// 지금 live 자식이 이 release로 열려 있는지. 관측이 없으면 모른다.
function observationGate(
  observation: RuntimeObservation | null,
  release: string,
): RuntimeReason | null {
  if (observation === null) {
    return reason(
      AUTOMATION_REASONS.noObservation,
      "no live observation of the current release",
    );
  }
  if (observation.mode !== "live" || observation.release !== release) {
    return reason(
      AUTOMATION_REASONS.noObservation,
      "no live observation of the current release",
    );
  }
  if (observation.ready && observation.accepting) return null;
  return observation.reason ??
    reason(AUTOMATION_REASONS.notAccepting, "app is not accepting calls");
}

function observed(
  sql: Pick<Sql, "get">,
  app: string,
  release: string,
  key: string,
): boolean {
  return sql.get(
    `SELECT 1 AS found FROM invocations
     WHERE app = ? AND release = ? AND mode = 'live'
       AND json_extract(trigger, '$.kind') = 'automation'
       AND json_extract(trigger, '$.key') = ?
     LIMIT 1`,
    [app, release, key],
  ) !== undefined;
}

// reader 쪽의 view. 관측은 메인 스레드의 supervisor 메모리에만 있어서 여기서는
// 닫힘 reason과 external 승인까지만 정하고, 나머지는 no_observation으로 둔다(덮기가 채운다).
function viewsOf(
  app: App,
  declarations: AppDeclarations,
  approved: ReadonlySet<string>,
  seen: (key: string) => boolean,
): AutomationView[] {
  const closed = appGate(app, declarations.release);
  return declarations.automations.map((declared) => {
    const view: AutomationView = {
      key: declared.key,
      declared: true,
      runnable: false,
      observed: seen(declared.key),
      release: declarations.release,
    };
    if (closed !== null) return { ...view, reason: closed };
    // external 회차는 켜는 승인 전에는 돌지 않는다(R13).
    if (declared.external && !approved.has(declared.key)) {
      return {
        ...view,
        reason: reason(
          AUTOMATION_REASONS.permissionRequired,
          "external automation is not approved",
        ),
      };
    }
    return {
      ...view,
      reason: reason(
        AUTOMATION_REASONS.noObservation,
        "no live observation of the current release",
      ),
    };
  });
}

export function createAutomationReads(): {
  automations: ReadDefinition<typeof appAutomations>;
} {
  return {
    automations: {
      route: appAutomations,
      handle(snapshot, ctx, input) {
        const app = loadApp(snapshot.sql, input.app);
        if (!app.ok) return app;
        // 범위 밖 앱은 없는 앱과 같은 응답이다.
        if (app.value === null) return notFound();
        const access = authorizeApp(snapshot.port, ctx, appAutomations.name, {
          kind: "app",
          app: app.value,
        });
        if (denied(access)) return notFound();
        if (!access.ok) return access;
        const declared = declarationsAt(snapshot, input.app);
        if (!declared.ok) return declared;
        const base = {
          app: app.value.id,
          observed_at: null,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        };
        // 선언을 모르면(현재 release 없음·선언 port 없음) 보일 automation이 없다.
        if (declared.value === null) return ok({ ...base, automations: [] });
        const grants = loadGrants(snapshot.sql, {
          app: input.app,
          status: "active",
        });
        if (!grants.ok) return grants;
        const scope = effectiveScope({
          app: input.app,
          declarations: declared.value,
          grants: grants.value,
          targetCommands: () => undefined,
        });
        const approved = new Set(scope.automations.map((a) => a.automation));
        const release = declared.value.release;
        return ok({
          ...base,
          automations: viewsOf(
            app.value,
            declared.value,
            approved,
            (key) => observed(snapshot.sql, input.app, release, key),
          ),
        });
      },
    },
  };
}

function notFound(): Result<never> {
  return err({ code: "not_found", message: "app not found" });
}

function denied(result: Result<unknown>): boolean {
  return !result.ok &&
    (result.error.code === "forbidden" || result.error.code === "not_found");
}

// 메인 스레드에서만 닿는 supervisor 메모리와 지금 App 값. RuntimeSources의 부분이다.
export type AutomationSources = {
  observation(app: string): Promise<Result<RuntimeObservation | null>>;
  app(app: string): Promise<Result<RuntimeApp | null>>;
  now(): string;
};

// reader가 정한 닫힘·승인 reason 위에 현재 관측을 얹는다. 앱이 지금 열려 있지 않으면 그 이유가
// 승인 부족보다 먼저 보이고, 열려 있고 승인도 있으면 runnable이다. 관측을 못 읽으면 reader 값을
// 그대로 둔다(과거 event로 실행 중이라고 하지 않는다).
export function withAutomationObservation<
  Ctx,
>(
  base: (
    ctx: Ctx,
    input: unknown,
  ) => Result<unknown> | Promise<Result<unknown>>,
  sources: AutomationSources,
): (ctx: Ctx, input: unknown) => Promise<Result<unknown>> {
  return async (ctx, input) => {
    const pooled = await base(ctx, input);
    if (!pooled.ok) return pooled;
    const value = pooled.value as {
      app: string;
      automations: AutomationView[];
    };
    if (value.automations.length === 0) return pooled;
    const app = await sources.app(value.app);
    if (!app.ok || app.value === null) return pooled;
    const observation = await sources.observation(value.app);
    if (!observation.ok) return pooled;
    const current = observation.value;
    return ok({
      ...value,
      automations: value.automations.map((view): AutomationView => {
        if (view.release === null) return view;
        // App 값은 지금 값으로 다시 본다. reader 이후 바뀌었을 수 있다.
        const closed = appGate(app.value as RuntimeApp, view.release);
        if (closed !== null) {
          return { ...view, runnable: false, reason: closed };
        }
        const live = observationGate(current, view.release);
        if (live !== null) return { ...view, runnable: false, reason: live };
        if (view.reason?.code === AUTOMATION_REASONS.permissionRequired) {
          return view;
        }
        const { reason: _drop, ...rest } = view;
        return { ...rest, runnable: true };
      }),
      observed_at: current === null ? null : sources.now(),
    });
  };
}
