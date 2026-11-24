import { err, ok, type Result } from "../../../base/mod.ts";
import { parseActor } from "../../../protocol/base/mod.ts";
import { workspaceSessionRead } from "../../../protocol/lophn-agent/agent-sessions.ts";
import type { AgentId } from "../../../protocol/lophn-agent/workspaces.ts";
import {
  DEFAULT_PROJECT_COMMAND_SETTINGS,
  type ProjectCommand,
  type ProjectCommandAgents,
  type ProjectCommandSettings,
  projectCommandAgentsSchema,
  projectCommandEnvSchema,
  projectCommandSchema,
  projectCommandSettingsSchema,
  projectCommandsStore,
} from "../../../protocol/projects/project-commands.ts";
import type {
  AuthenticatedContext,
  CommandDefinition,
  Sql,
  Tx,
} from "../../../protocol/server/mod.ts";
import type { ProjectCommandPolicy } from "../../approvals/gate/mod.ts";
import { projectExists } from "../lookups.ts";

export const PROJECT_COMMANDS_PRINCIPAL = "machine:project-commands";

export const PROJECT_COMMANDS_CONTEXT: AuthenticatedContext = {
  principal: PROJECT_COMMANDS_PRINCIPAL,
  actor: "machine",
  scope: {
    operations: [projectCommandsStore.name, workspaceSessionRead.name],
    targets: {},
  },
  conditions: {},
  credential_ref: PROJECT_COMMANDS_PRINCIPAL,
};

type CommandRow = {
  id: string;
  position: number;
  name: string;
  command: string;
  kind: string;
  icon: string | null;
  description: string | null;
  folder_ref: string | null;
  cwd: string | null;
  env_json: string | null;
  preview_url: string | null;
  auto_open_preview: number;
  timeout_ms: number | null;
  agents_json: string | null;
  ask_before_run: number | null;
};

type SettingsRow = {
  agents_json: string;
  ask_before_run: number;
  approve_agent_writes: number;
};

function parseJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

// env 키 목록을 정렬해 싣고, `includeEnv`가 false면 `env` 값은 뺀다.
export function sanitizeProjectCommand(
  command: ProjectCommand,
  includeEnv: boolean,
): ProjectCommand {
  const keys =
    command.env !== undefined
      ? Object.keys(command.env).sort()
      : (command.env_keys ?? []);
  const { env, env_keys: _oldKeys, ...rest } = command;
  return {
    ...rest,
    ...(keys.length > 0 ? { env_keys: keys } : {}),
    ...(includeEnv && env !== undefined && Object.keys(env).length > 0
      ? { env }
      : {}),
  };
}

// DB에서 project의 정의와 agent 설정을 읽는다. 개별 행이 손상됐으면 그 행만 건너뛰고 정상 항목을 유지한다(spec 3.2).
export function loadProjectCommands(
  sql: Pick<Sql, "get" | "all">,
  projectId: string,
): Result<{
  commands: ProjectCommand[];
  settings: ProjectCommandSettings;
}> {
  if (!projectExists(sql, projectId)) {
    return err({ code: "not_found", message: "project not found" });
  }
  const rows = sql.all(
    `SELECT id, position, name, command, kind, icon, description, folder_ref, cwd, env_json,
            preview_url, auto_open_preview, timeout_ms, agents_json, ask_before_run
     FROM project_commands
     WHERE project_id = ?
     ORDER BY position ASC, id ASC`,
    [projectId],
  ) as unknown as CommandRow[];

  const commands: ProjectCommand[] = [];
  for (const row of rows) {
    const rawEnv = parseJson(row.env_json);
    const parsedEnv =
      rawEnv === undefined
        ? undefined
        : projectCommandEnvSchema.safeParse(rawEnv);
    if (parsedEnv !== undefined && !parsedEnv.success) continue;

    const rawAgents = parseJson(row.agents_json);
    const parsedAgents =
      rawAgents === undefined
        ? undefined
        : projectCommandAgentsSchema.safeParse(rawAgents);
    if (parsedAgents !== undefined && !parsedAgents.success) continue;

    const env = parsedEnv?.data;
    const candidate = {
      id: row.id,
      name: row.name,
      command: row.command,
      kind: row.kind,
      ...(row.icon !== null ? { icon: row.icon } : {}),
      ...(row.description !== null ? { description: row.description } : {}),
      ...(row.folder_ref !== null ? { folder_ref: row.folder_ref } : {}),
      ...(row.cwd !== null ? { cwd: row.cwd } : {}),
      ...(env !== undefined && Object.keys(env).length > 0
        ? { env, env_keys: Object.keys(env).sort() }
        : {}),
      ...(row.preview_url !== null ? { preview_url: row.preview_url } : {}),
      ...(row.auto_open_preview === 1 ? { auto_open_preview: true } : {}),
      ...(row.timeout_ms !== null ? { timeout_ms: row.timeout_ms } : {}),
      order: row.position,
      ...(parsedAgents !== undefined ? { agents: parsedAgents.data } : {}),
      ...(row.ask_before_run !== null
        ? { ask_before_run: row.ask_before_run === 1 }
        : {}),
    };
    const checked = projectCommandSchema.safeParse(candidate);
    if (checked.success) commands.push(checked.data);
  }

  const settingsRow = sql.get(
    `SELECT agents_json, ask_before_run, approve_agent_writes
     FROM project_command_settings
     WHERE project_id = ?`,
    [projectId],
  ) as unknown as SettingsRow | undefined;

  let settings: ProjectCommandSettings = DEFAULT_PROJECT_COMMAND_SETTINGS;
  if (settingsRow !== undefined) {
    const parsed = projectCommandSettingsSchema.safeParse({
      agents: parseJson(settingsRow.agents_json),
      ask_before_run: settingsRow.ask_before_run === 1,
      approve_agent_writes: settingsRow.approve_agent_writes === 1,
    });
    if (parsed.success) settings = parsed.data;
  }

  return ok({ commands, settings });
}

// 명령별 덮어쓰기와 project 기본값을 합쳐 해당 agent의 판정 정책을 계산한다.
export function resolveProjectCommandPolicy(
  commands: readonly ProjectCommand[],
  settings: ProjectCommandSettings,
  commandId: string | null,
  agent: AgentId,
): ProjectCommandPolicy {
  const command =
    commandId === null
      ? undefined
      : commands.find((one) => one.id === commandId);
  const agents: ProjectCommandAgents = command?.agents ?? settings.agents;
  const allowed = agents === "all" || agents.includes(agent);
  const askBeforeRun = command?.ask_before_run ?? settings.ask_before_run;
  return {
    allowed,
    askBeforeRun,
    approveWrites: settings.approve_agent_writes,
  };
}

// id 정확 일치 먼저, 없으면 이름(대소문자 무시) 정확 일치로 찾는다.
export function findProjectCommand(
  commands: readonly ProjectCommand[],
  idOrName: string,
): ProjectCommand | undefined {
  const trimmed = idOrName.trim();
  const byId = commands.find((one) => one.id === trimmed);
  if (byId !== undefined) return byId;
  const lower = trimmed.toLowerCase();
  return commands.find((one) => one.name.toLowerCase() === lower);
}

// 이름에서 유효한 id(`^[a-z0-9][a-z0-9_-]{0,63}$`)를 만들고 중복 시 숫자 접미를 붙인다.
export function slugifyCommandId(
  name: string,
  existingIds: ReadonlySet<string>,
): string {
  const raw = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .replace(/-+/g, "-")
    .replace(/-+$/, "");
  const base = (raw === "" ? "cmd" : raw).slice(0, 58);
  if (!existingIds.has(base)) return base;
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${base}-${n}`.slice(0, 64);
    if (!existingIds.has(candidate)) return candidate;
  }
  return `cmd-${Date.now()}`.slice(0, 64);
}

function writeCommands(
  tx: Tx,
  projectId: string,
  commands: readonly ProjectCommand[],
): void {
  tx.sql.run("DELETE FROM project_commands WHERE project_id = ?", [projectId]);
  commands.forEach((cmd, index) => {
    const envJson =
      cmd.env !== undefined && Object.keys(cmd.env).length > 0
        ? JSON.stringify(cmd.env)
        : null;
    const agentsJson =
      cmd.agents !== undefined ? JSON.stringify(cmd.agents) : null;
    tx.sql.run(
      `INSERT INTO project_commands (
        project_id, id, position, name, command, kind, icon, description,
        folder_ref, cwd, env_json, preview_url, auto_open_preview,
        timeout_ms, agents_json, ask_before_run
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        projectId,
        cmd.id,
        index,
        cmd.name,
        cmd.command,
        cmd.kind,
        cmd.icon ?? null,
        cmd.description ?? null,
        cmd.folder_ref ?? null,
        cmd.cwd ?? null,
        envJson,
        cmd.preview_url ?? null,
        cmd.auto_open_preview === true ? 1 : 0,
        cmd.timeout_ms ?? null,
        agentsJson,
        cmd.ask_before_run === undefined ? null : cmd.ask_before_run ? 1 : 0,
      ],
    );
  });
}

function writeSettings(
  tx: Tx,
  projectId: string,
  settings: ProjectCommandSettings,
): void {
  tx.sql.run(
    `INSERT INTO project_command_settings (project_id, agents_json, ask_before_run, approve_agent_writes)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(project_id) DO UPDATE SET
       agents_json = excluded.agents_json,
       ask_before_run = excluded.ask_before_run,
       approve_agent_writes = excluded.approve_agent_writes`,
    [
      projectId,
      JSON.stringify(settings.agents),
      settings.ask_before_run ? 1 : 0,
      settings.approve_agent_writes ? 1 : 0,
    ],
  );
}

// writer Worker에서 실행되는 machine 전용 저장 command다.
export const projectCommandsStoreCommand: CommandDefinition<
  typeof projectCommandsStore
> = {
  route: projectCommandsStore,
  handle(tx, ctx, input) {
    const actor = parseActor(ctx.actor);
    if (
      actor?.kind !== "machine" ||
      ctx.principal !== PROJECT_COMMANDS_PRINCIPAL
    ) {
      return err({
        code: "forbidden",
        message: `${PROJECT_COMMANDS_PRINCIPAL} only`,
      });
    }
    if (!projectExists(tx.sql, input.project)) {
      return err({ code: "not_found", message: "project not found" });
    }
    if (input.commands !== undefined) {
      writeCommands(tx, input.project, input.commands);
    }
    if (input.settings !== undefined) {
      writeSettings(tx, input.project, input.settings);
    }
    return ok({ saved: true as const });
  },
};
