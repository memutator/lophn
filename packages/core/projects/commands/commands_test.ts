import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { createIdSource, ok } from "../../../base/mod.ts";
import type { ToolGateInput } from "../../../protocol/approvals/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type {
  TerminalOutput,
  TerminalRuntime,
} from "../../../protocol/coding-agent/terminals.ts";
import {
  DEFAULT_PROJECT_COMMAND_SETTINGS,
  type ProjectCommand,
  type ProjectCommandRun,
  type ProjectCommandSettings,
} from "../../../protocol/projects/project-commands.ts";
import type { AuthenticatedContext, Tx } from "../../../protocol/server/mod.ts";
import { judge } from "../../approvals/gate/judge.ts";
import { createSql } from "../../storage/ledger/sqlite.ts";
import type { Terminals } from "../../terminals/ports.ts";
import { projectsSchemaSteps } from "../registry/schema.ts";
import {
  CommandLogBuffer,
  createProjectCommandHandlers,
  createProjectCommandRuntime,
  detectProjectCommands,
  extractLocalUrls,
  loadProjectCommands,
  PROJECT_COMMANDS_CONTEXT,
  PROJECT_COMMANDS_SCHEMA_STEPS,
  projectCommandsStoreCommand,
  RETAINED_LOG_MAX_BYTES,
  RETAINED_LOG_MAX_LINES,
} from "./mod.ts";

const PRJ = "prj_01h00000000000000000000001" as Id<"prj">;
const SES = "ses_01h00000000000000000000001" as Id<"ses">;
const TRN = "trn_01h00000000000000000000001" as Id<"trn">;
const TCL = "tcl_01h00000000000000000000001" as Id<"tcl">;
const AGT = "agt_01h00000000000000000000001" as Id<"agt">;

const EMPTY_SHELL = { floor: [], layers: [] };
const FAKE_RANDOM = {
  fill(bytes: Uint8Array) {
    bytes.fill(7);
  },
};

const userCtx: AuthenticatedContext = {
  principal: "user:local",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "cred_user",
};

const deviceCtx: AuthenticatedContext = {
  principal: "device:dev_remote",
  actor: "user",
  scope: { operations: [], targets: {} },
  conditions: { process: "remote" },
  credential_ref: "cred_device",
};

const agentCtx: AuthenticatedContext = {
  principal: `agent:${SES}`,
  actor: `agent:${SES}`,
  scope: { operations: [], targets: {} },
  conditions: { session: SES, turn: TRN },
  credential_ref: "cred_agent",
};

function fakeClock(startMs = 1_700_000_000_000) {
  let now = startMs;
  return {
    now: () => new Date(now).toISOString(),
    nowMs: () => now,
    advance(ms: number) {
      now += ms;
    },
  };
}

function fakeTerminals() {
  const runtimeListeners = new Set<(runtime: TerminalRuntime) => void>();
  const outputListeners = new Set<
    (chunks: readonly TerminalOutput[]) => void
  >();
  let nextRef = 1;
  const gens = new Map<string, number>();
  const opened: {
    terminal_ref: string;
    generation: number;
    exec?: string;
    env?: Readonly<Record<string, string>>;
    cwd?: string;
  }[] = [];
  const closed: { terminal: string; generation: number }[] = [];

  const terminals: Pick<
    Terminals,
    "open" | "close" | "patch" | "onRuntime" | "onOutput"
  > = {
    async open(input) {
      const ref = input.terminal_ref ?? `trm_${nextRef++}`;
      const gen = (gens.get(ref) ?? 0) + 1;
      gens.set(ref, gen);
      opened.push({
        terminal_ref: ref,
        generation: gen,
        exec: input.exec,
        env: input.env,
        cwd: input.cwd,
      });
      const runtime: TerminalRuntime = {
        terminal_ref: ref,
        project: input.project,
        folder_ref: input.folder_ref ?? `${input.project}_0`,
        cwd_at_start: input.cwd ?? "/tmp",
        program_path: "/bin/bash",
        state: "running",
        generation: gen,
        columns: 80,
        rows: 24,
        exit_code: null,
        exit_signal: null,
        failure_reason: null,
        output_seq: 0,
        dropped_output: false,
        shell_pid: 12345 + gen,
        dedicated: true,
      };
      return ok(runtime);
    },
    async close(terminal, generation) {
      closed.push({ terminal, generation });
      const runtime: TerminalRuntime = {
        terminal_ref: terminal,
        project: PRJ,
        folder_ref: `${PRJ}_0`,
        cwd_at_start: "/tmp",
        program_path: "/bin/bash",
        state: "exited",
        generation,
        columns: 80,
        rows: 24,
        exit_code: null,
        exit_signal: "SIGTERM",
        failure_reason: null,
        output_seq: 0,
        dropped_output: false,
        dedicated: true,
      };
      for (const listener of runtimeListeners) listener(runtime);
      return ok(runtime);
    },
    patch() {},
    onRuntime(listener) {
      runtimeListeners.add(listener);
      return () => runtimeListeners.delete(listener);
    },
    onOutput(listener) {
      outputListeners.add(listener);
      return () => outputListeners.delete(listener);
    },
  };

  return {
    terminals,
    opened,
    closed,
    emitOutput(terminalRef: string, generation: number, chunk: string) {
      for (const listener of outputListeners) {
        listener([
          {
            terminal_ref: terminalRef,
            generation,
            seq: 1,
            chunk,
            dropped_output: false,
          },
        ]);
      }
    },
    emitExit(
      terminalRef: string,
      generation: number,
      exitCode: number | null,
      exitSignal: string | null = null,
    ) {
      const runtime: TerminalRuntime = {
        terminal_ref: terminalRef,
        project: PRJ,
        folder_ref: `${PRJ}_0`,
        cwd_at_start: "/tmp",
        program_path: "/bin/bash",
        state: "exited",
        generation,
        columns: 80,
        rows: 24,
        exit_code: exitCode,
        exit_signal: exitSignal,
        failure_reason: null,
        output_seq: 1,
        dropped_output: false,
        dedicated: true,
      };
      for (const listener of runtimeListeners) listener(runtime);
    },
  };
}

test("judge enforces project_command and project_command_definition rules across modes", () => {
  const runCall = {
    kind: "project_command" as const,
    project: PRJ,
    command_id: "dev",
    name: "Dev",
    command: "npm run dev",
    cwd: null,
    env_keys: ["API_KEY"],
  };
  assert.deepEqual(
    judge(runCall, null, EMPTY_SHELL, "attended", false, {
      allowed: false,
      askBeforeRun: false,
      approveWrites: true,
    }),
    { kind: "deny", reason: "not_assigned", pattern: null },
  );
  assert.deepEqual(
    judge(runCall, null, EMPTY_SHELL, "unattended", false, {
      allowed: true,
      askBeforeRun: false,
      approveWrites: true,
    }),
    { kind: "run" },
  );
  assert.deepEqual(
    judge(runCall, null, EMPTY_SHELL, "attended", false, {
      allowed: true,
      askBeforeRun: true,
      approveWrites: true,
    }),
    { kind: "ask" },
  );
  assert.deepEqual(
    judge(runCall, null, EMPTY_SHELL, "skip", false, {
      allowed: true,
      askBeforeRun: true,
      approveWrites: true,
    }),
    { kind: "ask" },
  );
  assert.deepEqual(
    judge(runCall, null, EMPTY_SHELL, "unattended", false, {
      allowed: true,
      askBeforeRun: true,
      approveWrites: true,
    }),
    { kind: "deny", reason: "no_person", pattern: null },
  );
  assert.deepEqual(
    judge(runCall, null, EMPTY_SHELL, "unattended", true, {
      allowed: true,
      askBeforeRun: true,
      approveWrites: true,
    }),
    { kind: "ask" },
  );

  const defCall = {
    kind: "project_command_definition" as const,
    project: PRJ,
    action: "add" as const,
    before: null,
    after: {
      id: "build",
      name: "Build",
      command: "npm run build",
      cwd: null,
      env_keys: [],
    },
  };
  assert.deepEqual(
    judge(defCall, null, EMPTY_SHELL, "unattended", true, {
      allowed: true,
      askBeforeRun: false,
      approveWrites: false,
    }),
    { kind: "run" },
  );
  assert.deepEqual(
    judge(defCall, null, EMPTY_SHELL, "skip", false, {
      allowed: true,
      askBeforeRun: false,
      approveWrites: true,
    }),
    { kind: "ask" },
  );
  assert.deepEqual(
    judge(defCall, null, EMPTY_SHELL, "attended", true, {
      allowed: true,
      askBeforeRun: false,
      approveWrites: true,
    }),
    { kind: "deny", reason: "no_person", pattern: null },
  );
});

test("handlers enforce agent settings lock, write approval, secret masking, and remote grant boundary", async () => {
  const dir = mkdtempSync(join(tmpdir(), "lophn-pc-handlers-"));
  try {
    let commands: ProjectCommand[] = [
      {
        id: "dev",
        name: "Dev server",
        command: "npm run dev",
        kind: "service",
        env: { SECRET_TOKEN: "super-secret-value-123" },
        env_keys: ["SECRET_TOKEN"],
      },
    ];
    let settings: ProjectCommandSettings = {
      ...DEFAULT_PROJECT_COMMAND_SETTINGS,
    };
    let remoteGranted = false;
    const gateCalls: ToolGateInput[] = [];
    let gateReply: "run" | "rejected" = "run";

    const fakeTerm = fakeTerminals();
    const clock = fakeClock();
    const runtime = createProjectCommandRuntime({
      terminals: fakeTerm.terminals,
      folders: async () => ok([{ folder_ref: `${PRJ}_0`, path: dir }]),
      clock,
      ids: createIdSource({ clock, random: FAKE_RANDOM }),
      onRunChanged() {},
    });

    const handlers = createProjectCommandHandlers({
      load: () => ok({ commands, settings }),
      save: async (_project, update) => {
        if (update.commands !== undefined) commands = update.commands;
        if (update.settings !== undefined) settings = update.settings;
        return ok(undefined);
      },
      folders: async () => ok([{ folder_ref: `${PRJ}_0`, path: dir }]),
      detectFs: { readText: async () => null, exists: async () => false },
      runtime,
      isDevice: (principal) => principal.startsWith("device:"),
      granted: () => remoteGranted,
      sessionAgent: async () => ok(AGT),
      askPerson: async (_who, input) => {
        gateCalls.push(input);
        return gateReply === "run"
          ? ok({ kind: "run" as const })
          : ok({
              kind: "rejected" as const,
              reason: "nope",
              by: "person" as const,
            });
      },
      onDefinitionsChanged() {},
    });

    // 1. Env values are hidden from agent & remote devices, only visible to local user with include_env: true.
    const agentList = await handlers.list(agentCtx, {
      project: PRJ,
      include_env: true,
    });
    assert.ok(agentList.ok);
    const agentCmd = (agentList.value as { commands: ProjectCommand[] })
      .commands[0]!;
    assert.equal(agentCmd.env, undefined);
    assert.deepEqual(agentCmd.env_keys, ["SECRET_TOKEN"]);

    const remoteListBlocked = await handlers.list(deviceCtx, {
      project: PRJ,
      include_env: true,
    });
    assert.ok(remoteListBlocked.ok);
    assert.equal(
      (remoteListBlocked.value as { can_run: boolean }).can_run,
      false,
    );
    assert.equal(
      (remoteListBlocked.value as { commands: ProjectCommand[] }).commands[0]!
        .env,
      undefined,
    );

    // 2. Remote device without terminal-input grant cannot run/stop/restart/logs.
    const remoteRunBlocked = await handlers.run(deviceCtx, {
      project: PRJ,
      command: "dev",
    });
    assert.equal(remoteRunBlocked.ok, false);
    if (!remoteRunBlocked.ok)
      assert.equal(remoteRunBlocked.error.code, "forbidden");

    const remoteLogsBlocked = await handlers.logs(deviceCtx, {
      project: PRJ,
      command: "dev",
    });
    assert.equal(remoteLogsBlocked.ok, false);
    if (!remoteLogsBlocked.ok) {
      assert.equal(remoteLogsBlocked.error.code, "forbidden");
    }

    // With grant enabled, remote device can run and stop.
    remoteGranted = true;
    const remoteRunOk = await handlers.run(deviceCtx, {
      project: PRJ,
      command: "dev",
    });
    assert.ok(remoteRunOk.ok);
    fakeTerm.emitOutput(
      fakeTerm.opened[0]!.terminal_ref,
      fakeTerm.opened[0]!.generation,
      "token=super-secret-value-123\nlistening http://0.0.0.0:3000/\n",
    );
    const logsOut = await handlers.logs(agentCtx, {
      project: PRJ,
      command: "dev",
    });
    assert.ok(logsOut.ok);
    const logLines = (logsOut.value as { lines: string[] }).lines;
    assert.ok(!logLines.join("\n").includes("super-secret-value-123"));
    assert.ok(logLines.join("\n").includes("[REDACTED]"));

    const stopped = await handlers.stop(deviceCtx, {
      project: PRJ,
      command: "dev",
    });
    assert.ok(stopped.ok);

    // 3. Agent cannot modify agent access settings even if approve_agent_writes is off.
    settings = { ...settings, approve_agent_writes: false };
    const sneakAdd = await handlers.add(agentCtx, {
      project: PRJ,
      tool_call: TCL,
      command: {
        name: "Sneak",
        command: "echo hi",
        kind: "action",
        ask_before_run: false,
      },
    });
    assert.equal(sneakAdd.ok, false);
    if (!sneakAdd.ok) assert.equal(sneakAdd.error.code, "forbidden");

    // 4. Agent write approval asks with project_command_definition (env keys only, no values).
    settings = { ...settings, approve_agent_writes: true };
    gateReply = "rejected";
    const rejectedAdd = await handlers.add(agentCtx, {
      project: PRJ,
      tool_call: TCL,
      command: {
        name: "Build",
        command: "npm run build",
        kind: "action",
        env: { MY_SECRET: "hidden-val" },
      },
    });
    assert.equal(rejectedAdd.ok, false);
    assert.equal(gateCalls.length, 1);
    assert.equal(gateCalls[0]!.call.kind, "project_command_definition");
    if (gateCalls[0]!.call.kind === "project_command_definition") {
      assert.deepEqual(gateCalls[0]!.call.after?.env_keys, ["MY_SECRET"]);
      assert.ok(!JSON.stringify(gateCalls[0]!.call).includes("hidden-val"));
    }

    // 5. Only local user can set_settings.
    const agentSetSettings = await handlers.setSettings(agentCtx, {
      project: PRJ,
      settings: { ...settings, approve_agent_writes: false },
    });
    assert.equal(agentSetSettings.ok, false);
    if (!agentSetSettings.ok) {
      assert.equal(agentSetSettings.error.code, "forbidden");
    }
    const userSetSettings = await handlers.setSettings(userCtx, {
      project: PRJ,
      settings: { ...settings, approve_agent_writes: false },
    });
    assert.ok(userSetSettings.ok);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runtime blocks symlink cwd escape, tracks state machine, URL detection, log tail, and shutdown", async () => {
  const root = mkdtempSync(join(tmpdir(), "lophn-pc-runtime-"));
  const outside = mkdtempSync(join(tmpdir(), "lophn-pc-outside-"));
  try {
    mkdirSync(join(root, "sub"));
    symlinkSync(outside, join(root, "escape"));

    const events: ProjectCommandRun[] = [];
    const previews: string[] = [];
    const fakeTerm = fakeTerminals();
    const clock = fakeClock();
    const runtime = createProjectCommandRuntime({
      terminals: fakeTerm.terminals,
      folders: async () => ok([{ folder_ref: `${PRJ}_0`, path: root }]),
      clock,
      ids: createIdSource({ clock, random: FAKE_RANDOM }),
      onRunChanged: (_project, run) => events.push(run),
      openPreview: (_project, url) => previews.push(url),
    });

    // Symlink escaping outside registered folder is rejected at execution time.
    const escaped = await runtime.start(PRJ, {
      id: "esc",
      name: "Escape",
      command: "pwd",
      kind: "action",
      cwd: "escape",
    });
    assert.equal(escaped.ok, false);
    if (!escaped.ok) assert.equal(escaped.error.code, "invalid_input");

    // Start service, detect URL (with ANSI + 0.0.0.0 normalization), auto-open preview, reject duplicate with conflict.
    const svc: ProjectCommand = {
      id: "web",
      name: "Web",
      command: "npm run dev",
      kind: "service",
      auto_open_preview: true,
    };
    const started = await runtime.start(PRJ, svc);
    assert.ok(started.ok);
    assert.equal(started.value.run.status, "running");

    const dup = await runtime.start(PRJ, svc);
    assert.equal(dup.ok, false);
    if (!dup.ok) assert.equal(dup.error.code, "conflict");

    const ref = fakeTerm.opened[0]!.terminal_ref;
    const gen = fakeTerm.opened[0]!.generation;
    fakeTerm.emitOutput(
      ref,
      gen,
      "\x1b[32mLocal:\x1b[0m http://0.0.0.0:5173/\n",
    );
    assert.deepEqual(previews, ["http://localhost:5173"]);
    assert.deepEqual(runtime.getRun(PRJ, "web")?.detected_urls, [
      "http://localhost:5173",
    ]);

    // Shutdown stops running commands with ended_by: "shutdown" and status "stopped".
    await runtime.shutdown();
    const afterShutdown = runtime.getRun(PRJ, "web");
    assert.equal(afterShutdown?.status, "stopped");
    assert.equal(afterShutdown?.ended_by, "shutdown");
    assert.ok(events.length > 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test("stop with dismiss clears failed state and stops+clears running command", async () => {
  const root = mkdtempSync(join(tmpdir(), "lophn-pc-dismiss-"));
  try {
    const events: ProjectCommandRun[] = [];
    const fakeTerm = fakeTerminals();
    const clock = fakeClock();
    const runtime = createProjectCommandRuntime({
      terminals: fakeTerm.terminals,
      folders: async () => ok([{ folder_ref: `${PRJ}_0`, path: root }]),
      clock,
      ids: createIdSource({ clock, random: FAKE_RANDOM }),
      onRunChanged: (_project, run) => events.push(run),
    });

    const act: ProjectCommand = {
      id: "build",
      name: "Build",
      command: "npm run build",
      kind: "action",
    };
    const started = await runtime.start(PRJ, act);
    assert.ok(started.ok);
    const ref1 = fakeTerm.opened[0]!.terminal_ref;
    const gen1 = fakeTerm.opened[0]!.generation;
    fakeTerm.emitExit(ref1, gen1, 1);
    assert.equal(runtime.getRun(PRJ, "build")?.status, "failed");

    // Dismissing a failed run emits idle (terminal_id: null) and removes it from runtime entries.
    const dismissedFailed = await runtime.stop(PRJ, "build", "user", {
      dismiss: true,
    });
    assert.ok(dismissedFailed.ok);
    assert.equal(dismissedFailed.value?.status, "idle");
    assert.equal(dismissedFailed.value?.terminal_id, null);
    assert.equal(runtime.getRun(PRJ, "build"), null);
    assert.equal(events.at(-1)?.status, "idle");

    // Dismissing a running command stops the PTY first and clears state.
    const started2 = await runtime.start(PRJ, act);
    assert.ok(started2.ok);
    const closedBefore = fakeTerm.closed.length;
    const dismissedRunning = await runtime.stop(PRJ, "build", "user", {
      dismiss: true,
    });
    assert.ok(dismissedRunning.ok);
    assert.equal(fakeTerm.closed.length, closedBefore + 1);
    assert.equal(dismissedRunning.value?.status, "idle");
    assert.equal(runtime.getRun(PRJ, "build"), null);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("log buffer retains at most 200 lines / 32 KiB after exit and URL detection strips ANSI", () => {
  const buf = new CommandLogBuffer();
  for (let i = 1; i <= 350; i += 1) {
    buf.push(`\x1b[36mline ${i}\x1b[0m\n`);
  }
  assert.equal(buf.read().lines.length, 350);
  buf.compactToTail();
  const tail = buf.read();
  assert.equal(tail.lines.length, RETAINED_LOG_MAX_LINES);
  assert.equal(tail.lines[0], "line 151");
  assert.equal(tail.lines.at(-1), "line 350");
  assert.equal(tail.truncated, true);
  assert.ok(
    Buffer.byteLength(tail.lines.join("\n"), "utf8") <= RETAINED_LOG_MAX_BYTES,
  );

  assert.deepEqual(
    extractLocalUrls(
      "\x1b[1mReady at http://0.0.0.0:4000/ and https://127.0.0.1:8443/app\x1b[0m",
      [],
    ),
    ["http://localhost:4000", "https://127.0.0.1:8443/app"],
  );
});

test("detectProjectCommands discovers package.json, Makefile, justfile, and tool configs with notes", async () => {
  const files = new Map<string, string>([
    [
      "/repo/package.json",
      JSON.stringify({
        scripts: { dev: "vite", test: "vitest", build: "tsc" },
      }),
    ],
    ["/repo/pnpm-lock.yaml", "lockfileVersion: '9.0'"],
    ["/repo/Makefile", ".PHONY: clean\nclean:\n\trm -rf dist\n"],
    ["/repo/justfile", "deploy:\n  echo deploy\n"],
    [
      "/repo/.claude/launch.json",
      JSON.stringify({
        configurations: [
          {
            name: "API",
            runtimeExecutable: "node",
            runtimeArgs: ["server.js"],
            port: 8080,
            autoPort: true,
          },
        ],
      }),
    ],
    [
      "/repo/.emdash.json",
      JSON.stringify({
        scripts: { setup: "npm ci", lint: "eslint ." },
      }),
    ],
  ]);

  const result = await detectProjectCommands({
    fs: {
      readText: async (path) => files.get(path) ?? null,
      exists: async (path) => files.has(path),
    },
    folders: [{ folder_ref: `${PRJ}_0`, path: "/repo" }],
    existing: [
      {
        id: "dev",
        name: "dev",
        command: "pnpm run dev",
        kind: "service",
      },
    ],
  });

  const dev = result.candidates.find((c) => c.name === "dev");
  assert.equal(dev?.kind, "service");
  assert.equal(dev?.command, "pnpm run dev");
  assert.equal(dev?.already_registered, true);

  const api = result.candidates.find((c) => c.name === "API");
  assert.equal(api?.preview_url, "http://localhost:8080");
  assert.equal(api?.kind, "service");

  assert.ok(result.candidates.some((c) => c.command === "make clean"));
  assert.ok(result.candidates.some((c) => c.command === "just deploy"));
  assert.ok(result.unsupported_notes.some((n) => n.includes("autoPort")));
  assert.ok(result.unsupported_notes.some((n) => n.includes("setup")));
});

// createSql은 INTEGER를 bigint로 돌려준다. position/timeout_ms/boolean 플래그가
// bigint로 와도 명령과 설정이 누락되거나 false로 꺾이지 않아야 한다.
test("store round-trips commands and settings through ledger createSql (bigint INTEGER columns)", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of [
      ...projectsSchemaSteps,
      ...PROJECT_COMMANDS_SCHEMA_STEPS,
    ]) {
      db.exec(step.sql);
    }
    const sql = createSql(db, () => true);
    sql.run(
      `INSERT INTO projects (id, name, title, purpose, revision, status)
       VALUES (?, 'demo', 'Demo', '', '1', 'active')`,
      [PRJ],
    );

    const saved = projectCommandsStoreCommand.handle(
      { sql } as unknown as Tx,
      PROJECT_COMMANDS_CONTEXT,
      {
        project: PRJ,
        commands: [
          {
            id: "deploy",
            name: "Deploy",
            command: "/usr/local/bin/deploy",
            kind: "action",
            description: "deploy build",
            preview_url: "http://localhost:3000",
            auto_open_preview: true,
            timeout_ms: 600_000,
            order: 0,
            agents: [AGT],
            ask_before_run: true,
          },
        ],
        settings: {
          agents: [AGT],
          ask_before_run: true,
          approve_agent_writes: true,
        },
      },
      {},
    );
    assert.ok(saved.ok);

    const loaded = loadProjectCommands(sql, PRJ);
    assert.ok(loaded.ok);
    assert.equal(loaded.value.commands.length, 1);
    assert.deepEqual(loaded.value.commands[0], {
      id: "deploy",
      name: "Deploy",
      command: "/usr/local/bin/deploy",
      kind: "action",
      description: "deploy build",
      preview_url: "http://localhost:3000",
      auto_open_preview: true,
      timeout_ms: 600_000,
      order: 0,
      agents: [AGT],
      ask_before_run: true,
    });
    assert.deepEqual(loaded.value.settings, {
      agents: [AGT],
      ask_before_run: true,
      approve_agent_writes: true,
    });
  } finally {
    db.close();
  }
});
