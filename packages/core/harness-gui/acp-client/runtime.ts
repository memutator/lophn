// Layer 2: ACP protocol runtime over JsonRpcTransport.
// Handles initialize v1/v2 generation detection by response structure ("info" in response),
// session/new|load|resume|list|close|cancel|prompt|set_config_option|set_mode,
// explicit replay gate state machine (idle -> collecting -> draining -> commit -> skipping_late_replay -> live),
// serialized control calls, and the mid-turn prompt steer lane (outstanding counter).

import type { AcpDialect } from "./dialect.ts";
import type { Json, JsonRpcReply, JsonRpcTransport } from "./transport.ts";

export type AcpProtocolGeneration = "v1" | "v2";

export type ReplayPhase =
  | "idle"
  | "collecting"
  | "draining"
  | "skipping_late_replay"
  | "live";

export type ReplayMode = "collect" | "discard";

export type InitializeInfo = {
  generation: AcpProtocolGeneration;
  agentName: string;
  agentVersion: string;
  canImage: boolean;
  supportsLoad: boolean;
  supportsResume: boolean;
  raw: Json;
};

export type RuntimeUpdateContext = {
  phase: ReplayPhase;
  mode: ReplayMode | "live";
};

export type AcpRuntimeHooks = {
  onSessionUpdate(update: Json, ctx: RuntimeUpdateContext): void;
  onAgentRequest(id: string | number, method: string, params: Json): void;
  onCancelRequest(requestId: unknown): void;
  onReplayStart(mode: ReplayMode): void;
  onSessionOpened(info: {
    sessionId: string;
    data: Json;
    mode: ReplayMode | "live";
    method: "new" | "load" | "resume";
  }): void;
  onReplayCommit(mode: ReplayMode): void;
  onReplayAbort(): void;
};

export type AcpRuntime = {
  readonly sessionId: string;
  readonly replayPhase: ReplayPhase;
  readonly outstandingPrompts: number;
  readonly initInfo: InitializeInfo | null;
  setSessionId(id: string): void;
  /** Must be wired to transport.onWireActivity so partial stdout bytes extend the quiet window. */
  notifyWireActivity(): void;
  /** Route incoming JSON-RPC notifications from transport into the runtime. */
  handleNotification(method: string, params: Json): void;
  /** Route incoming agent requests from transport. */
  handleAgentRequest(id: string | number, method: string, params: Json): void;
  initialize(): Promise<
    { ok: true; info: InitializeInfo } | { ok: false; error: string }
  >;
  newSession(cwd: string): Promise<JsonRpcReply>;
  loadSession(
    sessionId: string,
    cwd: string,
    mode: ReplayMode,
  ): Promise<JsonRpcReply>;
  resumeSession(sessionId: string, cwd: string): Promise<JsonRpcReply>;
  /** Revive helper: prefers session/resume when dialect & server support it, falls back to session/load (discard). */
  reopenExisting(
    sessionId: string,
    cwd: string,
    mode: ReplayMode,
  ): Promise<JsonRpcReply>;
  listSessions(cwd: string): Promise<JsonRpcReply>;
  closeSession(sessionId: string): Promise<JsonRpcReply>;
  cancelSession(sessionId: string): void;
  setConfigOption(
    sessionId: string,
    configId: string,
    value: string,
  ): Promise<JsonRpcReply>;
  setMode(sessionId: string, modeId: string): Promise<JsonRpcReply>;
  sendPrompt(
    sessionId: string,
    blocks: readonly Json[],
  ): Promise<{ reply: JsonRpcReply; remainingOutstanding: number }>;
  /** Cancel any in-flight quiet-window timer (e.g. on process exit or stop). */
  dispose(): void;
};

const METADATA_UPDATES: ReadonlySet<string> = new Set([
  "config_option_update",
  "available_commands_update",
  "current_mode_update",
  "usage_update",
  "session_info_update",
]);

const isRec = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const rec = (value: unknown): Json => (isRec(value) ? value : {});
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";

export function detectProtocolGeneration(
  initResult: Json,
): AcpProtocolGeneration {
  // Some ACP agents (including Antigravity) may report protocolVersion: 2 while
  // still returning the v1 response schema (agentInfo/agentCapabilities).
  // Generation is therefore detected by response structure ("info" in response).
  return "info" in initResult ? "v2" : "v1";
}

export function createAcpRuntime(options: {
  transport: JsonRpcTransport;
  dialect: AcpDialect;
  hooks: AcpRuntimeHooks;
}): AcpRuntime {
  const { transport, dialect, hooks } = options;

  let sessionId = "";
  let replayPhase: ReplayPhase = "idle";
  let replayMode: ReplayMode = "collect";
  let openingSession = false;
  let outstandingPrompts = 0;
  let initInfo: InitializeInfo | null = null;
  let disposed = false;

  // Serialize control calls (config/mode/list/close) so they never reorder on the wire.
  let controlChain: Promise<unknown> = Promise.resolve();
  function serializedControl<T>(fn: () => Promise<T>): Promise<T> {
    const next = controlChain.then(fn, fn);
    controlChain = next.catch(() => {});
    return next;
  }

  // Quiet-window draining timer state.
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  let quietResolve: (() => void) | null = null;
  let quietDurationMs = 0;

  function clearQuietTimer(): void {
    if (quietTimer !== undefined) {
      clearTimeout(quietTimer);
      quietTimer = undefined;
    }
  }

  function finishQuietWait(): void {
    clearQuietTimer();
    const done = quietResolve;
    quietResolve = null;
    done?.();
  }

  function bumpQuietTimer(): void {
    if (replayPhase !== "draining" || quietResolve === null) return;
    clearQuietTimer();
    quietTimer = setTimeout(finishQuietWait, quietDurationMs);
  }

  function waitQuietPeriod(ms: number): Promise<void> {
    if (ms <= 0 || disposed || transport.exited) {
      return Promise.resolve();
    }
    quietDurationMs = ms;
    return new Promise<void>((resolve) => {
      quietResolve = resolve;
      quietTimer = setTimeout(finishQuietWait, ms);
    });
  }

  function handleNotification(method: string, params: Json): void {
    if (method === "$/cancel_request") {
      hooks.onCancelRequest(params.requestId);
      return;
    }
    if (method !== "session/update") return;
    const sid = str(params.sessionId);
    if (!openingSession && sid !== "" && sid !== sessionId) return;
    const update = rec(params.update);
    const kind = str(update.sessionUpdate);
    const isMeta = METADATA_UPDATES.has(kind);

    if (replayPhase === "collecting" || replayPhase === "draining") {
      bumpQuietTimer();
      if (replayMode === "collect") {
        hooks.onSessionUpdate(update, { phase: replayPhase, mode: "collect" });
      } else if (isMeta) {
        hooks.onSessionUpdate(update, { phase: replayPhase, mode: "discard" });
      }
      return;
    }

    if (replayPhase === "skipping_late_replay") {
      // Until the first live prompt is dispatched, drop late conversation chunks
      // while allowing metadata updates through.
      if (isMeta) {
        hooks.onSessionUpdate(update, { phase: "live", mode: "live" });
      }
      return;
    }

    hooks.onSessionUpdate(update, { phase: "live", mode: "live" });
  }

  async function initialize(): Promise<
    { ok: true; info: InitializeInfo } | { ok: false; error: string }
  > {
    const reply = await transport.request("initialize", {
      protocolVersion: 1,
      clientCapabilities: dialect.clientCapabilities,
      clientInfo: dialect.clientInfo,
    });
    if (!reply.ok) return { ok: false, error: reply.error };

    const generation = detectProtocolGeneration(reply.data);
    const agentInfo = rec(
      generation === "v2" ? reply.data.info : reply.data.agentInfo,
    );
    const agentCapabilities = rec(
      generation === "v2"
        ? reply.data.capabilities
        : reply.data.agentCapabilities,
    );
    const sessionCaps = rec(
      agentCapabilities.sessionCapabilities ??
        agentCapabilities.session_capabilities,
    );
    const promptCaps = rec(agentCapabilities.promptCapabilities);

    initInfo = {
      generation,
      agentName: str(agentInfo.name),
      agentVersion: str(agentInfo.version),
      canImage: promptCaps.image !== false,
      supportsLoad:
        agentCapabilities.loadSession === true ||
        agentCapabilities.load_session === true ||
        sessionCaps.load !== undefined,
      supportsResume: sessionCaps.resume !== undefined,
      raw: reply.data,
    };
    return { ok: true, info: initInfo };
  }

  async function newSession(cwd: string): Promise<JsonRpcReply> {
    openingSession = true;
    const reply = await transport.request("session/new", {
      cwd,
      mcpServers: [],
    });
    openingSession = false;
    if (!reply.ok) return reply;
    sessionId = str(reply.data.sessionId);
    replayPhase = "live";
    hooks.onSessionOpened({
      sessionId,
      data: reply.data,
      mode: "live",
      method: "new",
    });
    return reply;
  }

  async function loadSession(
    targetId: string,
    cwd: string,
    mode: ReplayMode,
  ): Promise<JsonRpcReply> {
    openingSession = true;
    replayMode = mode;
    replayPhase = "collecting";
    hooks.onReplayStart(mode);

    const reply = await transport.request("session/load", {
      sessionId: targetId,
      cwd,
      mcpServers: [],
    });

    if (!reply.ok) {
      replayPhase = "idle";
      openingSession = false;
      hooks.onReplayAbort();
      return reply;
    }

    sessionId = targetId;
    hooks.onSessionOpened({
      sessionId: targetId,
      data: reply.data,
      mode,
      method: "load",
    });

    // Wait out trailing replay frames (e.g. agy emits commands/usage/title or
    // replay chunks after session/load RPC returns).
    replayPhase = "draining";
    await waitQuietPeriod(dialect.loadReplayQuietPeriodMs);

    if (disposed) {
      openingSession = false;
      return reply;
    }

    hooks.onReplayCommit(mode);
    replayPhase = "skipping_late_replay";
    openingSession = false;
    return reply;
  }

  async function resumeSession(
    targetId: string,
    cwd: string,
  ): Promise<JsonRpcReply> {
    openingSession = true;
    replayMode = "discard";
    replayPhase = "collecting";
    hooks.onReplayStart("discard");

    const reply = await transport.request("session/resume", {
      sessionId: targetId,
      cwd,
      mcpServers: [],
    });

    if (!reply.ok) {
      replayPhase = "idle";
      openingSession = false;
      hooks.onReplayAbort();
      return reply;
    }

    sessionId = targetId;
    hooks.onSessionOpened({
      sessionId: targetId,
      data: reply.data,
      mode: "discard",
      method: "resume",
    });
    hooks.onReplayCommit("discard");
    replayPhase = "skipping_late_replay";
    openingSession = false;
    return reply;
  }

  async function reopenExisting(
    targetId: string,
    cwd: string,
    mode: ReplayMode,
  ): Promise<JsonRpcReply> {
    if (
      mode === "discard" &&
      dialect.resumePreference === "resume" &&
      initInfo?.supportsResume
    ) {
      const resumed = await resumeSession(targetId, cwd);
      if (resumed.ok) return resumed;
    }
    return loadSession(targetId, cwd, mode);
  }

  async function sendPrompt(
    targetId: string,
    blocks: readonly Json[],
  ): Promise<{ reply: JsonRpcReply; remainingOutstanding: number }> {
    // First live prompt exits skipping_late_replay into live mode.
    replayPhase = "live";
    outstandingPrompts += 1;
    try {
      const reply = await transport.request("session/prompt", {
        sessionId: targetId,
        prompt: blocks,
      });
      outstandingPrompts = Math.max(0, outstandingPrompts - 1);
      return { reply, remainingOutstanding: outstandingPrompts };
    } catch (error) {
      outstandingPrompts = Math.max(0, outstandingPrompts - 1);
      throw error;
    }
  }

  return {
    get sessionId() {
      return sessionId;
    },
    get replayPhase() {
      return replayPhase;
    },
    get outstandingPrompts() {
      return outstandingPrompts;
    },
    get initInfo() {
      return initInfo;
    },
    setSessionId(id) {
      sessionId = id;
    },
    notifyWireActivity() {
      bumpQuietTimer();
    },
    handleNotification,
    handleAgentRequest(id, method, params) {
      hooks.onAgentRequest(id, method, params);
    },
    initialize,
    newSession,
    loadSession,
    resumeSession,
    reopenExisting,
    listSessions(cwd) {
      return serializedControl(() =>
        transport.request("session/list", { cwd }),
      );
    },
    closeSession(targetId) {
      return serializedControl(() =>
        transport.request("session/close", { sessionId: targetId }),
      );
    },
    cancelSession(targetId) {
      transport.notify("session/cancel", { sessionId: targetId });
    },
    setConfigOption(targetId, configId, value) {
      return serializedControl(() =>
        transport.request("session/set_config_option", {
          sessionId: targetId,
          configId,
          value,
        }),
      );
    },
    setMode(targetId, modeId) {
      return serializedControl(() =>
        transport.request("session/set_mode", {
          sessionId: targetId,
          modeId,
        }),
      );
    },
    sendPrompt,
    dispose() {
      disposed = true;
      finishQuietWait();
    },
  };
}
