// `lophn command list|run|stop|restart|logs|detect|add|update|remove`:
// project의 반복 명령(action)과 dev server(service)를 사람 터미널·coding agent·lophn agent가 같은 명령 표로 다룬다.
// agent 설정 쓰기(`set_settings`)는 사람만 Project settings에서 하므로 CLI 명령으로 두지 않는다.
// `list`·`logs` 출력에는 env 값이 나오지 않는다(키 이름만).
import { z } from "zod";
import { err, type LophnError, ok, type Result } from "../../base/mod.ts";
import {
  commandKindSchema,
  type ProjectCommand,
  type ProjectCommandRun,
  projectApi,
  projectCommandCwdSchema,
  projectCommandEnvSchema,
  projectCommandIdSchema,
  projectCommandNameSchema,
  projectCommandPreviewUrlSchema,
  projectCommandScriptSchema,
  projectCommandsAdd,
  projectCommandsDetect,
  projectCommandsList,
  projectCommandsLogs,
  projectCommandsRemove,
  projectCommandsRestart,
  projectCommandsRun,
  projectCommandsStop,
  projectCommandsUpdate,
  projectCommandTimeoutSchema,
  projectIdSchema,
} from "../../protocol/projects/mod.ts";
import { type CommandContext, defineCommand } from "./types.ts";

// `--project`는 id(`prj_…`) 또는 이름이다. 생략하면 현재 project workspace(또는 cwd에서 푼 project)를 쓴다.
async function resolveProjectId(
  projectArg: string | undefined,
  ctx: CommandContext,
): Promise<Result<string, LophnError>> {
  if (projectArg !== undefined) {
    if (projectIdSchema.safeParse(projectArg).success) return ok(projectArg);
    const listed = await ctx.core.read(projectApi.list, { status: "active" });
    if (!listed.ok) return listed;
    const match = listed.value.projects.find(
      (one) =>
        one.name === projectArg ||
        one.name.toLowerCase() === projectArg.toLowerCase(),
    );
    return match !== undefined
      ? ok(match.id)
      : err({
          code: "not_found",
          message: `project "${projectArg}" was not found`,
        });
  }
  if (ctx.workspace?.kind === "project") return ok(ctx.workspace.id);
  if (ctx.cwd !== undefined) {
    const resolved = await ctx.core.read(projectApi.resolve, { path: ctx.cwd });
    if (resolved.ok) return ok(resolved.value.project.id);
  }
  return err({
    code: "invalid_input",
    message:
      "specify --project <id or name> (or run inside a registered project folder)",
  });
}

function parseEnvJson(
  raw: string | undefined,
): Result<Record<string, string> | undefined, LophnError> {
  if (raw === undefined) return ok(undefined);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return err({
      code: "invalid_input",
      message: "--env must be a JSON object of string key-value pairs",
    });
  }
  const checked = projectCommandEnvSchema.safeParse(parsed);
  if (!checked.success) {
    return err({
      code: "invalid_input",
      message: checked.error.issues[0]?.message ?? "invalid --env object",
    });
  }
  return ok(checked.data);
}

// `list` 출력에서는 env 값을 절대 싣지 않는다(키 이름만).
function stripEnvForList(cmd: ProjectCommand): Omit<ProjectCommand, "env"> {
  const { env: _env, ...rest } = cmd;
  return rest;
}

function formatRunStatus(run: ProjectCommandRun | undefined): string {
  if (run === undefined) return "idle";
  if (run.status === "failed" && run.exit_code !== null) {
    return `failed (exit ${run.exit_code})`;
  }
  return run.status;
}

const list = defineCommand({
  name: "command.list",
  summary: "List project commands and their live run status",
  description:
    "List commands defined for a project together with each command's current run status and detected local URLs. Environment variable values are never shown.",
  input: z.strictObject({
    project: z.string().min(1).optional(),
  }),
  effect: "read",
  routes: [projectCommandsList, projectApi.list, projectApi.resolve],
  workspaces: ["project", "home"],
  run: async (input, ctx) => {
    const project = await resolveProjectId(input.project, ctx);
    if (!project.ok) return project;
    const read = await ctx.core.read(projectCommandsList, {
      project: project.value,
    });
    if (!read.ok) return read;
    const byId = new Map(read.value.runs.map((one) => [one.command_id, one]));
    const items = read.value.commands.map((cmd) => {
      const run = byId.get(cmd.id);
      return {
        ...stripEnvForList(cmd),
        status: run?.status ?? "idle",
        exit_code: run?.exit_code ?? null,
        detected_urls: run?.detected_urls ?? [],
        terminal_id: run?.terminal_id ?? null,
      };
    });
    const lines = items.map((item) => {
      const run = byId.get(String(item.id));
      const urls =
        run !== undefined && run.detected_urls.length > 0
          ? `  ${run.detected_urls[0]}`
          : "";
      return `${String(item.id)}  [${String(item.kind)}]  ${String(item.name)}  (${formatRunStatus(run)})${urls}`;
    });
    return ok({
      summary: `${items.length} commands`,
      content: {
        project: project.value,
        commands: items,
        settings: read.value.settings,
      },
      arrayKeys: ["commands"],
      text: lines.length === 0 ? "No project commands." : lines.join("\n"),
    });
  },
});

const runCmd = defineCommand({
  name: "command.run",
  summary: "Run a project command",
  description:
    "Run a project command by id or name in its dedicated PTY. Services return once started; actions accept --wait to wait for completion and return exit code and output tail.",
  input: z.strictObject({
    command: z.string().min(1).max(120),
    project: z.string().min(1).optional(),
    wait: z.boolean().optional(),
  }),
  positional: ["command"],
  effect: "external",
  routes: [projectCommandsRun, projectApi.list, projectApi.resolve],
  workspaces: ["project"],
  run: async (input, ctx) => {
    const project = await resolveProjectId(input.project, ctx);
    if (!project.ok) return project;
    const ran = await ctx.core.read(projectCommandsRun, {
      project: project.value,
      command: input.command,
      ...(input.wait === undefined ? {} : { wait: input.wait }),
      ...(ctx.caller === undefined ? {} : { tool_call: ctx.caller.tool_call }),
    });
    if (!ran.ok) return ran;
    const { run, tail } = ran.value;
    const failed =
      run.status === "failed" || run.status === "timed_out"
        ? `${input.command} ${run.status}${run.exit_code !== null ? ` (exit ${run.exit_code})` : ""}`
        : undefined;
    const text = [
      `${run.command_id}: ${formatRunStatus(run)}`,
      ...(run.detected_urls.length > 0
        ? [`URL: ${run.detected_urls.join(", ")}`]
        : []),
      ...(tail !== undefined && tail !== "" ? ["", tail] : []),
    ].join("\n");
    return ok({
      summary: `${run.command_id} ${run.status}`,
      content: { run, ...(tail === undefined ? {} : { tail }) },
      text,
      ...(failed === undefined ? {} : { failed }),
    });
  },
});

const stopCmd = defineCommand({
  name: "command.stop",
  summary: "Stop a running project command (or all running commands)",
  description:
    "Stop a running project command by id or name, or pass --all to stop every running command in the project. Terminates the full process tree.",
  input: z.strictObject({
    command: z.string().min(1).max(120).optional(),
    all: z.boolean().optional(),
    project: z.string().min(1).optional(),
  }),
  positional: ["command"],
  effect: "external",
  routes: [projectCommandsStop, projectApi.list, projectApi.resolve],
  workspaces: ["project"],
  run: async (input, ctx) => {
    if (input.all !== true && input.command === undefined) {
      return err({
        code: "invalid_input",
        message: "specify <command> or --all",
      });
    }
    const project = await resolveProjectId(input.project, ctx);
    if (!project.ok) return project;
    const stopped = await ctx.core.read(projectCommandsStop, {
      project: project.value,
      ...(input.command === undefined ? {} : { command: input.command }),
      ...(input.all === true ? { all: true } : {}),
    });
    if (!stopped.ok) return stopped;
    const runs = stopped.value.runs;
    return ok({
      summary: `stopped ${runs.length} command${runs.length === 1 ? "" : "s"}`,
      content: { runs },
      arrayKeys: ["runs"],
      text:
        runs.length === 0
          ? "No running commands to stop."
          : runs.map((one) => `${one.command_id}: ${one.status}`).join("\n"),
    });
  },
});

const restartCmd = defineCommand({
  name: "command.restart",
  summary: "Restart a project command",
  description:
    "Stop a project command (if running) and start it again using its latest saved definition.",
  input: z.strictObject({
    command: z.string().min(1).max(120),
    project: z.string().min(1).optional(),
    wait: z.boolean().optional(),
  }),
  positional: ["command"],
  effect: "external",
  routes: [projectCommandsRestart, projectApi.list, projectApi.resolve],
  workspaces: ["project"],
  run: async (input, ctx) => {
    const project = await resolveProjectId(input.project, ctx);
    if (!project.ok) return project;
    const restarted = await ctx.core.read(projectCommandsRestart, {
      project: project.value,
      command: input.command,
      ...(input.wait === undefined ? {} : { wait: input.wait }),
      ...(ctx.caller === undefined ? {} : { tool_call: ctx.caller.tool_call }),
    });
    if (!restarted.ok) return restarted;
    const { run, tail } = restarted.value;
    const failed =
      run.status === "failed" || run.status === "timed_out"
        ? `${input.command} ${run.status}${run.exit_code !== null ? ` (exit ${run.exit_code})` : ""}`
        : undefined;
    return ok({
      summary: `${run.command_id} ${run.status}`,
      content: { run, ...(tail === undefined ? {} : { tail }) },
      text:
        tail !== undefined && tail !== ""
          ? `${run.command_id}: ${formatRunStatus(run)}\n\n${tail}`
          : `${run.command_id}: ${formatRunStatus(run)}`,
      ...(failed === undefined ? {} : { failed }),
    });
  },
});

const logsCmd = defineCommand({
  name: "command.logs",
  summary: "Read recent output logs of a project command",
  description:
    "Read the live ring buffer of a running project command or the retained tail (up to 200 lines / 32 KiB) of its last finished run. Env values and known secrets are masked.",
  input: z.strictObject({
    command: z.string().min(1).max(120),
    lines: z.coerce.number().int().min(1).max(1000).optional(),
    project: z.string().min(1).optional(),
  }),
  positional: ["command"],
  effect: "read",
  routes: [projectCommandsLogs, projectApi.list, projectApi.resolve],
  workspaces: ["project"],
  run: async (input, ctx) => {
    const project = await resolveProjectId(input.project, ctx);
    if (!project.ok) return project;
    const read = await ctx.core.read(projectCommandsLogs, {
      project: project.value,
      command: input.command,
      ...(input.lines === undefined ? {} : { lines: input.lines }),
    });
    if (!read.ok) return read;
    const { run, lines, truncated } = read.value;
    return ok({
      summary:
        run === null
          ? "no run yet"
          : `${lines.length} lines (${formatRunStatus(run)})`,
      content: { run, lines, truncated },
      arrayKeys: ["lines"],
      text:
        lines.length === 0
          ? run === null
            ? "Command has not run yet."
            : "(no output)"
          : lines.join("\n"),
    });
  },
});

const detectCmd = defineCommand({
  name: "command.detect",
  summary: "Detect candidate commands from the project folder",
  description:
    "Scan the project's registered folders (read-only) for package.json scripts, Makefile targets, justfile recipes, and other tool configs. Nothing is registered automatically.",
  input: z.strictObject({
    project: z.string().min(1).optional(),
  }),
  effect: "read",
  routes: [projectCommandsDetect, projectApi.list, projectApi.resolve],
  workspaces: ["project"],
  run: async (input, ctx) => {
    const project = await resolveProjectId(input.project, ctx);
    if (!project.ok) return project;
    const detected = await ctx.core.read(projectCommandsDetect, {
      project: project.value,
    });
    if (!detected.ok) return detected;
    const { candidates, unsupported_notes } = detected.value;
    const lines = [
      ...candidates.map(
        (c) =>
          `${c.id}  [${c.kind}]  ${c.name}: ${c.command}  (${c.source}${c.already_registered ? ", registered" : ""})`,
      ),
      ...(unsupported_notes.length > 0
        ? ["", "Notes:", ...unsupported_notes.map((n) => `  - ${n}`)]
        : []),
    ];
    return ok({
      summary: `${candidates.length} candidates`,
      content: detected.value,
      arrayKeys: ["candidates"],
      text:
        lines.length === 0 ? "No candidate commands found." : lines.join("\n"),
    });
  },
});

const addCmd = defineCommand({
  name: "command.add",
  summary: "Add a project command definition",
  description:
    "Add a new project command. When called by an agent while write approval is enabled on the project, shows the person an approval card with the command text before saving.",
  input: z.strictObject({
    name: projectCommandNameSchema,
    command: projectCommandScriptSchema,
    id: projectCommandIdSchema.optional(),
    kind: commandKindSchema.optional(),
    description: z.string().trim().max(200).optional(),
    folder_ref: z.string().min(1).max(80).optional(),
    cwd: projectCommandCwdSchema.optional(),
    env: z.string().optional(),
    preview_url: projectCommandPreviewUrlSchema.optional(),
    auto_open_preview: z.boolean().optional(),
    timeout_ms: z.coerce.number().pipe(projectCommandTimeoutSchema).optional(),
    project: z.string().min(1).optional(),
  }),
  positional: ["name", "command"],
  effect: "write",
  routes: [projectCommandsAdd, projectApi.list, projectApi.resolve],
  workspaces: ["project"],
  run: async (input, ctx) => {
    const project = await resolveProjectId(input.project, ctx);
    if (!project.ok) return project;
    const env = parseEnvJson(input.env);
    if (!env.ok) return env;
    const done = await ctx.core.read(projectCommandsAdd, {
      project: project.value,
      ...(ctx.caller === undefined ? {} : { tool_call: ctx.caller.tool_call }),
      command: {
        ...(input.id === undefined ? {} : { id: input.id }),
        name: input.name,
        command: input.command,
        kind: input.kind ?? "action",
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(input.folder_ref === undefined
          ? {}
          : { folder_ref: input.folder_ref }),
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        ...(env.value === undefined ? {} : { env: env.value }),
        ...(input.preview_url === undefined
          ? {}
          : { preview_url: input.preview_url }),
        ...(input.auto_open_preview === undefined
          ? {}
          : { auto_open_preview: input.auto_open_preview }),
        ...(input.timeout_ms === undefined
          ? {}
          : { timeout_ms: input.timeout_ms }),
      },
    });
    if (!done.ok) return done;
    const cmd = stripEnvForList(done.value.command);
    return ok({
      summary: `added ${done.value.command.id}`,
      content: { command: cmd },
      text: `Added ${done.value.command.id} (${done.value.command.name})`,
    });
  },
});

const updateCmd = defineCommand({
  name: "command.update",
  summary: "Update an existing project command definition",
  description:
    "Update fields of an existing project command by id. When called by an agent while write approval is enabled, shows the person before/after details before saving.",
  input: z.strictObject({
    id: projectCommandIdSchema,
    name: projectCommandNameSchema.optional(),
    command: projectCommandScriptSchema.optional(),
    kind: commandKindSchema.optional(),
    description: z.string().trim().max(200).optional(),
    folder_ref: z.string().min(1).max(80).optional(),
    cwd: projectCommandCwdSchema.optional(),
    env: z.string().optional(),
    preview_url: projectCommandPreviewUrlSchema.optional(),
    auto_open_preview: z.boolean().optional(),
    timeout_ms: z.coerce.number().pipe(projectCommandTimeoutSchema).optional(),
    project: z.string().min(1).optional(),
  }),
  positional: ["id"],
  effect: "write",
  routes: [projectCommandsUpdate, projectApi.list, projectApi.resolve],
  workspaces: ["project"],
  run: async (input, ctx) => {
    const project = await resolveProjectId(input.project, ctx);
    if (!project.ok) return project;
    const env = parseEnvJson(input.env);
    if (!env.ok) return env;
    const done = await ctx.core.read(projectCommandsUpdate, {
      project: project.value,
      id: input.id,
      ...(ctx.caller === undefined ? {} : { tool_call: ctx.caller.tool_call }),
      patch: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.command === undefined ? {} : { command: input.command }),
        ...(input.kind === undefined ? {} : { kind: input.kind }),
        ...(input.description === undefined
          ? {}
          : { description: input.description }),
        ...(input.folder_ref === undefined
          ? {}
          : { folder_ref: input.folder_ref }),
        ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
        ...(env.value === undefined ? {} : { env: env.value }),
        ...(input.preview_url === undefined
          ? {}
          : { preview_url: input.preview_url }),
        ...(input.auto_open_preview === undefined
          ? {}
          : { auto_open_preview: input.auto_open_preview }),
        ...(input.timeout_ms === undefined
          ? {}
          : { timeout_ms: input.timeout_ms }),
      },
    });
    if (!done.ok) return done;
    const cmd = stripEnvForList(done.value.command);
    return ok({
      summary: `updated ${done.value.command.id}`,
      content: { command: cmd },
      text: `Updated ${done.value.command.id} (${done.value.command.name})`,
    });
  },
});

const removeCmd = defineCommand({
  name: "command.remove",
  summary: "Remove a project command definition",
  description:
    "Remove a project command by id. If it is running, it is stopped first. When called by an agent while write approval is enabled, asks the person first.",
  input: z.strictObject({
    id: projectCommandIdSchema,
    project: z.string().min(1).optional(),
  }),
  positional: ["id"],
  effect: "write",
  routes: [projectCommandsRemove, projectApi.list, projectApi.resolve],
  workspaces: ["project"],
  run: async (input, ctx) => {
    const project = await resolveProjectId(input.project, ctx);
    if (!project.ok) return project;
    const done = await ctx.core.read(projectCommandsRemove, {
      project: project.value,
      id: input.id,
      ...(ctx.caller === undefined ? {} : { tool_call: ctx.caller.tool_call }),
    });
    if (!done.ok) return done;
    return ok({
      summary: `removed ${input.id}`,
      content: { id: input.id, removed: done.value.removed },
      text: `Removed ${input.id}`,
    });
  },
});

export const PROJECT_COMMAND_CLI_COMMANDS = [
  list,
  runCmd,
  stopCmd,
  restartCmd,
  logsCmd,
  detectCmd,
  addCmd,
  updateCmd,
  removeCmd,
];
