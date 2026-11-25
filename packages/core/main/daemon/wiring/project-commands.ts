// project commands wiring: ledger 표(`projects.commands`), 정의·설정·감지·실행 route,
// 명령 전용 PTY runtime과 shutdown 정리를 조립한다.
// 표를 만드는 schema step이 lock 끝에 붙어야 하므로 WIRINGS 맨 뒤에 둔다.
import { access, readFile } from "node:fs/promises";
import { createIdSource, err, ok, type Result } from "../../../../base/mod.ts";
import {
  type ToolGateResult,
  toolGateCheck,
} from "../../../../protocol/approvals/mod.ts";
import type { BusEvent } from "../../../../protocol/events/bus.ts";
import { workspaceSessionRead } from "../../../../protocol/lophn-agent/agent-sessions.ts";
import type { AgentId } from "../../../../protocol/lophn-agent/workspaces.ts";
import {
  PROJECT_COMMAND_MEMORY_ROUTES,
  PROJECT_COMMAND_READ_ROUTES,
  projectCommandsAdd,
  projectCommandsDetect,
  projectCommandsImport,
  projectCommandsList,
  projectCommandsLogs,
  projectCommandsRemove,
  projectCommandsReorder,
  projectCommandsRestart,
  projectCommandsRun,
  projectCommandsSetSettings,
  projectCommandsStop,
  projectCommandsStore,
  projectCommandsUpdate,
} from "../../../../protocol/projects/project-commands.ts";
import {
  createProjectCommandHandlers,
  createProjectCommandRuntime,
  type DetectFs,
  loadProjectCommands,
  PROJECT_COMMANDS_CONTEXT,
  PROJECT_COMMANDS_SCHEMA_STEPS,
  type ProjectCommandRuntime,
  projectCommandsStoreCommand,
} from "../../../projects/commands/mod.ts";
import {
  projectExists,
  projectFolderPaths,
} from "../../../projects/lookups.ts";
import { openConnection } from "../../../storage/ledger/mod.ts";
import { WORKFLOW_OPEN_MODE_SCHEMA_STEP } from "../../../workflows/open-mode-schema.ts";
import { WORKFLOW_TITLE_SCHEMA_STEP } from "../../../workflows/title-schema.ts";
import { createProductRedactor, type WiringFactory } from "./context.ts";

const key = (route: { resource: string; method: string }) =>
  `${route.resource}/${route.method}`;

const UNWIRED_READ = () =>
  err({
    code: "unavailable" as const,
    message: "project commands not wired",
  });

const nodeDetectFs: DetectFs = {
  async readText(path) {
    try {
      return await readFile(path, "utf8");
    } catch {
      return null;
    }
  },
  async exists(path) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
};

export function createCoreRegistration() {
  return {
    commands: [projectCommandsStoreCommand],
    apiReads: PROJECT_COMMAND_READ_ROUTES.map((route) => ({
      route,
      handle: UNWIRED_READ,
    })),
    memoryRoutes: PROJECT_COMMAND_MEMORY_ROUTES,
  };
}

export const projectCommandsWiring: WiringFactory = () => {
  let runtime: ProjectCommandRuntime | undefined;
  return {
    name: "project-commands",
    schemaStepsAfterTeams: [
      ...PROJECT_COMMANDS_SCHEMA_STEPS,
      WORKFLOW_OPEN_MODE_SCHEMA_STEP,
      WORKFLOW_TITLE_SCHEMA_STEP,
    ],
    operations: () => [
      {
        name: projectCommandsStore.name,
        actors: ["machine"],
        kind: "command",
      },
    ],
    records: () => [PROJECT_COMMANDS_CONTEXT],
    build(ctx) {
      const ids = createIdSource({ clock: ctx.clock, random: ctx.random });
      const load = (project: string) => {
        const opened = openConnection(ctx.ledgerPath);
        if (!opened.ok) return opened;
        try {
          return loadProjectCommands(opened.value.sql, project);
        } finally {
          opened.value.close();
        }
      };
      const folders = async (project: string) => {
        const opened = openConnection(ctx.ledgerPath);
        if (!opened.ok) return opened;
        try {
          if (!projectExists(opened.value.sql, project)) {
            return err({
              code: "not_found" as const,
              message: "project not found",
            });
          }
          return ok(
            projectFolderPaths(opened.value.sql, project).map(
              (path, index) => ({
                folder_ref: `${project}_${index}`,
                path,
              }),
            ),
          );
        } finally {
          opened.value.close();
        }
      };

      const redactor = createProductRedactor(ctx.knownSecrets);
      const fallbackRedactor = createProductRedactor();
      const logRedactionSource = {
        concern: "project-commands",
        revision: "1",
        scope: "logs",
      };
      runtime = createProjectCommandRuntime({
        terminals: ctx.terminals,
        folders,
        clock: ctx.clock,
        ids,
        onRunChanged(project, run) {
          ctx.bus.publish({
            type: "ProjectCommandRunChanged",
            subject: project,
            at: ctx.clock.now(),
            payload: { project, run },
          } as BusEvent);
        },
        openPreview(project, url) {
          ctx.hostQueue.openTab({
            owner: "person",
            workspace: { kind: "project", id: project },
            target: { browser: { url } },
            relation: null,
            source: null,
          });
        },
        redact: (text) =>
          redactor(logRedactionSource, "text/plain", text) ??
          fallbackRedactor(logRedactionSource, "text/plain", text) ??
          text,
      });

      const handlers = createProjectCommandHandlers({
        load,
        async save(project, update) {
          const done = await ctx.writer.command(PROJECT_COMMANDS_CONTEXT, {
            command: projectCommandsStore.name,
            input: { project, ...update },
            idempotency_key: ids.newId("idk"),
            compare: {},
            prepared: [],
          });
          return done.ok ? ok(undefined) : done;
        },
        folders,
        detectFs: nodeDetectFs,
        runtime,
        isDevice: (principal) => ctx.peek.deviceKind?.(principal) != null,
        granted: (principal) =>
          ctx.peek.terminalInputGrant?.(principal) ?? false,
        async sessionAgent(session): Promise<Result<AgentId>> {
          const found = await ctx.runtime.readers.read(
            workspaceSessionRead,
            PROJECT_COMMANDS_CONTEXT,
            { session },
          );
          if (!found.ok) return found;
          return ok(
            (found.value as { session: { agent: AgentId } }).session.agent,
          );
        },
        askPerson: async (who, input) => {
          const gate = ctx.runtime.memory.handlers.get(key(toolGateCheck));
          return gate === undefined
            ? err({ code: "unavailable", message: "route unavailable" })
            : ((await gate(who, input)) as Result<ToolGateResult>);
        },
        onDefinitionsChanged(project) {
          ctx.bus.publish({
            type: "ProjectCommandsChanged",
            subject: project,
            at: ctx.clock.now(),
            payload: { project },
          } as BusEvent);
        },
      });

      return ok({
        memory: [
          [key(projectCommandsAdd), handlers.add],
          [key(projectCommandsUpdate), handlers.update],
          [key(projectCommandsRemove), handlers.remove],
          [key(projectCommandsReorder), handlers.reorder],
          [key(projectCommandsImport), handlers.importCommands],
          [key(projectCommandsSetSettings), handlers.setSettings],
          [key(projectCommandsRun), handlers.run],
          [key(projectCommandsStop), handlers.stop],
          [key(projectCommandsRestart), handlers.restart],
        ],
        reads: (reads) => {
          reads.set(key(projectCommandsList), handlers.list);
          reads.set(key(projectCommandsDetect), handlers.detect);
          reads.set(key(projectCommandsLogs), handlers.logs);
        },
      });
    },
    // closeChildren은 terminalsWiring.closeWork(PTY host 종료)보다 먼저 돈다.
    // 도는 명령을 shutdown으로 정리해 `ended_by: "shutdown"`을 확정한다.
    async closeChildren() {
      await runtime?.shutdown();
    },
  };
};
