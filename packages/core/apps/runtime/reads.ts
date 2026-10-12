// 현재 RuntimeState와 최대 200줄 log의 read. ledger write queue를 거치지 않는다.
// 관측·log source는 조립이 주입하고, 없으면 null·none으로 명시한다(R13, R14).
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  ReadDefinition,
} from "../../../protocol/server/mod.ts";
import {
  type App,
  appLogs,
  type AppLogState,
  appRuntime,
  LOG_LINE_MAX_COUNT,
  LOG_LINE_MAX_LENGTH,
  type RuntimeObservation,
  type RuntimeState,
} from "../../../protocol/apps/mod.ts";
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
  input: {
    invocation?: string;
    limit: number;
    max_bytes?: number;
    cursor?: string;
  },
) => {
  state: AppLogState;
  lines: string[];
  collected_at: string | null;
  truncated: boolean;
  next_cursor?: string | null;
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
        // machine(problems collector)은 credential scope가 이 앱을 직접 이름 지었을 때만 읽는다.
        // 앱 대상이 없는 machine 자격은 operation이 있어도 없는 앱과 같은 응답이다.
        if (
          ctx.actor === "machine" &&
          ctx.scope.targets.app !== input.app
        ) return notFound();
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
          ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        });
        return ok({
          ...(feed ?? {
            state: "none" as AppLogState,
            lines: [],
            collected_at: null,
            truncated: false,
          }),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: feed?.next_cursor ?? null,
        });
      },
    },
  };
}

function denied(result: Result<unknown>): boolean {
  return !result.ok &&
    (result.error.code === "forbidden" || result.error.code === "not_found");
}

// core 메인 스레드의 read handler 모양. reader pool의 read가 이 모양으로 이어진다.
export type MainRead = (
  ctx: AuthenticatedContext,
  input: unknown,
) => Result<unknown> | Promise<Result<unknown>>;

// 메인 스레드에서만 닿는 supervisor 메모리. reader Worker는 이 값을 볼 수 없어서 reader가 먼저
// 접근 판정과 ledger 기준 값을 만들고, 메인이 현재 관측·log로 덮는다(R13, R14).
export type RuntimeSources = {
  // 질의가 실패하면 그 관측은 없는 것이다. 과거 event로 생존을 추정하지 않는다.
  observation(app: string): Promise<Result<RuntimeObservation | null>>;
  logs(
    app: string,
    query: {
      invocation?: string;
      limit: number;
      max_bytes?: number;
      cursor?: string;
    },
  ): Promise<
    Result<{
      state: AppLogState;
      lines: string[];
      collected_at: string | null;
      truncated: boolean;
      next_cursor?: string | null;
    }>
  >;
  // 지금 ledger의 App. 상태 계산에 쓴다.
  app(
    app: string,
  ): Promise<
    Result<Pick<App, "active_release" | "status" | "run_enabled"> | null>
  >;
  // 알려진 secret까지 지운 줄. 안전화를 끝내지 못하면 null이다(fail-closed).
  redact(line: string): string | null;
  now(): string;
};

// apps.runtime: reader가 접근을 판정한 결과에 현재 관측과 그 관측으로 계산한 상태를 얹는다.
export function withRuntimeObservation(
  base: MainRead,
  sources: RuntimeSources,
): MainRead {
  return async (ctx, input) => {
    const pooled = await base(ctx, input);
    if (!pooled.ok) return pooled;
    const value = pooled.value as {
      app: string;
      as_of_seq: string;
      next_cursor: string | null;
    };
    const app = await sources.app(value.app);
    // App을 못 읽으면 reader가 낸 값(관측 없음)을 그대로 둔다.
    if (!app.ok || app.value === null) return pooled;
    const observed = await sources.observation(value.app);
    const observation = observed.ok ? observed.value : null;
    const state: RuntimeState = projection(app.value, observation);
    return ok({
      ...value,
      state,
      observation,
      observed_at: observation === null ? null : sources.now(),
    });
  };
}

// apps.logs: 접근을 통과한 앱의 supervisor log buffer를 받아 redaction한 줄로 돌려준다.
export function withRuntimeLogs(
  base: MainRead,
  sources: RuntimeSources,
): MainRead {
  return async (ctx, input) => {
    const pooled = await base(ctx, input);
    if (!pooled.ok) return pooled;
    const query = input as {
      app: string;
      invocation?: string;
      limit?: number;
      max_bytes?: number;
      cursor?: string;
    };
    const feed = await sources.logs(query.app, {
      ...(query.invocation === undefined
        ? {}
        : { invocation: query.invocation }),
      limit: query.limit ?? DEFAULT_LOG_LIMIT,
      ...(query.max_bytes === undefined ? {} : { max_bytes: query.max_bytes }),
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
    });
    // supervisor에 닿지 못하면 source가 없는 것이다. 없는 log를 만들지 않는다(R14).
    if (!feed.ok) return pooled;
    const lines: string[] = [];
    for (const line of feed.value.lines) {
      const safe = sources.redact(line);
      if (safe === null) {
        return ok({
          ...(pooled.value as object),
          state: "none" as AppLogState,
          lines: [],
          collected_at: null,
          truncated: false,
        });
      }
      lines.push(safe.slice(0, LOG_LINE_MAX_LENGTH));
    }
    return ok({
      ...(pooled.value as object),
      state: feed.value.state,
      lines,
      collected_at: feed.value.collected_at,
      truncated: feed.value.truncated,
      next_cursor: feed.value.next_cursor ?? null,
    });
  };
}
