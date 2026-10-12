// 실행 허용 변경(user)과 supervisor 관측 사실의 기록(machine). 짧은 Tx만 남긴다.
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
  type RuntimeObservation,
  type RuntimeState,
} from "../../protocol/apps/mod.ts";
import type { CommandDefinition, Tx } from "../../protocol/platform/mod.ts";
import {
  type AppAccessTarget,
  authorizeApp,
  loadApp,
  replaceApp,
} from "../registration/mod.ts";
import { projection } from "./model.ts";

function notFound(): Result<never> {
  return err({ code: "not_found", message: "app not found" });
}

function conflict(message: string): Result<never> {
  return err({ code: "conflict", message });
}

function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

function accessTarget(before: App, after: App): AppAccessTarget {
  return { kind: "command", before, after };
}

type RuntimeFact = "AppStarted" | "AppStopped" | "AppUnavailable";

// 같은 자식의 같은 관측은 이미 남아 있으면 다시 남기지 않는다(재전송).
function recorded(
  tx: Tx,
  type: "AppStarted" | "AppStopped",
  app: string,
  release: string,
  nonce: string,
): boolean {
  return tx.sql.get(
    `SELECT 1 AS found FROM events
     WHERE subject = ? AND type = ?
       AND json_extract(payload, '$.release') = ?
       AND json_extract(payload, '$.process_nonce') = ?
     LIMIT 1`,
    [app, type, release, nonce],
  ) !== undefined;
}

// AppUnavailable payload에는 자식 신원이 없다. 마지막 관측이 같은 release·같은
// 근거의 AppUnavailable이면 상태가 바뀌지 않았으므로 재전송이다. 그 사이에
// AppStarted나 AppStopped가 있으면 새 관측이다.
function sameAsLast(
  tx: Tx,
  app: string,
  release: string,
  reason: { code: string; summary: string },
): boolean {
  const last = tx.sql.get(
    `SELECT type, payload FROM events
     WHERE subject = ? AND type IN ('AppStarted', 'AppStopped', 'AppUnavailable')
     ORDER BY seq DESC LIMIT 1`,
    [app],
  );
  if (last === undefined || last.type !== ("AppUnavailable" as RuntimeFact)) {
    return false;
  }
  const payload = JSON.parse(String(last.payload)) as {
    release: string;
    reason: { code: string; summary: string };
  };
  return payload.release === release && payload.reason.code === reason.code &&
    payload.reason.summary === reason.summary;
}

function liveObservation(
  app: App,
  fields: Pick<
    RuntimeObservation,
    "release" | "process_nonce" | "ready" | "accepting" | "reason"
  >,
): RuntimeObservation | null {
  // 멈춘 앱에는 관측을 붙이지 않는다. 방금 기록한 사실이 live 자식의 증거는 아니다.
  if (app.status !== "active" || !app.run_enabled) return null;
  return { app: app.id, mode: "live", endpoint: null, ...fields };
}

function recordResult(
  tx: Tx,
  id: string,
  observe: (app: App) => RuntimeObservation | null,
): Result<{ app: string; state: RuntimeState }> {
  const current = loadApp(tx.sql, id);
  if (!current.ok) return current;
  if (current.value === null) return invalid("app is not registered");
  return ok({
    app: current.value.id,
    state: projection(current.value, observe(current.value)),
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
    // 실행 허용은 App 최신 revision 기준이고 active 보관 상태와 채택한 release가 필요하다.
    enableExecution: {
      route: appEnableExecution,
      handle(tx, ctx, input, compare) {
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
        const changed: App = { ...current.value, run_enabled: true };
        const access = authorizeApp(
          tx.port,
          ctx,
          appEnableExecution.name,
          accessTarget(current.value, changed),
        );
        if (!access.ok) return access;
        const seq = tx.emit(appExecutionEnabled, changed.id, {
          run_enabled: true,
        });
        const next: App = { ...changed, revision: seq };
        const stored = replaceApp(tx, next);
        if (!stored.ok) return stored;
        return ok(next);
      },
    },
    // 멈춤은 채택한 release가 없어도 거둔다. 완료는 종료 확인(record_stopped)이 말한다.
    disableExecution: {
      route: appDisableExecution,
      handle(tx, ctx, input, compare) {
        const current = loadApp(tx.sql, input.app);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        if (current.value.revision !== compare.base_revision) {
          return conflict("app revision changed");
        }
        const changed: App = { ...current.value, run_enabled: false };
        const access = authorizeApp(
          tx.port,
          ctx,
          appDisableExecution.name,
          accessTarget(current.value, changed),
        );
        if (!access.ok) return access;
        const seq = tx.emit(appExecutionDisabled, changed.id, {
          run_enabled: false,
        });
        const next: App = { ...changed, revision: seq };
        const stored = replaceApp(tx, next);
        if (!stored.ok) return stored;
        return ok(next);
      },
    },
    // 관측 사실의 기록이다. 사람 편집 CAS가 없고 run_enabled를 바꾸지 않는다.
    recordStarted: {
      route: appRecordStarted,
      handle(tx, _ctx, input) {
        const release = input.attestation.release;
        if (release === null) return invalid("AppStarted needs a live release");
        const current = loadApp(tx.sql, input.app);
        if (!current.ok) return current;
        if (current.value === null) return invalid("app is not registered");
        const nonce = input.attestation.process_nonce;
        if (!recorded(tx, "AppStarted", input.app, release, nonce)) {
          tx.emit(appStarted, input.app, {
            release,
            process_nonce: nonce,
            data_schema: input.attestation.data_schema,
          });
        }
        // 방금 받은 attestation이 live 연결을 확인했다는 증거다(connection_ok).
        return recordResult(tx, input.app, (app) =>
          liveObservation(app, {
            release,
            process_nonce: nonce,
            ready: true,
            accepting: true,
          }));
      },
    },
    recordStopped: {
      route: appRecordStopped,
      handle(tx, _ctx, input) {
        const current = loadApp(tx.sql, input.app);
        if (!current.ok) return current;
        if (current.value === null) return invalid("app is not registered");
        if (
          !recorded(
            tx,
            "AppStopped",
            input.app,
            input.release,
            input.process_nonce,
          )
        ) {
          tx.emit(appStopped, input.app, {
            release: input.release,
            process_nonce: input.process_nonce,
          });
        }
        // 종료를 확인했으므로 live 자식은 없다. 관측 없이 계산한다.
        return recordResult(tx, input.app, () => null);
      },
    },
    recordUnavailable: {
      route: appRecordUnavailable,
      handle(tx, _ctx, input) {
        const current = loadApp(tx.sql, input.app);
        if (!current.ok) return current;
        if (current.value === null) return invalid("app is not registered");
        if (!sameAsLast(tx, input.app, input.release, input.reason)) {
          tx.emit(appUnavailable, input.app, {
            release: input.release,
            reason: input.reason,
          });
        }
        return recordResult(tx, input.app, (app) =>
          liveObservation(app, {
            release: input.release,
            process_nonce: input.process_nonce ?? "none",
            ready: false,
            accepting: false,
            reason: input.reason,
          }));
      },
    },
  };
}
