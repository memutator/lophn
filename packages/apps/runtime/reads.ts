// 현재 RuntimeState와 최대 200줄 log의 read. ledger write queue를 거치지 않는다.
// 관측·log source는 조립이 주입하고, 없으면 null·none으로 명시한다(R13, R14).
import { err, ok, type Result } from "../../base/mod.ts";
import {
  appLogs,
  type AppLogState,
  appRuntime,
  LOG_LINE_MAX_COUNT,
  type RuntimeObservation,
  type RuntimeState,
} from "../../contracts/apps/mod.ts";
import type { ReadDefinition } from "../../contracts/platform/mod.ts";
import { authorizeApp, loadApp } from "../registration/mod.ts";
import { projection } from "./model.ts";

const DEFAULT_LOG_LIMIT = LOG_LINE_MAX_COUNT;

function notFound(): Result<never> {
  return err({ code: "not_found", message: "app not found" });
}

export type RuntimeObservationSource = (
  app: string,
) => {
  observation: RuntimeObservation | null;
  observed_at: string | null;
} | undefined;

export type RuntimeLogSource = (
  app: string,
  input: { invocation?: string; limit: number; max_bytes?: number },
) => {
  state: AppLogState;
  lines: string[];
  collected_at: string | null;
  truncated: boolean;
} | undefined;

export type RuntimeReadDeps = {
  // 현재 supervisor 관측. 없으면 observation은 null이다(R13).
  observation?: RuntimeObservationSource;
  // supervisor log buffer 조회. 없으면 state는 none이다(R26).
  logs?: RuntimeLogSource;
};

export function createRuntimeReads(
  deps: RuntimeReadDeps = {},
): {
  runtime: ReadDefinition<typeof appRuntime>;
  logs: ReadDefinition<typeof appLogs>;
} {
  return {
    runtime: {
      route: appRuntime,
      handle(snapshot, ctx, input) {
        const app = loadApp(snapshot.sql, input.app);
        if (!app.ok) return app;
        if (app.value === null) return notFound();
        const access = authorizeApp(snapshot.port, ctx, appRuntime.name, {
          kind: "app",
          app: app.value,
        });
        if (denied(access)) return notFound();
        if (!access.ok) return access;
        const source = deps.observation?.(input.app);
        const observation = source?.observation ?? null;
        const observed_at = source?.observed_at ?? null;
        // 관측이 없으면 과거 event만으로 running이라 하지 않는다(R13).
        const state: RuntimeState = projection(app.value, observation);
        return ok({
          app: app.value.id,
          state,
          observation,
          observed_at,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
    logs: {
      route: appLogs,
      handle(snapshot, ctx, input) {
        const app = loadApp(snapshot.sql, input.app);
        if (!app.ok) return app;
        if (app.value === null) return notFound();
        const access = authorizeApp(snapshot.port, ctx, appLogs.name, {
          kind: "app",
          app: app.value,
        });
        if (denied(access)) return notFound();
        if (!access.ok) return access;
        const limit = input.limit ?? DEFAULT_LOG_LIMIT;
        // source 없음. 존재하지 않는 수집 값을 만들지 않는다(R14).
        const feed = deps.logs?.(input.app, {
          invocation: input.invocation,
          limit,
          max_bytes: input.max_bytes,
        });
        return ok({
          ...(feed ?? {
            state: "none" as AppLogState,
            lines: [],
            collected_at: null,
            truncated: false,
          }),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}

function denied(result: Result<unknown>): boolean {
  return !result.ok &&
    (result.error.code === "forbidden" || result.error.code === "not_found");
}
