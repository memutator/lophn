// 현재 RuntimeState와 앱 log의 read. ledger write queue를 거치지 않는다.
// 관측 source와 log file 읽기는 조립이 주입하고, 없으면 null·빈 줄로 명시한다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  ReadDefinition,
} from "../../../protocol/server/mod.ts";
import {
  type App,
  APP_LOG_READ_DEFAULT_LINES,
  APP_LOG_TEXT_MAX_CHARS,
  appLogLineSchema,
  appLogs,
  appRuntime,
  type RuntimeObservation,
  type RuntimeState,
} from "../../../protocol/apps/mod.ts";
import { authorizeApp, loadApp } from "../registration/mod.ts";
import { projection } from "./model.ts";

function notFound(): Result<never> {
  return err({ code: "not_found", message: "app not found" });
}

type RuntimeObservationSource = (app: string) =>
  | {
      observation: RuntimeObservation | null;
      observed_at: string | null;
    }
  | undefined;

type RuntimeReadDeps = {
  // 현재 supervisor 관측. 없으면 observation은 null이다.
  observation?: RuntimeObservationSource;
};

export function createRuntimeReads(deps: RuntimeReadDeps = {}): {
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
        // 관측이 없으면 과거 event만으로 running이라 하지 않는다.
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
        // 줄은 메인 스레드가 file에서 읽어 덮는다(reader Worker는 data root를 모른다).
        return ok({
          lines: [],
          truncated: false,
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}

function denied(result: Result<unknown>): boolean {
  return (
    !result.ok &&
    (result.error.code === "forbidden" || result.error.code === "not_found")
  );
}

// core 메인 스레드의 read handler 모양. reader pool의 read가 이 모양으로 이어진다.
type MainRead = (
  ctx: AuthenticatedContext,
  input: unknown,
) => Result<unknown> | Promise<Result<unknown>>;

// 메인 스레드에서만 닿는 supervisor 메모리. reader Worker는 이 값을 볼 수 없어서 reader가 먼저
// 접근 판정과 ledger 기준 값을 만들고, 메인이 현재 관측으로 덮는다.
export type RuntimeSources = {
  // 질의가 실패하면 그 관측은 없는 것이다. 과거 event로 생존을 추정하지 않는다.
  observation(app: string): Promise<Result<RuntimeObservation | null>>;
  // 지금 ledger의 App. 상태 계산에 쓴다.
  app(
    app: string,
  ): Promise<
    Result<Pick<App, "active_release" | "status" | "run_enabled"> | null>
  >;
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

// apps.logs: 접근을 통과한 앱의 log file(`app.log.1`, `app.log` 순서의 글)을 읽어 거른 줄로 덮는다.
export function withAppLogFile(
  base: MainRead,
  deps: {
    read(app: string): Promise<string[]>;
    // 알려진 secret까지 지운 줄. 안전화를 끝내지 못하면 null이다(fail-closed).
    redact(line: string): string | null;
  },
): MainRead {
  return async (ctx, input) => {
    const pooled = await base(ctx, input);
    if (!pooled.ok) return pooled;
    const query = input as {
      app: string;
      invocation?: string;
      since?: string;
      until?: string;
      limit?: number;
    };
    const limit = query.limit ?? APP_LOG_READ_DEFAULT_LINES;
    const matched: { text: string; at: string; invocation: string | null }[] =
      [];
    for (const text of await deps.read(query.app)) {
      for (const raw of text.split("\n")) {
        // crash로 반쯤 쓴 줄은 건너뛴다.
        let json: unknown;
        try {
          json = JSON.parse(raw);
        } catch {
          continue;
        }
        const line = appLogLineSchema.safeParse(json);
        if (!line.success) continue;
        const { at, invocation } = line.data;
        if (query.invocation !== undefined && invocation !== query.invocation) {
          continue;
        }
        // At은 고정 꼴이라 글자 비교가 시각 비교다.
        if (query.since !== undefined && at < query.since) continue;
        if (query.until !== undefined && at >= query.until) continue;
        matched.push(line.data);
      }
    }
    const lines = [];
    for (const line of matched.slice(-limit)) {
      const safe = deps.redact(line.text);
      if (safe === null) {
        return err({
          code: "unavailable",
          message: "app log could not be made safe",
        });
      }
      lines.push({ ...line, text: safe.slice(0, APP_LOG_TEXT_MAX_CHARS) });
    }
    return ok({
      ...(pooled.value as object),
      lines,
      truncated: matched.length > limit,
    });
  };
}
