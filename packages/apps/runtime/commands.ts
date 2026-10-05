// 실행 허용 변경과 record_* 관측 사실의 기록. 짧은 Tx만 남긴다.
// actor·CAS·거절은 domain-model apps/runtime command 정본을 따른다.
import { err, ok, type Result } from "../../base/mod.ts";
import {
  type App,
  appDisableExecution,
  appEnableExecution,
  appExecutionDisabled,
  appExecutionEnabled,
  appRecordStarted,
  appRecordStopped,
  appRecordUnavailable,
  appStarted,
  appStopped,
  appUnavailable,
  type RuntimeState,
} from "../../contracts/apps/mod.ts";
import {
  type CommandDefinition,
  parseActor,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import {
  type AppAccessTarget,
  authorizeApp,
  loadApp,
  replaceApp,
} from "../registration/mod.ts";
import { projection as modelProjection } from "./model.ts";

function forbidden(message: string): Result<never> {
  return err({ code: "forbidden", message });
}

function notFound(): Result<never> {
  return err({ code: "not_found", message: "app not found" });
}

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// 실행 허용 변경은 user만 받는다. route actors가 이미 걸러도 여기서 한 번 더 본다.
function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user"
    ? ok(undefined)
    : forbidden("app execution changes are user only");
}

// record_*은 관측 사실의 기록이다. 사람 편집의 CAS가 필요 없다(domain-model).
function requireMachine(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "machine"
    ? ok(undefined)
    : conflict("app records are machine observations only");
}

function appView(app: App): Result<App> {
  // route output이 appSchema이므로 안전한 App 값 그대로 돌려준다.
  return ok(app);
}

function accessTarget(
  before: App | null,
  after: App,
): AppAccessTarget {
  return { kind: "command", before, after };
}

// record_*의 중복 가림. 같은 관측이 이미 events에 있으면 다시 남기지 않는다.
function factExists(
  tx: Tx,
  type: "AppStarted" | "AppStopped" | "AppUnavailable",
  app: string,
  match: (payload: Record<string, unknown>) => boolean,
): boolean {
  const rows = tx.sql.all(
    "SELECT payload FROM events WHERE subject = ? AND type = ? ORDER BY seq",
    [app, type],
  );
  return rows.some((row) => {
    try {
      const payload = JSON.parse(String(row.payload)) as Record<
        string,
        unknown
      >;
      return match(payload);
    } catch {
      return false;
    }
  });
}

export function createRuntimeCommands(): {
  enableExecution: CommandDefinition<typeof appEnableExecution>;
  disableExecution: CommandDefinition<typeof appDisableExecution>;
  recordStarted: CommandDefinition<typeof appRecordStarted>;
  recordStopped: CommandDefinition<typeof appRecordStopped>;
  recordUnavailable: CommandDefinition<typeof appRecordUnavailable>;
} {
  return {
    // 실행 허용은 App 최신 seq 기준이고 active 보관 상태와 채택한 release가 필요하다.
    enableExecution: {
      route: appEnableExecution,
      handle(tx, ctx, input, compare) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        const current = loadApp(tx.sql, input.app);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        if (current.value.revision !== compare.base_revision) {
          return conflict("app revision changed");
        }
        if (current.value.status !== "active") {
          return conflict("archived app cannot enable execution");
        }
        if (current.value.active_release === null) {
          return invalid("app has no active release");
        }
        const next: App = { ...current.value, run_enabled: true };
        const access = authorizeApp(
          tx.port,
          ctx,
          appEnableExecution.name,
          accessTarget(current.value, next),
        );
        if (!access.ok) return access;
        tx.emit(appExecutionEnabled, next.id, { run_enabled: true });
        const stored = replaceApp(tx, next);
        if (!stored.ok) return stored;
        return appView(next);
      },
    },
    // 실행 멈춤은 채택한 release가 없어도 거둔다. 완료는 종료 확인이 필요하다.
    disableExecution: {
      route: appDisableExecution,
      handle(tx, ctx, input, compare) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        const current = loadApp(tx.sql, input.app);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        if (current.value.revision !== compare.base_revision) {
          return conflict("app revision changed");
        }
        const next: App = { ...current.value, run_enabled: false };
        const access = authorizeApp(
          tx.port,
          ctx,
          appDisableExecution.name,
          accessTarget(current.value, next),
        );
        if (!access.ok) return access;
        tx.emit(appExecutionDisabled, next.id, { run_enabled: false });
        const stored = replaceApp(tx, next);
        if (!stored.ok) return stored;
        return appView(next);
      },
    },
    recordStarted: {
      route: appRecordStarted,
      handle(tx, ctx, input) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        if (input.attestation.release === null) {
          return invalid("AppStarted needs a live release");
        }
        const current = loadApp(tx.sql, input.app);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        if (
          factExists(
            tx,
            "AppStarted",
            input.app,
            (payload) =>
              payload.release === input.attestation.release &&
              payload.process_nonce === input.attestation.process_nonce,
          )
        ) {
          return state(tx, input.app);
        }
        tx.emit(appStarted, input.app, {
          release: input.attestation.release,
          process_nonce: input.attestation.process_nonce,
          data_schema: input.attestation.data_schema,
        });
        return state(tx, input.app);
      },
    },
    recordStopped: {
      route: appRecordStopped,
      handle(tx, ctx, input) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const current = loadApp(tx.sql, input.app);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        // 같은 자식의 종료 관측. 종료 확인 뒤 termination_pending은 끝난다(R15).
        if (
          factExists(
            tx,
            "AppStopped",
            input.app,
            (payload) =>
              payload.release === input.release &&
              payload.process_nonce === input.process_nonce,
          )
        ) {
          return state(tx, input.app);
        }
        tx.emit(appStopped, input.app, {
          release: input.release,
          process_nonce: input.process_nonce,
        });
        return state(tx, input.app);
      },
    },
    recordUnavailable: {
      route: appRecordUnavailable,
      handle(tx, ctx, input) {
        const machine = requireMachine(ctx);
        if (!machine.ok) return machine;
        const current = loadApp(tx.sql, input.app);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        // 자식이 없는 관측(crash loop로 멈춘 상태)은 nonce·시작 시각이 없다.
        const hasChild = input.process_nonce !== undefined &&
          input.started_at !== undefined;
        if (
          factExists(tx, "AppUnavailable", input.app, (payload) => {
            const sameIdentity = hasChild
              ? payload.process_nonce === input.process_nonce &&
                payload.started_at === input.started_at
              : payload.process_nonce === undefined;
            const reason = payload.reason as
              | { code: string; summary: string }
              | undefined;
            return payload.release === input.release &&
              reason?.code === input.reason.code &&
              reason?.summary === input.reason.summary && sameIdentity;
          })
        ) {
          return state(tx, input.app);
        }
        tx.emit(appUnavailable, input.app, {
          release: input.release,
          reason: input.reason,
        });
        return state(tx, input.app);
      },
    },
  };
}

// record 반환 state projection. 현재 App 값으로 projection한다. live 관측이
// 주입되지 않은 Tx에서는 과거 event만으로 running이라 하지 않는다(R13).
function state(
  tx: Tx,
  app: string,
): Result<{ app: string; state: RuntimeState }> {
  const current = loadApp(tx.sql, app);
  if (!current.ok) return current;
  if (current.value === null) return notFound();
  return ok({
    app: current.value.id,
    state: modelProjection(current.value, null),
  });
}
