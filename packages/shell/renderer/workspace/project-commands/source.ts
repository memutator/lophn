// `project_commands/*` route 호출기. 로컬 core와 다른 컴퓨터(`machines/call` proxy CoreSource)가 같은 모양을 쓴다.
import { err, ok, type Result } from "../../../../base/mod.ts";
import {
  type DetectResult,
  type ProjectCommand,
  type ProjectCommandInput,
  type ProjectCommandPatch,
  type ProjectCommandRun,
  type ProjectCommandSettings,
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
  projectCommandsUpdate,
} from "../../../../protocol/projects/project-commands.ts";
import type { CoreSource } from "../../desktop/connection/connection.ts";

export interface ProjectCommandListResult {
  readonly commands: ProjectCommand[];
  readonly runs: ProjectCommandRun[];
  readonly settings: ProjectCommandSettings;
  readonly can_run: boolean;
}

export interface ProjectCommandsSource {
  list(
    project: string,
    options?: { includeEnv?: boolean },
  ): Promise<Result<ProjectCommandListResult>>;
  detect(project: string): Promise<Result<DetectResult>>;
  add(
    project: string,
    command: ProjectCommandInput,
  ): Promise<Result<{ command: ProjectCommand }>>;
  update(
    project: string,
    id: string,
    patch: ProjectCommandPatch,
  ): Promise<Result<{ command: ProjectCommand }>>;
  remove(project: string, id: string): Promise<Result<{ removed: boolean }>>;
  reorder(
    project: string,
    ids: readonly string[],
  ): Promise<Result<{ commands: ProjectCommand[] }>>;
  importCommands(
    project: string,
    commands: readonly ProjectCommandInput[],
  ): Promise<
    Result<{
      added: ProjectCommand[];
      skipped: string[];
    }>
  >;
  setSettings(
    project: string,
    settings: ProjectCommandSettings,
  ): Promise<Result<{ settings: ProjectCommandSettings }>>;
  run(
    project: string,
    command: string,
    options?: { wait?: boolean },
  ): Promise<Result<{ run: ProjectCommandRun; tail?: string }>>;
  stop(
    project: string,
    options: { command?: string; all?: boolean },
  ): Promise<Result<{ runs: ProjectCommandRun[] }>>;
  restart(
    project: string,
    command: string,
    options?: { wait?: boolean },
  ): Promise<Result<{ run: ProjectCommandRun; tail?: string }>>;
  logs(
    project: string,
    command: string,
    lines?: number,
  ): Promise<
    Result<{
      run: ProjectCommandRun | null;
      lines: string[];
      truncated: boolean;
    }>
  >;
}

const KNOWN_CODES = new Set([
  "invalid_input",
  "not_found",
  "forbidden",
  "unauthorized",
  "conflict",
  "unavailable",
  "internal",
] as const);

async function callRoute<O>(
  core: CoreSource,
  route: {
    readonly kind: "read" | "memory";
    readonly resource: string;
    readonly method: string;
    readonly output: {
      safeParse(v: unknown): { success: true; data: O } | { success: false };
    };
  },
  input: unknown,
): Promise<Result<O>> {
  const reply = await core.call({
    kind: route.kind,
    resource: route.resource,
    method: route.method,
    body: input,
  });
  if (!reply.ok) {
    const rawCode = reply.error?.code;
    const code = KNOWN_CODES.has(rawCode as never)
      ? (rawCode as
          | "invalid_input"
          | "not_found"
          | "forbidden"
          | "unauthorized"
          | "conflict"
          | "unavailable"
          | "internal")
      : "internal";
    return err({ code, message: reply.error?.message ?? "core call failed" });
  }
  const parsed = route.output.safeParse(reply.value);
  if (!parsed.success) {
    return err({ code: "internal", message: "unexpected core response" });
  }
  return ok(parsed.data);
}

export function createProjectCommandsSource(
  core: CoreSource,
): ProjectCommandsSource {
  return {
    list: (project, options) =>
      callRoute(core, projectCommandsList, {
        project,
        ...(options?.includeEnv ? { include_env: true } : {}),
      }),
    detect: (project) => callRoute(core, projectCommandsDetect, { project }),
    add: (project, command) =>
      callRoute(core, projectCommandsAdd, { project, command }),
    update: (project, id, patch) =>
      callRoute(core, projectCommandsUpdate, { project, id, patch }),
    remove: (project, id) =>
      callRoute(core, projectCommandsRemove, { project, id }),
    reorder: (project, ids) =>
      callRoute(core, projectCommandsReorder, { project, ids: [...ids] }),
    importCommands: (project, commands) =>
      callRoute(core, projectCommandsImport, {
        project,
        commands: [...commands],
      }),
    setSettings: (project, settings) =>
      callRoute(core, projectCommandsSetSettings, { project, settings }),
    run: (project, command, options) =>
      callRoute(core, projectCommandsRun, {
        project,
        command,
        ...(options?.wait ? { wait: true } : {}),
      }),
    stop: (project, options) =>
      callRoute(core, projectCommandsStop, {
        project,
        ...(options.command === undefined ? {} : { command: options.command }),
        ...(options.all ? { all: true } : {}),
      }),
    restart: (project, command, options) =>
      callRoute(core, projectCommandsRestart, {
        project,
        command,
        ...(options?.wait ? { wait: true } : {}),
      }),
    logs: (project, command, lines) =>
      callRoute(core, projectCommandsLogs, {
        project,
        command,
        ...(lines === undefined ? {} : { lines }),
      }),
  };
}
