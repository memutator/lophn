import { err, ok, type Result } from "../../../base/mod.ts";
import {
  type App,
  appArchive,
  appArchived,
  appEditFolders,
  appFoldersEdited,
  appConnectSource,
  appCreate,
  appCreated,
  appDelete,
  appDeleted,
  appRemnantsEraser,
  appRename,
  appRenamed,
  appSetIcon,
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
import { checkIconUpload, parseActor } from "../../../protocol/base/mod.ts";
import { RESERVED_APP_SLUGS } from "../../../protocol/apps/declaration/mod.ts";
import { clearAppNotices } from "../notices/commands.ts";
import { eraseApp } from "./delete.ts";
import { isFolderTakeIn } from "./folder-take-in.ts";
import { isSameOrInside } from "../permissions/model.ts";
import { type AppAccessTarget, authorizeApp, denied } from "./model.ts";
import {
  insertApp,
  loadApp,
  replaceApp,
  replaceFolders,
  storeAppIcon,
} from "./store.ts";

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

// 등록은 사람과 agent(앱 만들기 tool), 그리고 다른 기계의 앱을 들이는 폴더 take-in 자격만 한다. 앱의 `app:` actor는
// route actors와 함께 거른다. 그 밖의 machine 자격은 등록하지 못한다.
function requireCreator(ctx: RequestContext): Result<void> {
  const kind = parseActor(ctx.actor)?.kind;
  return kind === "user" || kind === "agent" || isFolderTakeIn(ctx)
    ? ok(undefined)
    : forbidden("app creation is user or lophn agent only");
}

// source 연결은 user, 그 앱 workspace의 agent, core 안 machine 자격만 받는다. agent의 앱은
// 자격 조건이 정한다. machine 자격은 core 안에서만 만들고 operation 상한이 이 command 하나다(registration/source-folder.ts).
function requireWriter(ctx: RequestContext, app: string): Result<void> {
  const kind = parseActor(ctx.actor)?.kind;
  if (kind === "agent") {
    return ctx.conditions.app === app
      ? ok(undefined)
      : forbidden("an agent connects only the app of its session's workspace");
  }
  return kind === "user" || kind === "machine"
    ? ok(undefined)
    : forbidden("app changes are user or app workspace agent only");
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
    : forbidden("this app change is user only");
}

function appView(app: App): Result<App> {
  const parsed = appSchema.safeParse(app);
  return parsed.success ? ok(parsed.data) : invalid("invalid app state");
}

// 더한 폴더끼리, 그리고 source와 겹치면 거절한다. 겹치면 같은 파일이 두 root로 잡혀 rewind 기록이 갈린다.
function overlapping(paths: readonly (string | null)[]): boolean {
  const roots = paths.filter((path): path is string => path !== null);
  return roots.some((left, at) =>
    roots
      .slice(at + 1)
      .some(
        (right) => isSameOrInside(left, right) || isSameOrInside(right, left),
      ),
  );
}

function accessTarget(before: App | null, after: App): AppAccessTarget {
  return { kind: "command", before, after };
}

export function createAppCommands(): {
  create: CommandDefinition<typeof appCreate>;
  connectSource: CommandDefinition<typeof appConnectSource>;
  archive: CommandDefinition<typeof appArchive>;
  delete: CommandDefinition<typeof appDelete>;
  unarchive: CommandDefinition<typeof appUnarchive>;
  rename: CommandDefinition<typeof appRename>;
  editFolders: CommandDefinition<typeof appEditFolders>;
  setIcon: CommandDefinition<typeof appSetIcon>;
} {
  return {
    create: {
      route: appCreate,
      handle(tx, ctx, input) {
        const actor = requireCreator(ctx);
        if (!actor.ok) return actor;
        const whole = requireWholeScope(ctx);
        if (!whole.ok) return whole;
        // 앱 id는 기계 사이 같은 앱의 신분이다. 정하는 것은 사람과, 다른 기계의 앱을 들이는 폴더 take-in뿐이다(take-in은
        // 늘 id를 준다). agent와 그 밖의 machine 자격은 정하지 못한다. 이미 있는 ID는 만들지 않는다.
        const takeIn = isFolderTakeIn(ctx);
        if (takeIn && input.id === undefined) {
          return forbidden("the folder take-in gives the app id");
        }
        if (
          input.id !== undefined &&
          !takeIn &&
          parseActor(ctx.actor)?.kind !== "user"
        ) {
          return forbidden(
            "only a person or the folder take-in assigns an app id",
          );
        }
        // 앱 slug는 `lophn <slug> <command>`의 첫 낱말이라 내장 명령 이름은 쓰지 못한다.
        if (RESERVED_APP_SLUGS.includes(input.slug)) {
          return invalid(`app slug ${input.slug} is reserved`);
        }
        const id = input.id ?? tx.newId("app");
        const candidate: App = {
          id,
          slug: input.slug,
          name: input.name,
          description: input.description,
          planning_version: input.planning_version ?? null,
          source_path: null,
          folders: [],
          active_release: null,
          revision: "1",
          run_enabled: false,
          status: "active",
        };
        const access = authorizeApp(
          tx,
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
          tx,
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
    // 보관한 앱만 지운다(보관 -> 지움 두 걸음). 다른 module의 기록(대화, job, 공유 요청, 할당)은 port가 같은 Tx에서 지우고,
    // 파일과 shell 쪽은 commit 뒤 core/main이 지운다. 지운 앱의 event(AppCreated 등)는 immutable이라 남는다.
    delete: {
      route: appDelete,
      // 쓰던 앱은 대화·invocation·data 기록이 1000행을 쉽게 넘는다. 사람만 부르고 보관한 앱만 지운다.
      unboundedRows: true,
      handle(tx, ctx, input, compare) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        const current = loadApp(tx.sql, input.app);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        const access = authorizeApp(
          tx,
          ctx,
          appDelete.name,
          accessTarget(current.value, current.value),
        );
        if (denied(access)) return notFound();
        if (!access.ok) return access;
        if (current.value.status !== "archived") {
          return conflict("only an archived app can be deleted");
        }
        if (current.value.revision !== compare.base_revision) {
          return conflict("app revision changed");
        }
        // 도는 process가 아직 있는지는 ledger 사실(AppStarted)이 아니라 살아 있는 supervisor를 보고 쓰기 앞 처리기가 판정한다
        // (core가 꺼질 때는 AppStopped를 남기지 않아 옛 사실이 남는다).
        // port가 없으면 tx.port가 internal로 거절한다. 다른 module의 기록을 남긴 채 앱만 지우지 않으려는 것이다.
        const others = tx.port(appRemnantsEraser).erase({
          id: current.value.id,
          slug: current.value.slug,
        });
        if (!others.ok) return others;
        const erased = eraseApp(tx, input.app);
        if (!erased.ok) return erased;
        tx.emit(appDeleted, input.app, { slug: current.value.slug });
        return ok({
          id: current.value.id,
          slug: current.value.slug,
          sessions: others.value.sessions,
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
          tx,
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
    editFolders: {
      route: appEditFolders,
      handle(tx, ctx, input, compare) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        const current = loadApp(tx.sql, input.app);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        if (
          overlapping([
            current.value.source_path,
            ...input.folders.map((folder) => folder.path),
          ])
        ) {
          return invalid("folders cannot repeat or overlap the app source");
        }
        const changed: App = { ...current.value, folders: input.folders };
        const access = authorizeApp(
          tx,
          ctx,
          appEditFolders.name,
          accessTarget(current.value, changed),
        );
        if (denied(access)) return notFound();
        if (!access.ok) return access;
        if (current.value.revision !== compare.base_revision) {
          return conflict("app revision changed");
        }
        const seq = tx.emit(appFoldersEdited, changed.id, {
          folders: input.folders,
        });
        const next: App = { ...changed, revision: seq };
        const stored = replaceApp(tx, next);
        if (!stored.ok) return stored;
        replaceFolders(tx, next);
        return appView(next);
      },
    },
    // 모양일 뿐이라 revision 비교도 event도 없다. 올린 icon 하나를 덮어쓰거나 지운다.
    setIcon: {
      route: appSetIcon,
      handle(tx, ctx, input) {
        const actor = requireUser(ctx);
        if (!actor.ok) return actor;
        const icon =
          input.icon === null ? ok(null) : checkIconUpload(input.icon);
        if (!icon.ok) return icon;
        const current = loadApp(tx.sql, input.app);
        if (!current.ok) return current;
        if (current.value === null) return notFound();
        const access = authorizeApp(
          tx,
          ctx,
          appSetIcon.name,
          accessTarget(current.value, current.value),
        );
        if (denied(access)) return notFound();
        if (!access.ok) return access;
        storeAppIcon(tx, input.app, icon.value);
        return ok({ uploaded: icon.value !== null });
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
    tx,
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
  if (move.to === "archived") clearAppNotices(tx, changed.id);
  return appView(next);
}
