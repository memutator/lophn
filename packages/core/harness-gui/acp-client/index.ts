// Public entry point for the shared 4-layer ACP client (`packages/core/harness-gui/acp-client/`).
// Combines JsonRpcTransport, AcpRuntime, AcpDialect, and AcpSessionProjector into
// reusable `startAcpDialectSession` and `fetchAcpCatalog` runners.

import type { Clock } from "../../../base/clock.ts";
import type { IdSource } from "../../../base/id.ts";
import type { Result } from "../../../base/result.ts";
import type {
  AcpCliSession,
  AcpSessionHandle,
  CliSpawn,
  HarnessCatalogResult,
  HarnessLaunchConfig,
} from "../../../protocol/acp/mod.ts";
import type { HarnessGuiCarry, HarnessGuiRun } from "../adapter.ts";
import type { AcpDialect } from "./dialect.ts";
import { createAcpSessionProjector } from "./projector.ts";
import { type AcpRuntime, createAcpRuntime } from "./runtime.ts";
import {
  createJsonRpcTransport,
  DEFAULT_REQUEST_TIMEOUT_MS,
  type Json,
  type JsonRpcTransport,
} from "./transport.ts";

export * from "./antigravity-child-work.ts";
export * from "./antigravity-dialect.ts";
export * from "./dialect.ts";
export * from "./projector.ts";
export * from "./runtime.ts";
export * from "./transport.ts";

const isRec = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const rec = (value: unknown): Json => (isRec(value) ? value : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const reason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export type StartAcpDialectOptions = {
  dialect: AcpDialect;
  cwd: string;
  resume?: string;
  args?: readonly string[];
  carry?: HarnessGuiCarry;
  launch?: HarnessLaunchConfig;
  session: AcpSessionHandle;
  spawn: CliSpawn;
  clock: Clock;
  ids: IdSource;
  readFile(path: string): Promise<Uint8Array>;
  requestTimeoutMs?: number;
  stopTimeouts?: { cancelMs?: number; closeMs?: number; exitMs?: number };
};

export async function startAcpDialectSession(
  options: StartAcpDialectOptions,
): Promise<Result<HarnessGuiRun>> {
  const { dialect, cwd, session, spawn, clock, ids } = options;
  const launchArgs = options.args ?? options.carry?.args ?? [];
  const launchSpec = dialect.buildLaunchSpec(launchArgs);

  let started = false;
  let stopping = false;
  let closed = false;
  let reviving: Promise<string | null> | null = null;

  let transport!: JsonRpcTransport;
  let runtime!: AcpRuntime;

  const projector = createAcpSessionProjector({
    cwd,
    dialect,
    session,
    clock,
    ids,
    readFile: options.readFile,
    getRuntime: () => runtime,
    respondRpc: (id, result) => transport.respond(id, result),
    respondRpcError: (id, code, message) =>
      transport.respondError(id, code, message),
    ensureAlive: async () => (transport.exited ? await revive() : null),
    isProcessExited: () => transport.exited,
    stderrTail: () => transport.stderrTail(),
    switchSession: (targetId) => switchConversation(targetId),
  });

  function connect(): void {
    const mine = createJsonRpcTransport({
      label: dialect.command,
      spawn,
      command: dialect.command,
      args: launchSpec.args,
      cwd,
      ...(launchSpec.env === undefined ? {} : { env: launchSpec.env }),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs }),
      ...(options.stopTimeouts === undefined
        ? {}
        : { stopTimeouts: options.stopTimeouts }),
      onWireActivity: () => {
        if (transport === mine) runtime.notifyWireActivity();
      },
      onNotification: (method, params) => {
        if (transport === mine) runtime.handleNotification(method, params);
      },
      onAgentRequest: (id, method, params) => {
        if (transport === mine) runtime.handleAgentRequest(id, method, params);
      },
      onWarning: (message) => {
        if (transport === mine) projector.info(message, "warning");
      },
      onExit: (code, tailText) => {
        if (transport !== mine) return;
        runtime.dispose();
        if (!started || closed || stopping || reviving !== null) return;
        projector.onProcessExit(code, tailText);
      },
    });
    transport = mine;
    runtime = createAcpRuntime({
      transport: mine,
      dialect,
      hooks: {
        onSessionUpdate: (update, ctx) =>
          projector.onSessionUpdate(update, ctx),
        onAgentRequest: (id, method, params) =>
          projector.onAgentRequest(id, method, params),
        onCancelRequest: (requestId) => projector.onCancelRequest(requestId),
        onReplayStart: (mode) => projector.beginReplay(mode),
        onSessionOpened: (info) => projector.onSessionOpened(info),
        onReplayCommit: (mode) => projector.commitReplay(mode),
        onReplayAbort: () => projector.abortReplay(),
      },
    });
  }

  async function openConversation(
    targetId: string | null,
    mode: "collect" | "discard",
  ): Promise<string | null> {
    const canLoad =
      targetId !== null &&
      (dialect.sessionExists === undefined
        ? true
        : await dialect.sessionExists(targetId));

    const reply = canLoad
      ? await runtime.reopenExisting(targetId, cwd, mode)
      : await runtime.newSession(cwd);

    return reply.ok ? null : reply.error;
  }

  function revive(): Promise<string | null> {
    reviving ??= (async () => {
      const previousSessionId = runtime.sessionId;
      try {
        connect();
        const init = await runtime.initialize();
        if (!init.ok) {
          const tail = transport.stderrTail();
          return `${dialect.command} did not restart: ${init.error}${tail === "" ? "" : `\n${tail}`}`;
        }
        projector.setAgentMeta({
          agentVersion: init.info.agentVersion,
          canImage: init.info.canImage,
        });
        const failed = await openConversation(
          previousSessionId === "" ? null : previousSessionId,
          "discard",
        );
        return failed === null
          ? null
          : `${dialect.command} did not reopen the conversation: ${failed}`;
      } finally {
        reviving = null;
      }
    })();
    return reviving;
  }

  async function switchConversation(targetId: string): Promise<void> {
    if (
      dialect.sessionExists !== undefined &&
      !(await dialect.sessionExists(targetId))
    ) {
      projector.info(
        "That conversation is no longer on this computer.",
        "warning",
      );
      return;
    }
    const before = runtime.sessionId;
    if (before !== "") {
      void runtime.closeSession(before);
    }
    projector.resetForSessionSwitch();
    projector.setPendingReset();
    const failed = await openConversation(targetId, "collect");
    if (failed === null) return;
    projector.info(`Could not open the conversation: ${failed}`, "warning");
    if (before !== "") {
      projector.setPendingReset();
      const back = await openConversation(before, "collect");
      if (back !== null) {
        projector.info(
          `Could not reopen the earlier conversation: ${back}`,
          "warning",
        );
      }
    }
  }

  // --- Startup ---
  connect();
  const init = await runtime.initialize();
  if (!init.ok) {
    closed = true;
    runtime.dispose();
    projector.close();
    transport.kill();
    const tail = transport.stderrTail();
    return {
      ok: false,
      error: {
        code: "unavailable",
        message: `\`${dialect.command}\` did not start: ${init.error}${tail === "" ? "" : `\n${tail}`}`,
      },
    };
  }

  projector.setAgentMeta({
    agentVersion: init.info.agentVersion,
    canImage: init.info.canImage,
  });

  const openError = await openConversation(options.resume ?? null, "collect");
  if (openError !== null) {
    closed = true;
    runtime.dispose();
    projector.close();
    transport.kill();
    const tail = transport.stderrTail();
    return {
      ok: false,
      error: {
        code: "unavailable",
        message: `${dialect.command} could not open the conversation: ${openError}${tail === "" ? "" : `\n${tail}`}`,
      },
    };
  }

  started = true;

  // Apply initial config options (priority: explicit CLI flag > carry > launch bundle for fresh sessions).
  const fresh = !(
    options.resume !== undefined && runtime.sessionId === options.resume
  );
  const launchModel =
    launchSpec.parsedFlags.model ??
    options.carry?.model ??
    (fresh ? options.launch?.model : undefined);
  const launchEffort =
    launchSpec.parsedFlags.effort ??
    options.carry?.effort ??
    (fresh ? options.launch?.options?.effort : undefined);
  await projector.applyInitialConfigs([
    ["model", launchModel, "model"],
    ["thought_level", launchEffort, "thought"],
    ["mode", launchSpec.parsedFlags.mode, "mode"],
  ]);

  const versionWarning = dialect.checkVersionWarning(init.info.agentVersion);
  if (versionWarning !== null) {
    projector.info(versionWarning, "warning");
  }

  let inputChain: Promise<void> = Promise.resolve();
  session.onInput((message) => {
    inputChain = inputChain
      .then(() => projector.handleInput(message))
      .catch((error) =>
        projector.info(`${message.type} failed: ${reason(error)}`, "warning"),
      );
  });

  let stopped: Promise<void> | null = null;
  const run: HarnessGuiRun = {
    stop() {
      stopped ??= (async () => {
        stopping = true;
        await transport.stop({
          sessionId: runtime.sessionId,
          isTurnActive: () => projector.isTurnActive(),
          cancelTurn: () => projector.stopTurn(),
        });
        closed = true;
        runtime.dispose();
        projector.close();
      })();
      return stopped;
    },
    tuiCommand() {
      return dialect.buildTuiCommand({
        sessionId: runtime.sessionId,
        launchSpec,
        configs: projector.configs,
        legacyModels: projector.legacyModels,
        changed: projector.changed,
      });
    },
    carry: () => (launchArgs.length > 0 ? { args: launchArgs } : {}),
    async sessions() {
      if (transport.exited) return [];
      const reply = await runtime.listSessions(cwd);
      if (!reply.ok) return [];
      const here = cwd.replace(/\/+$/, "");
      return arr(reply.data.sessions)
        .map(rec)
        .filter((one) => str(one.cwd).replace(/\/+$/, "") === here)
        .sort((a, b) => str(b.updatedAt).localeCompare(str(a.updatedAt)))
        .slice(0, 30)
        .map(
          (one): AcpCliSession => ({
            id: str(one.sessionId),
            title: str(one.title) || null,
            updated_at: str(one.updatedAt) || null,
          }),
        );
    },
    sessionId: () => (runtime.sessionId === "" ? null : runtime.sessionId),
    running: () => projector.runningCounts(),
  };

  return { ok: true, value: run };
}

export async function fetchAcpCatalog(options: {
  dialect: AcpDialect;
  home: string;
  cwd?: string;
  spawn: CliSpawn;
  signal: AbortSignal;
}): Promise<Result<HarnessCatalogResult>> {
  const { dialect, signal } = options;
  const fail = (message: string) =>
    ({ ok: false, error: { code: "unavailable", message } }) as const;
  if (signal.aborted) return fail("The model list read was aborted.");

  const transport = createJsonRpcTransport({
    label: dialect.command,
    spawn: options.spawn,
    command: dialect.command,
    args: dialect.buildLaunchSpec([]).args,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
  });
  if (transport.pid === undefined) {
    return fail(`\`${dialect.command}\` was not found on PATH.`);
  }

  const runtime = createAcpRuntime({
    transport,
    dialect,
    hooks: {
      onSessionUpdate() {},
      onAgentRequest() {},
      onCancelRequest() {},
      onReplayStart() {},
      onSessionOpened() {},
      onReplayCommit() {},
      onReplayAbort() {},
    },
  });

  const stop = () => {
    runtime.dispose();
    transport.kill();
  };
  signal.addEventListener("abort", stop, { once: true });
  const deadline = setTimeout(stop, DEFAULT_REQUEST_TIMEOUT_MS);

  const tailSuffix = () => {
    const tail = transport.stderrTail();
    return tail === "" ? "" : `\n${tail}`;
  };

  try {
    const init = await runtime.initialize();
    if (!init.ok) {
      return fail(
        `\`${dialect.command}\` did not start: ${init.error}${tailSuffix()}`,
      );
    }
    const created = await runtime.newSession(options.cwd ?? options.home);
    if (signal.aborted) return fail("The model list read was aborted.");
    if (!created.ok) {
      return fail(
        `${dialect.command} did not open a session: ${created.error}${tailSuffix()}`,
      );
    }
    const configs = dialect.parseConfigs(created.data.configOptions);
    const legacy = arr(rec(created.data.models).availableModels).map((one) =>
      str(rec(one).modelId),
    );
    await runtime.closeSession(str(created.data.sessionId));
    const current = (id: string) =>
      configs.find((one) => one.id === id)?.current ?? "";
    const thought = current("thought_level");
    return {
      ok: true,
      value: {
        models: dialect.buildModelGroups(configs, legacy),
        defaults: {
          model: current("model") || null,
          options: thought === "" ? {} : { effort: thought },
        },
      },
    };
  } finally {
    clearTimeout(deadline);
    signal.removeEventListener("abort", stop);
    stop();
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([
      transport.gone,
      new Promise((resolve) => {
        timer = setTimeout(resolve, 3000);
      }),
    ]);
    clearTimeout(timer);
  }
}
