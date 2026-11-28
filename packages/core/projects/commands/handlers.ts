// `project_commands/*` route handler 모음.
// 검증, 사람/agent 권한·승인 게이트(`tool_gate/check`), 원격 기기 터미널 입력 허락,
// ledger 쓰기 위임과 `ProjectCommandsChanged` 발행을 맡는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  ToolGateInput,
  ToolGateResult,
} from "../../../protocol/approvals/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { AgentId } from "../../../protocol/lophn-agent/workspaces.ts";
import {
  PROJECT_COMMANDS_MAX,
  type ProjectCommand,
  type ProjectCommandInput,
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
} from "../../../protocol/projects/project-commands.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { MemoryHandler, ReadHandler } from "../../server/mod.ts";
import {
  type DetectFolder,
  type DetectFs,
  detectProjectCommands,
} from "./detect.ts";
import type { ProjectCommandRuntime } from "./runtime.ts";
import {
  findProjectCommand,
  resolveProjectCommandPolicy,
  sanitizeProjectCommand,
  slugifyCommandId,
} from "./store.ts";

export type AskPersonGate = (
  who: AuthenticatedContext,
  input: ToolGateInput,
) => Promise<Result<ToolGateResult>>;

export type ProjectCommandHandlersDeps = {
  load(project: string): Result<{
    commands: ProjectCommand[];
    settings: ProjectCommandSettings;
  }>;
  save(
    project: Id<"prj">,
    update: {
      commands?: ProjectCommand[];
      settings?: ProjectCommandSettings;
    },
  ): Promise<Result<void>>;
  folders(project: string): Promise<Result<readonly DetectFolder[]>>;
  detectFs: DetectFs;
  runtime: ProjectCommandRuntime;
  isDevice(principal: string): boolean;
  granted(principal: string): boolean;
  sessionAgent(session: string): Promise<Result<AgentId>>;
  askPerson?: AskPersonGate;
  onDefinitionsChanged(project: Id<"prj">): void;
};

function isAgent(who: AuthenticatedContext): boolean {
  return who.actor.startsWith("agent:");
}

function forbidden(message: string, reason?: string): Result<never> {
  return err({
    code: "forbidden",
    message,
    ...(reason === undefined ? {} : { details: { reason } }),
  });
}

function summaryOf(cmd: ProjectCommand) {
  return {
    id: cmd.id,
    name: cmd.name,
    command: cmd.command,
    cwd: cmd.cwd ?? null,
    env_keys: Object.keys(cmd.env ?? {}).sort(),
  };
}

function materialize(
  input: ProjectCommandInput,
  existingIds: ReadonlySet<string>,
  order: number,
): ProjectCommand {
  const id = input.id ?? slugifyCommandId(input.name, existingIds);
  const env =
    input.env !== undefined && Object.keys(input.env).length > 0
      ? input.env
      : undefined;
  return {
    id,
    name: input.name,
    command: input.command,
    kind: input.kind,
    ...(input.description === undefined || input.description === ""
      ? {}
      : { description: input.description }),
    ...(input.folder_ref === undefined ? {} : { folder_ref: input.folder_ref }),
    ...(input.cwd === undefined ? {} : { cwd: input.cwd }),
    ...(env === undefined ? {} : { env, env_keys: Object.keys(env).sort() }),
    ...(input.preview_url === undefined
      ? {}
      : { preview_url: input.preview_url }),
    ...(input.auto_open_preview === true ? { auto_open_preview: true } : {}),
    ...(input.timeout_ms === undefined ? {} : { timeout_ms: input.timeout_ms }),
    order,
    ...(input.agents === undefined ? {} : { agents: input.agents }),
    ...(input.ask_before_run === undefined
      ? {}
      : { ask_before_run: input.ask_before_run }),
  };
}

function sameSummary(
  a: ReturnType<typeof summaryOf> | null,
  b: ReturnType<typeof summaryOf> | null,
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function createProjectCommandHandlers(deps: ProjectCommandHandlersDeps) {
  const canRunFor = (who: AuthenticatedContext): boolean =>
    deps.isDevice(who.principal) ? deps.granted(who.principal) : true;

  function requireRemoteGrant(who: AuthenticatedContext): Result<void> {
    return canRunFor(who)
      ? ok(undefined)
      : forbidden(
          "this device does not have terminal input grant on this computer",
        );
  }

  function requireLocalUser(who: AuthenticatedContext): Result<void> {
    if (who.actor !== "user") {
      return forbidden("only the person may perform this action");
    }
    return ok(undefined);
  }

  async function checkAgentRun(
    who: AuthenticatedContext,
    project: Id<"prj">,
    cmd: ProjectCommand,
    commands: readonly ProjectCommand[],
    settings: ProjectCommandSettings,
    toolCall: string | undefined,
  ): Promise<Result<void>> {
    const session = who.conditions.session;
    const turn = who.conditions.turn;
    if (session === undefined) {
      return forbidden("agent session is missing");
    }
    const agent = await deps.sessionAgent(session);
    if (!agent.ok) return agent;
    const policy = resolveProjectCommandPolicy(
      commands,
      settings,
      cmd.id,
      agent.value,
    );
    if (!policy.allowed) {
      return forbidden(
        `this agent is not allowed to run project command "${cmd.name}"`,
        "not_assigned",
      );
    }
    if (!policy.askBeforeRun) return ok(undefined);
    if (
      deps.askPerson === undefined ||
      toolCall === undefined ||
      turn === undefined
    ) {
      return forbidden(
        "running this command requires approval; only a lophn agent turn can ask",
        "needs_approval",
      );
    }
    const asked = await deps.askPerson(who, {
      session,
      turn,
      tool_call: toolCall,
      tool: "lophn",
      call: {
        kind: "project_command",
        project,
        command_id: cmd.id,
        name: cmd.name,
        command: cmd.command,
        cwd: cmd.cwd ?? null,
        env_keys: Object.keys(cmd.env ?? {}).sort(),
      },
    });
    if (!asked.ok) return asked;
    const outcome = asked.value;
    if (outcome.kind === "run") return ok(undefined);
    if (outcome.kind === "rejected") {
      const whoRejected = outcome.by === "parent" ? "the parent" : "the person";
      return forbidden(
        outcome.reason === null
          ? `${whoRejected} rejected running "${cmd.name}"`
          : `${whoRejected} rejected running "${cmd.name}": ${outcome.reason}`,
        "needs_approval",
      );
    }
    if (outcome.kind === "denied") {
      return forbidden(
        outcome.denial.reason_kind === "unassigned"
          ? `this agent is not allowed to run project command "${cmd.name}"`
          : "the person must approve running this command; ask from an attended session",
        outcome.denial.reason_kind === "unassigned"
          ? "not_assigned"
          : "needs_approval",
      );
    }
    return forbidden(
      "the approval request ended before it was decided",
      "needs_approval",
    );
  }

  async function checkAgentDefinitionWrite(
    who: AuthenticatedContext,
    project: Id<"prj">,
    settings: ProjectCommandSettings,
    action: "add" | "update" | "remove",
    before: ProjectCommand | null,
    after: ProjectCommand | null,
    toolCall: string | undefined,
  ): Promise<Result<void>> {
    if (!settings.approve_agent_writes) return ok(undefined);
    const session = who.conditions.session;
    const turn = who.conditions.turn;
    if (
      deps.askPerson === undefined ||
      toolCall === undefined ||
      session === undefined ||
      turn === undefined
    ) {
      return forbidden(
        "changing project commands requires approval; only a lophn agent turn can ask",
        "needs_approval",
      );
    }
    const asked = await deps.askPerson(who, {
      session,
      turn,
      tool_call: toolCall,
      tool: "lophn",
      call: {
        kind: "project_command_definition",
        project,
        action,
        before: before === null ? null : summaryOf(before),
        after: after === null ? null : summaryOf(after),
      },
    });
    if (!asked.ok) return asked;
    const outcome = asked.value;
    if (outcome.kind === "run") return ok(undefined);
    if (outcome.kind === "rejected") {
      return forbidden(
        outcome.reason === null
          ? "the person rejected this command change"
          : `the person rejected this command change: ${outcome.reason}`,
        "needs_approval",
      );
    }
    if (outcome.kind === "denied") {
      return forbidden(
        "the person must approve changing project commands; ask from an attended session",
        "needs_approval",
      );
    }
    return forbidden(
      "the approval request ended before it was decided",
      "needs_approval",
    );
  }

  const list: ReadHandler = (who, raw) => {
    const parsed = projectCommandsList.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid list input" });
    }
    const loaded = deps.load(parsed.data.project);
    if (!loaded.ok) return loaded;
    const includeEnv =
      parsed.data.include_env === true &&
      who.actor === "user" &&
      !deps.isDevice(who.principal);
    return ok({
      commands: loaded.value.commands.map((cmd) =>
        sanitizeProjectCommand(cmd, includeEnv),
      ),
      runs: deps.runtime.listRuns(parsed.data.project),
      settings: loaded.value.settings,
      can_run: canRunFor(who),
    });
  };

  const detect: ReadHandler = async (_who, raw) => {
    const parsed = projectCommandsDetect.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid detect input" });
    }
    const loaded = deps.load(parsed.data.project);
    if (!loaded.ok) return loaded;
    const folders = await deps.folders(parsed.data.project);
    if (!folders.ok) return folders;
    const found = await detectProjectCommands({
      fs: deps.detectFs,
      folders: folders.value,
      existing: loaded.value.commands,
    });
    return ok(found);
  };

  const logs: ReadHandler = (who, raw) => {
    const parsed = projectCommandsLogs.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid logs input" });
    }
    const grant = requireRemoteGrant(who);
    if (!grant.ok) return grant;
    const loaded = deps.load(parsed.data.project);
    if (!loaded.ok) return loaded;
    const cmd = findProjectCommand(loaded.value.commands, parsed.data.command);
    if (cmd === undefined) {
      return err({ code: "not_found", message: "project command not found" });
    }
    return ok(
      deps.runtime.logs(parsed.data.project, cmd.id, {
        lines: parsed.data.lines,
        redact: isAgent(who),
      }),
    );
  };

  const add: MemoryHandler = async (who, raw) => {
    const parsed = projectCommandsAdd.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "invalid command input",
      });
    }
    const { project: rawProject, command: input, tool_call } = parsed.data;
    const project = rawProject as Id<"prj">;
    if (
      isAgent(who) &&
      (input.agents !== undefined || input.ask_before_run !== undefined)
    ) {
      return forbidden("only the person may change agent access settings");
    }
    const loaded = deps.load(project);
    if (!loaded.ok) return loaded;
    const { commands, settings } = loaded.value;
    if (commands.length >= PROJECT_COMMANDS_MAX) {
      return err({
        code: "conflict",
        message: `at most ${PROJECT_COMMANDS_MAX} commands per project`,
      });
    }
    const existingIds = new Set(commands.map((one) => one.id));
    if (input.id !== undefined && existingIds.has(input.id)) {
      return err({
        code: "conflict",
        message: `command id "${input.id}" already exists`,
      });
    }
    const created = materialize(input, existingIds, commands.length);

    if (isAgent(who)) {
      const gate = await checkAgentDefinitionWrite(
        who,
        project,
        settings,
        "add",
        null,
        created,
        tool_call,
      );
      if (!gate.ok) return gate;
      // 기다리는 사이 정의가 바뀌었는지 확인한다(기술 결정 9).
      const afterWait = deps.load(project);
      if (!afterWait.ok) return afterWait;
      if (
        afterWait.value.commands.some((one) => one.id === created.id) ||
        afterWait.value.commands.length >= PROJECT_COMMANDS_MAX
      ) {
        return err({
          code: "conflict",
          message:
            "project commands changed while waiting for approval; ask again",
        });
      }
      const saved = await deps.save(project, {
        commands: [...afterWait.value.commands, created],
      });
      if (!saved.ok) return saved;
      deps.onDefinitionsChanged(project);
      return ok({ command: sanitizeProjectCommand(created, false) });
    }

    const saved = await deps.save(project, {
      commands: [...commands, created],
    });
    if (!saved.ok) return saved;
    deps.onDefinitionsChanged(project);
    return ok({
      command: sanitizeProjectCommand(created, !deps.isDevice(who.principal)),
    });
  };

  const update: MemoryHandler = async (who, raw) => {
    const parsed = projectCommandsUpdate.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "invalid update input",
      });
    }
    const { project: rawProject, id, patch, tool_call } = parsed.data;
    const project = rawProject as Id<"prj">;
    if (
      isAgent(who) &&
      (patch.agents !== undefined || patch.ask_before_run !== undefined)
    ) {
      return forbidden("only the person may change agent access settings");
    }
    const loaded = deps.load(project);
    if (!loaded.ok) return loaded;
    const { commands, settings } = loaded.value;
    const index = commands.findIndex((one) => one.id === id);
    if (index < 0) {
      return err({ code: "not_found", message: "project command not found" });
    }
    const before = commands[index]!;
    const applyPatch = (base: ProjectCommand): ProjectCommand => {
      const nextEnv =
        patch.env === undefined
          ? base.env
          : patch.env === null || Object.keys(patch.env).length === 0
            ? undefined
            : patch.env;
      const next: ProjectCommand = {
        id: base.id,
        name: patch.name ?? base.name,
        command: patch.command ?? base.command,
        kind: patch.kind ?? base.kind,
        order: base.order,
        ...((patch.description === undefined
          ? base.description
          : patch.description) != null &&
        (patch.description === undefined
          ? base.description
          : patch.description) !== ""
          ? {
              description: (patch.description === undefined
                ? base.description
                : patch.description)!,
            }
          : {}),
        ...((patch.folder_ref === undefined
          ? base.folder_ref
          : patch.folder_ref) != null
          ? {
              folder_ref: (patch.folder_ref === undefined
                ? base.folder_ref
                : patch.folder_ref)!,
            }
          : {}),
        ...((patch.cwd === undefined ? base.cwd : patch.cwd) != null
          ? { cwd: (patch.cwd === undefined ? base.cwd : patch.cwd)! }
          : {}),
        ...(nextEnv !== undefined
          ? { env: nextEnv, env_keys: Object.keys(nextEnv).sort() }
          : {}),
        ...((patch.preview_url === undefined
          ? base.preview_url
          : patch.preview_url) != null
          ? {
              preview_url: (patch.preview_url === undefined
                ? base.preview_url
                : patch.preview_url)!,
            }
          : {}),
        ...((patch.auto_open_preview === undefined
          ? base.auto_open_preview
          : patch.auto_open_preview) === true
          ? { auto_open_preview: true }
          : {}),
        ...((patch.timeout_ms === undefined
          ? base.timeout_ms
          : patch.timeout_ms) != null
          ? {
              timeout_ms: (patch.timeout_ms === undefined
                ? base.timeout_ms
                : patch.timeout_ms)!,
            }
          : {}),
        ...((patch.agents === undefined ? base.agents : patch.agents) != null
          ? {
              agents: (patch.agents === undefined
                ? base.agents
                : patch.agents)!,
            }
          : {}),
        ...((patch.ask_before_run === undefined
          ? base.ask_before_run
          : patch.ask_before_run) != null
          ? {
              ask_before_run: (patch.ask_before_run === undefined
                ? base.ask_before_run
                : patch.ask_before_run)!,
            }
          : {}),
      };
      return next;
    };
    const updated = applyPatch(before);

    if (isAgent(who)) {
      const beforeSummary = summaryOf(before);
      const gate = await checkAgentDefinitionWrite(
        who,
        project,
        settings,
        "update",
        before,
        updated,
        tool_call,
      );
      if (!gate.ok) return gate;
      const afterWait = deps.load(project);
      if (!afterWait.ok) return afterWait;
      const currentIndex = afterWait.value.commands.findIndex(
        (one) => one.id === id,
      );
      if (
        currentIndex < 0 ||
        !sameSummary(
          summaryOf(afterWait.value.commands[currentIndex]!),
          beforeSummary,
        )
      ) {
        return err({
          code: "conflict",
          message:
            "project command changed while waiting for approval; ask again",
        });
      }
      const nextList = afterWait.value.commands.map((one, at) =>
        at === currentIndex ? updated : one,
      );
      const saved = await deps.save(project, { commands: nextList });
      if (!saved.ok) return saved;
      deps.onDefinitionsChanged(project);
      return ok({ command: sanitizeProjectCommand(updated, false) });
    }

    const nextList = commands.map((one, at) => (at === index ? updated : one));
    const saved = await deps.save(project, { commands: nextList });
    if (!saved.ok) return saved;
    deps.onDefinitionsChanged(project);
    return ok({
      command: sanitizeProjectCommand(updated, !deps.isDevice(who.principal)),
    });
  };

  const remove: MemoryHandler = async (who, raw) => {
    const parsed = projectCommandsRemove.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid remove input" });
    }
    const { project: rawProject, id, tool_call } = parsed.data;
    const project = rawProject as Id<"prj">;
    const loaded = deps.load(project);
    if (!loaded.ok) return loaded;
    const { commands, settings } = loaded.value;
    const target = commands.find((one) => one.id === id);
    if (target === undefined) {
      return err({ code: "not_found", message: "project command not found" });
    }

    if (isAgent(who)) {
      const beforeSummary = summaryOf(target);
      const gate = await checkAgentDefinitionWrite(
        who,
        project,
        settings,
        "remove",
        target,
        null,
        tool_call,
      );
      if (!gate.ok) return gate;
      const afterWait = deps.load(project);
      if (!afterWait.ok) return afterWait;
      const current = afterWait.value.commands.find((one) => one.id === id);
      if (
        current === undefined ||
        !sameSummary(summaryOf(current), beforeSummary)
      ) {
        return err({
          code: "conflict",
          message:
            "project command changed while waiting for approval; ask again",
        });
      }
      const nextList = afterWait.value.commands.filter((one) => one.id !== id);
      const saved = await deps.save(project, { commands: nextList });
      if (!saved.ok) return saved;
      await deps.runtime.forgetCommand(project, id);
      deps.onDefinitionsChanged(project);
      return ok({ removed: true });
    }

    const nextList = commands.filter((one) => one.id !== id);
    const saved = await deps.save(project, { commands: nextList });
    if (!saved.ok) return saved;
    await deps.runtime.forgetCommand(project, id);
    deps.onDefinitionsChanged(project);
    return ok({ removed: true });
  };

  const reorder: MemoryHandler = async (who, raw) => {
    const user = requireLocalUser(who);
    if (!user.ok) return user;
    const parsed = projectCommandsReorder.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid reorder input" });
    }
    const { project: rawProject, ids } = parsed.data;
    const project = rawProject as Id<"prj">;
    const loaded = deps.load(project);
    if (!loaded.ok) return loaded;
    const byId = new Map(loaded.value.commands.map((one) => [one.id, one]));
    const reordered: ProjectCommand[] = [];
    const seen = new Set<string>();
    for (const id of ids) {
      const item = byId.get(id);
      if (item === undefined || seen.has(id)) continue;
      seen.add(id);
      reordered.push({ ...item, order: reordered.length });
    }
    for (const item of loaded.value.commands) {
      if (!seen.has(item.id)) {
        reordered.push({ ...item, order: reordered.length });
      }
    }
    const saved = await deps.save(project, { commands: reordered });
    if (!saved.ok) return saved;
    deps.onDefinitionsChanged(project);
    return ok({
      commands: reordered.map((one) =>
        sanitizeProjectCommand(one, !deps.isDevice(who.principal)),
      ),
    });
  };

  const importCommands: MemoryHandler = async (who, raw) => {
    const user = requireLocalUser(who);
    if (!user.ok) return user;
    const parsed = projectCommandsImport.input.safeParse(raw);
    if (!parsed.success) {
      return err({
        code: "invalid_input",
        message: parsed.error.issues[0]?.message ?? "invalid import input",
      });
    }
    const { project: rawProject, commands: incoming } = parsed.data;
    const project = rawProject as Id<"prj">;
    const loaded = deps.load(project);
    if (!loaded.ok) return loaded;
    const existing = [...loaded.value.commands];
    const existingIds = new Set(existing.map((one) => one.id));
    const added: ProjectCommand[] = [];
    const skipped: string[] = [];

    for (const item of incoming) {
      if (item.id !== undefined && existingIds.has(item.id)) {
        skipped.push(item.id);
        continue;
      }
      if (existing.length + added.length >= PROJECT_COMMANDS_MAX) {
        skipped.push(item.id ?? item.name);
        continue;
      }
      const created = materialize(
        item,
        existingIds,
        existing.length + added.length,
      );
      existingIds.add(created.id);
      added.push(created);
    }

    if (added.length > 0) {
      const saved = await deps.save(project, {
        commands: [...existing, ...added],
      });
      if (!saved.ok) return saved;
      deps.onDefinitionsChanged(project);
    }

    return ok({
      added: added.map((one) =>
        sanitizeProjectCommand(one, !deps.isDevice(who.principal)),
      ),
      skipped,
    });
  };

  const setSettings: MemoryHandler = async (who, raw) => {
    const user = requireLocalUser(who);
    if (!user.ok) return user;
    const parsed = projectCommandsSetSettings.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid settings input" });
    }
    const { project: rawProject, settings } = parsed.data;
    const project = rawProject as Id<"prj">;
    const loaded = deps.load(project);
    if (!loaded.ok) return loaded;
    const saved = await deps.save(project, { settings });
    if (!saved.ok) return saved;
    deps.onDefinitionsChanged(project);
    return ok({ settings });
  };

  const run: MemoryHandler = async (who, raw) => {
    const parsed = projectCommandsRun.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid run input" });
    }
    const grant = requireRemoteGrant(who);
    if (!grant.ok) return grant;
    const {
      project: rawProject,
      command: idOrName,
      worktree_id: worktreeId,
      wait,
      tool_call,
    } = parsed.data;
    const project = rawProject as Id<"prj">;
    const loaded = deps.load(project);
    if (!loaded.ok) return loaded;
    let cmd = findProjectCommand(loaded.value.commands, idOrName);
    if (cmd === undefined) {
      return err({ code: "not_found", message: "project command not found" });
    }
    if (isAgent(who)) {
      const gate = await checkAgentRun(
        who,
        project,
        cmd,
        loaded.value.commands,
        loaded.value.settings,
        tool_call,
      );
      if (!gate.ok) return gate;
      // 승인 대기 중 정의가 바뀌었는지 확인한다.
      const reloaded = deps.load(project);
      if (!reloaded.ok) return reloaded;
      const latest = reloaded.value.commands.find((one) => one.id === cmd!.id);
      if (
        latest === undefined ||
        !sameSummary(summaryOf(latest), summaryOf(cmd))
      ) {
        return err({
          code: "conflict",
          message:
            "project command changed while waiting for approval; ask again",
        });
      }
      cmd = latest;
    }
    return await deps.runtime.start(project, cmd, {
      wait,
      redactLogs: isAgent(who),
      ...(worktreeId === undefined ? {} : { worktreeId: worktreeId as Id<"wkt"> }),
    });
  };

  const stop: MemoryHandler = async (who, raw) => {
    const parsed = projectCommandsStop.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid stop input" });
    }
    const grant = requireRemoteGrant(who);
    if (!grant.ok) return grant;
    const {
      project: rawProject,
      command: idOrName,
      all,
      dismiss,
    } = parsed.data;
    const project = rawProject as Id<"prj">;
    const loaded = deps.load(project);
    if (!loaded.ok) return loaded;
    const by: "user" | "agent" = isAgent(who) ? "agent" : "user";
    const stopOptions = dismiss === true ? { dismiss: true } : undefined;

    if (all === true) {
      if (isAgent(who)) {
        const session = who.conditions.session;
        if (session === undefined) return forbidden("agent session is missing");
        const agent = await deps.sessionAgent(session);
        if (!agent.ok) return agent;
        // agent가 stop --all을 부르면 자신이 쓸 수 있는 명령만 멈춘다.
        const allowed = loaded.value.commands.filter(
          (cmd) =>
            resolveProjectCommandPolicy(
              loaded.value.commands,
              loaded.value.settings,
              cmd.id,
              agent.value,
            ).allowed,
        );
        const stopped = await Promise.all(
          allowed.map(async (cmd) => {
            const done = await deps.runtime.stop(
              project,
              cmd.id,
              by,
              stopOptions,
            );
            return done.ok ? done.value : null;
          }),
        );
        return ok({
          runs: stopped.filter(
            (one): one is NonNullable<typeof one> => one !== null,
          ),
        });
      }
      const runs = await deps.runtime.stopAll(project, by, stopOptions);
      return ok({ runs });
    }

    const cmd = findProjectCommand(loaded.value.commands, idOrName!);
    if (cmd === undefined) {
      return err({ code: "not_found", message: "project command not found" });
    }
    if (isAgent(who)) {
      const session = who.conditions.session;
      if (session === undefined) return forbidden("agent session is missing");
      const agent = await deps.sessionAgent(session);
      if (!agent.ok) return agent;
      const policy = resolveProjectCommandPolicy(
        loaded.value.commands,
        loaded.value.settings,
        cmd.id,
        agent.value,
      );
      if (!policy.allowed) {
        return forbidden(
          `this agent is not allowed to stop project command "${cmd.name}"`,
          "not_assigned",
        );
      }
    }
    const stopped = await deps.runtime.stop(project, cmd.id, by, stopOptions);
    if (!stopped.ok) return stopped;
    return ok({ runs: stopped.value === null ? [] : [stopped.value] });
  };

  const restart: MemoryHandler = async (who, raw) => {
    const parsed = projectCommandsRestart.input.safeParse(raw);
    if (!parsed.success) {
      return err({ code: "invalid_input", message: "invalid restart input" });
    }
    const grant = requireRemoteGrant(who);
    if (!grant.ok) return grant;
    const {
      project: rawProject,
      command: idOrName,
      worktree_id: worktreeId,
      wait,
      tool_call,
    } = parsed.data;
    const project = rawProject as Id<"prj">;
    const loaded = deps.load(project);
    if (!loaded.ok) return loaded;
    const cmd = findProjectCommand(loaded.value.commands, idOrName);
    if (cmd === undefined) {
      return err({ code: "not_found", message: "project command not found" });
    }
    const beforeSummary = summaryOf(cmd);
    if (isAgent(who)) {
      const gate = await checkAgentRun(
        who,
        project,
        cmd,
        loaded.value.commands,
        loaded.value.settings,
        tool_call,
      );
      if (!gate.ok) return gate;
    }
    const by: "user" | "agent" = isAgent(who) ? "agent" : "user";
    return await deps.runtime.restart(
      project,
      cmd.id,
      () => {
        const latest = deps.load(project);
        if (!latest.ok) return latest;
        const found = latest.value.commands.find((one) => one.id === cmd.id);
        if (found === undefined) {
          return err({
            code: "not_found",
            message: "project command not found",
          });
        }
        if (isAgent(who) && !sameSummary(summaryOf(found), beforeSummary)) {
          return err({
            code: "conflict",
            message:
              "project command changed while waiting for approval; ask again",
          });
        }
        return ok(found);
      },
      by,
      {
        wait,
        redactLogs: isAgent(who),
        ...(worktreeId === undefined
          ? {}
          : { worktreeId: worktreeId as Id<"wkt"> }),
      },
    );
  };

  return {
    list,
    detect,
    logs,
    add,
    update,
    remove,
    reorder,
    importCommands,
    setSettings,
    run,
    stop,
    restart,
  };
}
