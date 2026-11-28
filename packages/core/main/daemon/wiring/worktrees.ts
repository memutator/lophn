// git worktree와 source control wiring:
// - ledger 표(`projects.worktrees`), `worktrees/*` 및 `source_control/*` route,
// - 좁은 상태 감시자(watcher), setup/teardown 훅(Project Command PTY 재사용),
// - 기동 시 `creating|removing` 크래시 복구(`recoverOnStartup`)를 조립한다.
// 표를 만드는 schema step이 lock 끝에 붙어야 하므로 WIRINGS 맨 뒤에 둔다.
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import { parseActor } from "../../../../protocol/base/mod.ts";
import { modelDefaultRead } from "../../../../protocol/lophn-agent/mod.ts";
import {
  type ToolGateResult,
  toolGateCheck,
} from "../../../../protocol/approvals/mod.ts";
import type { Id } from "../../../../protocol/base/ids.ts";
import type { BusEvent } from "../../../../protocol/events/bus.ts";
import { workspaceSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import { stopTurn } from "../../../../protocol/lophn-agent/turns.ts";
import {
  SOURCE_CONTROL_MEMORY_ROUTES,
  SOURCE_CONTROL_READ_ROUTES,
  SOURCE_CONTROL_RUNTIME_ROUTES,
  sourceControlAbort,
  sourceControlBranchDelete,
  sourceControlBranchRename,
  sourceControlFetch,
  sourceControlFileAt,
  sourceControlIgnored,
  sourceControlMarkResolved,
  sourceControlMessageRequestDone,
  sourceControlMessageRequestTake,
  sourceControlSuggestCancel,
  sourceControlSuggestMessage,
  sourceControlBranchCreate,
  sourceControlBranches,
  sourceControlCommit,
  sourceControlDiff,
  sourceControlDiscard,
  sourceControlLog,
  sourceControlPull,
  sourceControlPush,
  sourceControlShow,
  sourceControlStage,
  sourceControlStatus,
  sourceControlSwitch,
  sourceControlUnstage,
} from "../../../../protocol/projects/source-control.ts";
import {
  WORKTREE_MEMORY_ROUTES,
  WORKTREE_READ_ROUTES,
  worktreesAdopt,
  worktreesCreate,
  worktreesDetectInclude,
  worktreesGet,
  worktreesList,
  worktreesRemove,
  worktreesRemovePreflight,
  worktreesRename,
  worktreesRoots,
  worktreesSettingsGet,
  worktreesSettingsSet,
  worktreesStore,
} from "../../../../protocol/projects/worktrees.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import { WORKTREE_CHANGED_EVENT } from "../../../../protocol/apps/events.ts";
import { loadProjectCommands } from "../../../projects/commands/mod.ts";
import {
  activeProjectFolderPaths,
  projectExists,
  projectFolderPaths,
} from "../../../projects/lookups.ts";
import {
  CommitMessageQueue,
  createSourceControlHandlers,
} from "../../../projects/source-control/mod.ts";
import {
  createWorktreeHandlers,
  createWorktreeService,
  createWorktreeWatcher,
  loadProjectWorktrees,
  loadWorktreeById,
  loadWorktreeByIdempotencyKey,
  loadWorktreesByStatuses,
  loadWorktreeSettings,
  nodeIncludeDetectFs,
  projectsWorktreesFolderSetting,
  RepoGitMutex,
  WORKTREES_CONTEXT,
  WORKTREES_PRINCIPAL,
  WORKTREES_SCHEMA_STEPS,
  type WorktreeService,
  type WorktreeWatcher,
  worktreesStoreCommand,
} from "../../../projects/worktrees/mod.ts";
import type { Sql } from "../../../../protocol/server/registration.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import type { WiringFactory } from "./context.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

const UNWIRED_READ = () =>
  err({
    code: "unavailable" as const,
    message: "worktrees not wired",
  });

const WORKTREES_ADMIN_CONTEXT: AuthenticatedContext = {
  ...WORKTREES_CONTEXT,
  scope: {
    operations: [
      worktreesStore.name,
      workspaceSessionRead.name,
      stopTurn.name,
      modelDefaultRead.name,
    ],
    targets: {},
  },
};

export function createCoreRegistration() {
  return {
    commands: [worktreesStoreCommand],
    apiReads: [...WORKTREE_READ_ROUTES, ...SOURCE_CONTROL_READ_ROUTES].map(
      (route) => ({
        route,
        handle: UNWIRED_READ,
      }),
    ),
    memoryRoutes: [
      ...WORKTREE_MEMORY_ROUTES,
      ...SOURCE_CONTROL_MEMORY_ROUTES,
      ...SOURCE_CONTROL_RUNTIME_ROUTES,
    ],
  };
}

export const worktreesWiring: WiringFactory = () => {
  let service: WorktreeService | undefined;
  let watcher: WorktreeWatcher | undefined;
  let startup: Promise<void> = Promise.resolve();

  return {
    name: "worktrees",
    schemaStepsAfterTeams: [...WORKTREES_SCHEMA_STEPS],
    operations: () => [
      {
        name: worktreesStore.name,
        actors: ["machine"],
        kind: "command",
      },
      {
        name: stopTurn.name,
        actors: ["machine"],
        kind: "command",
      },
    ],
    records: () => [WORKTREES_ADMIN_CONTEXT],
    build(ctx) {
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const mutex = new RepoGitMutex();
      const homeDir = homedir() || null;

      const withSql = <T>(read: (sql: Sql) => T): Result<T> => {
        const opened = openConnection(ctx.ledgerPath);
        if (!opened.ok) return opened;
        try {
          return ok(read(opened.value.sql));
        } finally {
          opened.value.close();
        }
      };

      const projectFolders = (project: string): Result<readonly string[]> => {
        const res = withSql((sql) => {
          if (!projectExists(sql, project)) return null;
          return projectFolderPaths(sql, project);
        });
        if (!res.ok) return res;
        if (res.value === null) {
          return err({ code: "not_found", message: "project not found" });
        }
        return ok(res.value);
      };

      const storeWrite = async (
        project: Id<"prj">,
        input: Record<string, unknown>,
      ): Promise<Result<void>> => {
        const done = await ctx.writer.command(WORKTREES_ADMIN_CONTEXT, {
          command: worktreesStore.name,
          input: { project, ...input },
          idempotency_key: ids.newId("idk"),
          compare: {},
          prepared: [],
        });
        return done.ok ? ok(undefined) : done;
      };

      // 앱 view의 `("lophn", "worktree.changed")`(spec 5.4.2). 구독을 선언한 앱만 받는다. status는 같은 (project, worktree)마다
      // 150ms 묶고 앞 snapshot과 다를 때만 내고, 만들기·지우기·브랜치 바뀜은 바로 낸다.
      const knownWorktrees = new Map<string, Set<string>>();
      const lastStatus = new Map<string, string>();
      const statusTimers = new Map<string, ReturnType<typeof setTimeout>>();
      const publishAppEvent = (
        project: Id<"prj">,
        worktree: Id<"wkt"> | null,
        reason: "created" | "removed" | "updated" | "status" | "branch",
      ) => {
        if (!ctx.eventDelivery.hasSubscribers("lophn")) return;
        const identity = withSql(
          (sql) =>
            (
              sql.get("select identity from projects where id = ?", [
                project,
              ]) as { identity: string } | undefined
            )?.identity ?? null,
        );
        void ctx.eventDelivery
          .publish({
            publisher: "lophn",
            release: null,
            source: "lophn",
            event: WORKTREE_CHANGED_EVENT,
            payload: {
              projectId: project,
              projectIdentity: identity.ok ? identity.value : null,
              worktreeId: worktree,
              reason,
              at: ctx.clock.now(),
            },
            chain: [],
            parent: null,
            audience: () => true,
          })
          .then((published) => {
            if (!published.ok) {
              ctx.telemetry.logger.warn({
                component: "worktrees",
                event: "worktree_changed_publish_failed",
                fields: { message: published.error.message },
              });
            }
          });
      };
      const appChanged = (project: Id<"prj">, worktree?: Id<"wkt">) => {
        if (worktree === undefined) {
          publishAppEvent(project, null, "updated");
          return;
        }
        const row = withSql((sql) => loadWorktreeById(sql, worktree));
        const live =
          row.ok && row.value !== null && row.value.status !== "removed";
        const known = knownWorktrees.get(project) ?? new Set<string>();
        knownWorktrees.set(project, known);
        const reason = !live
          ? "removed"
          : known.has(worktree)
            ? "updated"
            : "created";
        if (live) known.add(worktree);
        else known.delete(worktree);
        publishAppEvent(project, worktree, reason);
      };
      const appStatusChanged = (
        project: Id<"prj">,
        status: { worktree_id: string; branch: string | null },
      ) => {
        const id = status.worktree_id as Id<"wkt">;
        const snapshot = JSON.stringify({ ...status, updated_at: null });
        const before = lastStatus.get(id);
        if (before === snapshot) return;
        lastStatus.set(id, snapshot);
        const branchMoved =
          before !== undefined &&
          (JSON.parse(before) as { branch: string | null }).branch !==
            status.branch;
        if (branchMoved) {
          publishAppEvent(project, id, "branch");
          return;
        }
        clearTimeout(statusTimers.get(id));
        const timer = setTimeout(() => {
          statusTimers.delete(id);
          publishAppEvent(project, id, "status");
        }, 150);
        timer.unref?.();
        statusTimers.set(id, timer);
      };

      const emitChanged = (project: Id<"prj">, worktree?: Id<"wkt">) => {
        appChanged(project, worktree);
        ctx.bus.publish({
          type: "WorktreesChanged",
          subject: project,
          at: ctx.clock.now(),
          payload: {
            project,
            ...(worktree === undefined ? {} : { worktree }),
          },
        } as BusEvent);
      };

      service = createWorktreeService({
        clock: ctx.clock,
        random: ctx.random,
        ids,
        homeDir,
        defaultWorktreesRoot: join(ctx.root.path, "worktrees"),
        configuredWorktreesRoot: () =>
          ctx.settings.get(projectsWorktreesFolderSetting) ?? "",
        projectFolders,
        allProjectFolders: () => {
          const res = withSql((sql) => activeProjectFolderPaths(sql));
          return res.ok ? res.value : [];
        },
        loadProjectWorktrees: (project, options) => {
          const opened = openConnection(ctx.ledgerPath);
          if (!opened.ok) return opened;
          try {
            return loadProjectWorktrees(opened.value.sql, project, options);
          } finally {
            opened.value.close();
          }
        },
        loadWorktreeById: (id) => {
          const res = withSql((sql) => loadWorktreeById(sql, id));
          return res.ok ? res.value : null;
        },
        loadWorktreeByIdempotencyKey: (project, idempotencyKey) => {
          const res = withSql((sql) =>
            loadWorktreeByIdempotencyKey(sql, project, idempotencyKey),
          );
          return res.ok ? res.value : null;
        },
        loadWorktreesByStatuses: (statuses) => {
          const res = withSql((sql) => loadWorktreesByStatuses(sql, statuses));
          return res.ok ? res.value : [];
        },
        loadSettings: (project) => {
          const opened = openConnection(ctx.ledgerPath);
          if (!opened.ok) return opened;
          try {
            return loadWorktreeSettings(opened.value.sql, project);
          } finally {
            opened.value.close();
          }
        },
        upsert: (project, record) => storeWrite(project, { upsert: record }),
        patch: (project, patch) => storeWrite(project, { patch }),
        deleteRow: (project, id) => storeWrite(project, { delete_id: id }),
        activity: {
          activeSessions(worktreeId) {
            const res = withSql((sql) =>
              sql
                .all(
                  `SELECT DISTINCT s.id AS id
                   FROM sessions s
                   JOIN turns t ON t.session = s.id
                   WHERE s.worktree_id = ? AND t.state = 'running'`,
                  [worktreeId],
                )
                .map((row) => String(row["id"]) as Id<"ses">),
            );
            return res.ok ? res.value : [];
          },
          activeTerminals(worktreeId) {
            return ctx.terminals
              .list()
              .filter(
                (rt) =>
                  rt.worktree_id === worktreeId &&
                  (rt.state === "running" || rt.state === "starting"),
              )
              .map((rt) => rt.terminal_ref);
          },
          async stopSessionsAndTerminals(worktreeId) {
            // 1. 도는 turn을 중단한다.
            const runningTurns = withSql((sql) =>
              sql
                .all(
                  `SELECT t.id AS turn_id, t.state_seq AS state_seq
                   FROM turns t
                   JOIN sessions s ON s.id = t.session
                   WHERE s.worktree_id = ? AND t.state = 'running'`,
                  [worktreeId],
                )
                .map((row) => ({
                  turn: String(row["turn_id"]),
                  state_seq: String(row["state_seq"]),
                })),
            );
            if (runningTurns.ok) {
              for (const item of runningTurns.value) {
                await ctx.writer.command(WORKTREES_ADMIN_CONTEXT, {
                  command: stopTurn.name,
                  input: {
                    turn: item.turn,
                    request_key: ids.newId("idk"),
                    reason: "user_stopped",
                  },
                  compare: { state_seq: item.state_seq },
                  idempotency_key: ids.newId("idk"),
                  prepared: [],
                });
              }
            }
            // 2. 도는 터미널을 종료한다.
            const terms = ctx.terminals
              .list()
              .filter(
                (rt) =>
                  rt.worktree_id === worktreeId &&
                  (rt.state === "running" || rt.state === "starting"),
              );
            for (const rt of terms) {
              await ctx.terminals.close(rt.terminal_ref, rt.generation);
            }
            return ok(undefined);
          },
        },
        hooks: {
          async runSetup({ project, worktree, commandId }) {
            const cmdRuntime = ctx.peek.projectCommandRuntime;
            if (cmdRuntime === undefined) {
              return err({
                code: "unavailable",
                message: "project command runtime is not ready",
              });
            }
            const loaded = withSql((sql) => loadProjectCommands(sql, project));
            if (!loaded.ok) return loaded;
            if (!loaded.value.ok) return loaded.value;
            const cmd = loaded.value.value.commands.find(
              (one) => one.id === commandId,
            );
            if (cmd === undefined) {
              return err({
                code: "not_found",
                message: `setup command "${commandId}" not found`,
              });
            }
            const started = await cmdRuntime.start(project, cmd, {
              wait: cmd.kind === "action",
              worktreeId: worktree.id as Id<"wkt">,
            });
            if (!started.ok) return started;
            return ok({
              command_id: commandId,
              run_id: started.value.run.run_id as Id<"pcr">,
              status: started.value.run.status,
              exit_code: started.value.run.exit_code,
              ...(started.value.tail === undefined
                ? {}
                : { tail: started.value.tail }),
            });
          },
          async runTeardown({ project, worktree, commandId, timeoutMs }) {
            const cmdRuntime = ctx.peek.projectCommandRuntime;
            if (cmdRuntime === undefined) {
              return err({
                code: "unavailable",
                message: "project command runtime is not ready",
              });
            }
            const loaded = withSql((sql) => loadProjectCommands(sql, project));
            if (!loaded.ok) return loaded;
            if (!loaded.value.ok) return loaded.value;
            const cmd = loaded.value.value.commands.find(
              (one) => one.id === commandId,
            );
            if (cmd === undefined) {
              return err({
                code: "not_found",
                message: `teardown command "${commandId}" not found`,
              });
            }
            const started = await cmdRuntime.start(project, cmd, {
              wait: true,
              worktreeId: worktree.id as Id<"wkt">,
              timeoutMs,
            });
            if (!started.ok) return started;
            const run = started.value.run;
            return ok({
              ok: run.status === "succeeded",
              exit_code: run.exit_code,
              ...(started.value.tail === undefined
                ? {}
                : { tail: started.value.tail }),
              ...(run.status !== "succeeded"
                ? { error: `teardown ${run.status}` }
                : {}),
            });
          },
        },
        watcher: () => watcher,
        mutex,
        platform: process.platform,
        logger: ctx.telemetry.logger,
        onChanged: emitChanged,
      });

      watcher = createWorktreeWatcher({
        clock: ctx.clock,
        homeDir,
        listActive: () => {
          const res = withSql((sql) =>
            loadWorktreesByStatuses(sql, ["ready", "missing"]),
          );
          return res.ok ? res.value : [];
        },
        patchRecord: (project, patch) => storeWrite(project, { patch }),
        onStatusChanged(project, status) {
          appStatusChanged(project, status);
          ctx.bus.publish({
            type: "WorktreeStatusChanged",
            subject: project,
            at: ctx.clock.now(),
            payload: { project, status },
          } as BusEvent);
        },
        onWorktreesChanged: emitChanged,
        logger: ctx.telemetry.logger,
      });

      ctx.provide("worktrees", service);

      const isDevice = (principal: string) =>
        ctx.peek.deviceKind?.(principal) != null;
      const granted = (principal: string) =>
        ctx.peek.terminalInputGrant?.(principal) ?? false;

      const sessionProject = async (
        session: string,
      ): Promise<Result<Id<"prj"> | null>> => {
        const found = await ctx.runtime.readers.read(
          workspaceSessionRead,
          WORKTREES_ADMIN_CONTEXT,
          { session },
        );
        if (!found.ok) return found;
        const ws = (
          found.value as {
            session: {
              workspace: { kind: "project" | "app"; id: string } | null;
            };
          }
        ).session.workspace;
        return ok(ws?.kind === "project" ? (ws.id as Id<"prj">) : null);
      };

      const wtHandlers = createWorktreeHandlers({
        service,
        projectFolders,
        loadSettings: (project) => {
          const opened = openConnection(ctx.ledgerPath);
          if (!opened.ok) return opened;
          try {
            return loadWorktreeSettings(opened.value.sql, project);
          } finally {
            opened.value.close();
          }
        },
        saveSettings: (project, settings) => storeWrite(project, { settings }),
        detectFs: nodeIncludeDetectFs,
        isDevice,
        granted,
        sessionProject,
        askPerson: async (who, input) => {
          const gate = ctx.runtime.memory.handlers.get(key(toolGateCheck));
          return gate === undefined
            ? err({ code: "unavailable", message: "route unavailable" })
            : ((await gate(who, input)) as Result<ToolGateResult>);
        },
        onSettingsChanged: (project) => emitChanged(project),
      });

      const messageQueue = new CommitMessageQueue();
      const scHandlers = createSourceControlHandlers({
        suggest: {
          queue: messageQueue,
          async available() {
            const read = await ctx.runtime.readers.read(
              modelDefaultRead,
              WORKTREES_ADMIN_CONTEXT,
              {},
            );
            const chosen =
              read.ok &&
              (read.value as { default: unknown | null }).default !== null;
            return chosen
              ? { available: true, reason: null }
              : {
                  available: false,
                  reason:
                    "Set a default model for the lophn agent in Settings › Models to write commit messages",
                };
          },
        },
        projectFolders,
        resolveReadyWorktree: (project, worktreeId) =>
          service!.resolveReady(project, worktreeId),
        hasActiveTurnInCheckout(project, worktreeId) {
          const res = withSql((sql) => {
            const row =
              worktreeId === null
                ? sql.get(
                    `SELECT 1 AS busy
                     FROM turns t
                     JOIN sessions s ON s.id = t.session
                     WHERE t.state = 'running'
                       AND s.workspace_kind = 'project'
                       AND s.workspace_id = ?
                       AND s.worktree_id IS NULL
                     LIMIT 1`,
                    [project],
                  )
                : sql.get(
                    `SELECT 1 AS busy
                     FROM turns t
                     JOIN sessions s ON s.id = t.session
                     WHERE t.state = 'running'
                       AND s.workspace_kind = 'project'
                       AND s.workspace_id = ?
                       AND s.worktree_id = ?
                     LIMIT 1`,
                    [project, worktreeId],
                  );
            return row !== undefined;
          });
          return res.ok ? res.value : false;
        },
        isDevice,
        granted,
        sessionProject,
        mutex,
        onChanged: (project, worktree) => {
          emitChanged(project, worktree);
          if (worktree !== undefined) {
            const row = withSql((sql) => loadWorktreeById(sql, worktree));
            if (row.ok && row.value !== null) {
              void watcher?.refreshWorktree(row.value);
            }
          }
        },
      });

      return ok({
        memory: [
          [key(worktreesCreate), wtHandlers.create],
          [key(worktreesAdopt), wtHandlers.adopt],
          [key(worktreesRename), wtHandlers.rename],
          [key(worktreesRemove), wtHandlers.remove],
          [key(worktreesSettingsSet), wtHandlers.settingsSet],
          [key(sourceControlStage), scHandlers.stage],
          [key(sourceControlUnstage), scHandlers.unstage],
          [key(sourceControlDiscard), scHandlers.discard],
          [key(sourceControlCommit), scHandlers.commit],
          [key(sourceControlBranchCreate), scHandlers.branchCreate],
          [key(sourceControlSwitch), scHandlers.switchBranch],
          [key(sourceControlPush), scHandlers.push],
          [key(sourceControlPull), scHandlers.pull],
          [key(sourceControlFetch), scHandlers.fetchRemote],
          [key(sourceControlAbort), scHandlers.abort],
          [key(sourceControlMarkResolved), scHandlers.markResolved],
          [key(sourceControlBranchRename), scHandlers.branchRename],
          [key(sourceControlBranchDelete), scHandlers.branchDelete],
          [key(sourceControlSuggestMessage), scHandlers.suggestMessage],
          [key(sourceControlSuggestCancel), scHandlers.suggestCancel],
          // agent-runtime만 AI 커밋 메시지 요청을 가져가고 답한다.
          [
            key(sourceControlMessageRequestTake),
            (who) =>
              parseActor(who.actor)?.kind !== "machine"
                ? err({
                    code: "forbidden",
                    message: "only agent runtime takes commit message requests",
                  })
                : ok({ request: messageQueue.take() }),
          ],
          [
            key(sourceControlMessageRequestDone),
            (who, raw) => {
              if (parseActor(who.actor)?.kind !== "machine") {
                return err({
                  code: "forbidden",
                  message: "only agent runtime answers commit message requests",
                });
              }
              const parsed =
                sourceControlMessageRequestDone.input.safeParse(raw);
              if (!parsed.success) {
                return err({ code: "invalid_input", message: "invalid input" });
              }
              return ok({
                accepted: messageQueue.done(
                  parsed.data.request,
                  parsed.data.message,
                  parsed.data.error,
                ),
              });
            },
          ],
        ],
        reads: (reads) => {
          reads.set(key(worktreesList), wtHandlers.list);
          reads.set(key(worktreesGet), wtHandlers.get);
          reads.set(key(worktreesRemovePreflight), wtHandlers.removePreflight);
          reads.set(key(worktreesSettingsGet), wtHandlers.settingsGet);
          reads.set(key(worktreesDetectInclude), wtHandlers.detectInclude);
          reads.set(key(sourceControlStatus), scHandlers.status);
          reads.set(key(sourceControlDiff), scHandlers.diff);
          reads.set(key(sourceControlLog), scHandlers.log);
          reads.set(key(sourceControlShow), scHandlers.show);
          reads.set(key(sourceControlBranches), scHandlers.branches);
          reads.set(key(sourceControlIgnored), scHandlers.ignored);
          reads.set(key(sourceControlFileAt), scHandlers.fileAt);
          reads.set(key(worktreesRoots), () => {
            const rows = withSql((sql) =>
              loadWorktreesByStatuses(sql, ["ready"]),
            );
            if (!rows.ok) return rows;
            return ok({
              roots: rows.value.map((row) => ({
                project: row.project_id,
                worktree: row.id,
                path: row.path,
              })),
            });
          });
        },
      });
    },
    afterReady() {
      // 기동을 막지 않고 백그라운드에서 creating|removing 저널 복구와 감시 동기화를 실행한다.
      startup = service?.recoverOnStartup() ?? Promise.resolve();
      return Promise.resolve();
    },
    closeIntake() {
      watcher?.stop();
    },
    async closeWork() {
      await startup;
    },
  };
};

export { WORKTREES_PRINCIPAL };
