import { err, ok, type Result } from "../../base/mod.ts";
import {
  type App,
  appArchive,
  appArchived,
  appConnectSource,
  appCreate,
  appCreated,
  appSchema,
  appSourceConnected,
  appUnarchive,
  appUnarchived,
} from "../../contracts/apps/mod.ts";
import {
  type CommandDefinition,
  parseActor,
  type RequestContext,
  type Tx,
} from "../../contracts/platform/mod.ts";
import { placeNameReservation } from "../../contracts/documents/mod.ts";
import { resolveSourcePath } from "./adapters/source-path.ts";
import { type AppAccessTarget, authorizeApp } from "./model.ts";
import { insertApp, loadApp, replaceApp } from "./store.ts";

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

// 등록·source 연결은 user 또는 coding connection만 받는다.
// lophn agent의 `agent:`·앱의 `app:` actor는 route actors와 함께 거른다.
function requireWriter(ctx: RequestContext): Result<void> {
  const kind = parseActor(ctx.actor)?.kind;
  return kind === "user" || kind === "coding_agent"
    ? ok(undefined)
    : forbidden("app changes are user or coding connection only");
}

// 등록은 전체 범위 요청만 받는다(R3). 앱 하나 scope의 conditions.app은
// 새 앱 id를 가리킬 수 없으므로 connection scope가 앱이면 거른다.
function requireWholeScope(ctx: RequestContext): Result<void> {
  return ctx.conditions.app === undefined
    ? ok(undefined)
    : forbidden("app registration is a whole-scope request only");
}

function requireUser(ctx: RequestContext): Result<void> {
  return parseActor(ctx.actor)?.kind === "user"
    ? ok(undefined)
    : forbidden("app archive is user only");
}

function appView(app: App): Result<App> {
  const parsed = appSchema.safeParse(app);
  return parsed.success ? ok(parsed.data) : invalid("invalid app state");
}

function accessTarget(
  before: App | null,
  after: App,
): AppAccessTarget {
  return { kind: "command", before, after };
}

// 등록 뒤 place 예약은 documents/addressing을 따른다(R6, R10). Project와 같은
// 이름 공간이라 Project slug와 겹치면 conflict다. 구현은 core 조립이 등록한 port다.
export function reserveSlug(tx: Tx, app: App): Result<void> {
  return tx.port(placeNameReservation).reserve(
    app.slug,
    { kind: "app", id: app.id },
    app.revision,
  );
}

export function createAppCommands(): {
  create: CommandDefinition<typeof appCreate>;
  connectSource: CommandDefinition<typeof appConnectSource>;
  archive: CommandDefinition<typeof appArchive>;
  unarchive: CommandDefinition<typeof appUnarchive>;
} {
  return {
    create: {
      route: appCreate,
      handle(tx, ctx, input) {
        const actor = requireWriter(ctx);
        if (!actor.ok) return actor;
        const whole = requireWholeScope(ctx);
        if (!whole.ok) return whole;
        const id = tx.newId("app");
        const candidate: App = {
          id,
          slug: input.slug,
          name: input.name,
          description: input.description,
          planning_version: input.planning_version ?? null,
          source_path: null,
          active_release: null,
          revision: "1",
          run_enabled: false,
          status: "active",
        };
        const access = authorizeApp(
          tx.port,
          ctx,
          appCreate.name,
          accessTarget(null, candidate),
        );
        if (!access.ok) return access;
        const named = tx.sql.get("SELECT id FROM apps WHERE slug = ?", [
          input.slug,
        ]);
        if (named !== undefined) return conflict("app slug already exists");
        const seq = tx.emit(appCreated, id, {
          slug: input.slug,
          name: input.name,
          description: input.description,
          ...(input.planning_version === undefined
            ? {}
            : { planning_version: input.planning_version }),
        });
        const app: App = { ...candidate, revision: seq };
        const reserved = reserveSlug(tx, app);
        if (!reserved.ok) return reserved;
        insertApp(tx, app);
        return appView(app);
      },
    },
    connectSource: {
      route: appConnectSource,
      handle(tx, ctx, input, compare) {
        const actor = requireWriter(ctx);
        if (!actor.ok) return actor;
        const current = loadApp(tx.sql, input.app);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        if (current.value.revision !== compare.base_revision) {
          return conflict("app revision changed");
        }
        const resolved = resolveSourcePath(input.source_path);
        if (resolved === undefined) {
          return invalid("source must be an existing git folder");
        }
        const changed: App = { ...current.value, source_path: resolved };
        const access = authorizeApp(
          tx.port,
          ctx,
          appConnectSource.name,
          accessTarget(current.value, changed),
        );
        if (!access.ok) return access;
        // source 연결은 운영 상태를 건드리지 않는다(R5). active_release·
        // run_enabled·status는 current 값을 그대로 쓴다.
        const seq = tx.emit(appSourceConnected, changed.id, {
          source_path: resolved,
        });
        const next: App = { ...changed, revision: seq };
        const stored = replaceApp(tx, next);
        if (!stored.ok) return stored;
        return appView(next);
      },
    },
    archive: {
      route: appArchive,
      handle(tx, ctx, input, compare) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        return transition(
          tx,
          ctx,
          appArchive.name,
          input.app,
          compare,
          {
            from: "active",
            to: "archived",
            event: appArchived,
            payload: { run_enabled: false as const },
          },
        );
      },
    },
    unarchive: {
      route: appUnarchive,
      handle(tx, ctx, input, compare) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        return transition(
          tx,
          ctx,
          appUnarchive.name,
          input.app,
          compare,
          {
            from: "archived",
            to: "active",
            // 보관 해제는 실행 재개의 숨은 동의가 아니다. false를 유지한다(R8).
            event: appUnarchived,
            payload: { run_enabled: false as const },
          },
        );
      },
    },
  };
}

type Move = {
  from: "active" | "archived";
  to: "active" | "archived";
  event: typeof appArchived | typeof appUnarchived;
  payload: { run_enabled: false };
};

function transition(
  tx: Tx,
  ctx: RequestContext,
  operation: string,
  id: string,
  compare: { base_revision: string },
  move: Move,
): Result<App> {
  const current = loadApp(tx.sql, id);
  if (!current.ok) return current;
  if (current.value === null) return notFound();
  if (current.value.status !== move.from) {
    return conflict(`app status is not ${move.from}`);
  }
  if (current.value.revision !== compare.base_revision) {
    return conflict("app revision changed");
  }
  const changed: App = {
    ...current.value,
    status: move.to,
    run_enabled: false,
  };
  const access = authorizeApp(
    tx.port,
    ctx,
    operation,
    accessTarget(current.value, changed),
  );
  if (!access.ok) return access;
  const seq = tx.emit(move.event, changed.id, move.payload);
  const next: App = { ...changed, revision: seq };
  const stored = replaceApp(tx, next);
  if (!stored.ok) return stored;
  return appView(next);
}
