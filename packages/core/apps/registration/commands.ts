import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type App,
  appArchive,
  appArchived,
  appConnectSource,
  appCreate,
  appCreated,
  appRename,
  appRenamed,
  appSchema,
  appSourceConnected,
  appUnarchive,
  appUnarchived,
} from "../../../protocol/apps/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { domainProvisioningPort } from "../../../protocol/domains/mod.ts";
import { type AppAccessTarget, authorizeApp, denied } from "./model.ts";
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

// 등록은 사람과 lophn agent(앱 만들기 tool)만 한다. coding agent의 token은 앱 하나를 열 뿐이라
// 새 앱을 등록하지 않는다. 앱의 `app:` actor는 route actors와 함께 거른다.
function requireCreator(ctx: RequestContext): Result<void> {
  const kind = parseActor(ctx.actor)?.kind;
  return kind === "user" || kind === "agent"
    ? ok(undefined)
    : forbidden("app creation is user or lophn agent only");
}

// source 연결은 user, coding connection, 그 앱 place의 agent, core 안 machine 자격만 받는다. agent의 앱은
// 자격 조건이 정한다. machine 자격은 core 안에서만 만들고 operation 상한이 이 command 하나다(registration/source-folder.ts).
function requireWriter(ctx: RequestContext, app: string): Result<void> {
  const kind = parseActor(ctx.actor)?.kind;
  if (kind === "agent") {
    return ctx.conditions.app === app
      ? ok(undefined)
      : forbidden("an agent connects only the app of its session's place");
  }
  return kind === "user" || kind === "coding_agent" || kind === "machine"
    ? ok(undefined)
    : forbidden(
        "app changes are user, coding connection or app place agent only",
      );
}

// 등록은 전체 범위 요청만 받는다. 앱 하나 scope의 conditions.app은
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

function accessTarget(before: App | null, after: App): AppAccessTarget {
  return { kind: "command", before, after };
}

export function createAppCommands(): {
  create: CommandDefinition<typeof appCreate>;
  connectSource: CommandDefinition<typeof appConnectSource>;
  archive: CommandDefinition<typeof appArchive>;
  unarchive: CommandDefinition<typeof appUnarchive>;
  rename: CommandDefinition<typeof appRename>;
} {
  return {
    create: {
      route: appCreate,
      handle(tx, ctx, input) {
        const actor = requireCreator(ctx);
        if (!actor.ok) return actor;
        const whole = requireWholeScope(ctx);
        if (!whole.ok) return whole;
        // 미리 배정한 ID는 사람 자격만 쓴다. agent는 ID를 정하지 못하고, 이미 있는 ID는 만들지 않는다.
        if (input.id !== undefined) {
          if (parseActor(ctx.actor)?.kind !== "user") {
            return forbidden("only a person assigns an app id");
          }
        }
        const id = input.id ?? tx.newId("app");
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
        if (
          input.id !== undefined &&
          tx.sql.get("SELECT id FROM apps WHERE id = ?", [input.id]) !==
            undefined
        )
          return conflict("app id already exists");
        // 앱 이름의 domain이 같은 tx에서 함께 생긴다. 이미 그 이름이 있으면 conflict이고 앱도 남지 않는다.
        const domain = tx.port(domainProvisioningPort).create({
          name: input.slug,
          title: input.name,
          purpose: input.description,
          owner: { kind: "app", id },
        });
        if (!domain.ok) return domain;
        const seq = tx.emit(appCreated, id, {
          slug: input.slug,
          name: input.name,
          description: input.description,
          ...(input.planning_version === undefined
            ? {}
            : { planning_version: input.planning_version }),
        });
        const app: App = { ...candidate, revision: seq };
        insertApp(tx, app);
        return appView(app);
      },
    },
    connectSource: {
      route: appConnectSource,
      handle(tx, ctx, input, compare) {
        const actor = requireWriter(ctx, input.app);
        if (!actor.ok) return actor;
        const current = loadApp(tx.sql, input.app);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        // 경로 문법은 contract가 이미 판정했으므로 그대로 저장한다. 폴더 확인(있고, git 저장소의 맨 위이고,
        // commit이 있음)은 tx 밖 writer 앞(source-folder.ts)이 한다.
        const resolved = input.source_path;
        const changed: App = { ...current.value, source_path: resolved };
        const access = authorizeApp(
          tx.port,
          ctx,
          appConnectSource.name,
          accessTarget(current.value, changed),
        );
        // 범위 밖 앱은 revision 비교보다 먼저 없는 앱과 같은 응답으로 닫는다.
        if (denied(access)) return notFound();
        if (!access.ok) return access;
        if (current.value.revision !== compare.base_revision) {
          return conflict("app revision changed");
        }
        // source 연결은 운영 상태를 건드리지 않는다. active_release·
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
        return transition(tx, ctx, appArchive.name, input.app, compare, {
          from: "active",
          to: "archived",
          event: appArchived,
          payload: { run_enabled: false as const },
        });
      },
    },
    unarchive: {
      route: appUnarchive,
      handle(tx, ctx, input, compare) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        return transition(tx, ctx, appUnarchive.name, input.app, compare, {
          from: "archived",
          to: "active",
          // 보관 해제는 실행 재개의 숨은 동의가 아니다. false를 유지한다.
          event: appUnarchived,
          payload: { run_enabled: false as const },
        });
      },
    },
    rename: {
      route: appRename,
      handle(tx, ctx, input, compare) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        const current = loadApp(tx.sql, input.app);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        const changed: App = { ...current.value, name: input.name };
        const access = authorizeApp(
          tx.port,
          ctx,
          appRename.name,
          accessTarget(current.value, changed),
        );
        // 범위 밖 앱은 revision 비교보다 먼저 없는 앱과 같은 응답으로 닫는다.
        if (denied(access)) return notFound();
        if (!access.ok) return access;
        if (current.value.revision !== compare.base_revision) {
          return conflict("app revision changed");
        }
        const seq = tx.emit(appRenamed, changed.id, { name: input.name });
        const next: App = { ...changed, revision: seq };
        const stored = replaceApp(tx, next);
        if (!stored.ok) return stored;
        return appView(next);
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
  // 범위 밖 앱은 상태·revision 비교보다 먼저 없는 앱과 같은 응답으로 닫는다.
  if (denied(access)) return notFound();
  if (!access.ok) return access;
  if (current.value.status !== move.from) {
    return conflict(`app status is not ${move.from}`);
  }
  if (current.value.revision !== compare.base_revision) {
    return conflict("app revision changed");
  }
  const seq = tx.emit(move.event, changed.id, move.payload);
  const next: App = { ...changed, revision: seq };
  const stored = replaceApp(tx, next);
  if (!stored.ok) return stored;
  return appView(next);
}
