// Layer 4: Session projector folding ACP notifications and user inputs into
// canonical lophn AcpUpdate events with explicit state machines for:
// - zero-leak replay collect buffer + atomic snapshot commit
// - echo-independent immediate user/steer messages (unconditional live user_message_chunk ignore)
// - 3-way slash command dispatch (local / maintenance / conversational) + withheldCommands
// - approval & elicitation/interaction_* dialog queue
// - subagent/swarm dock cards + tasks_changed + reactive wakeup settlement timers
// - read-only child work polling + incremental child_update projection

import type { Clock } from "../../../base/clock.ts";
import type { IdSource } from "../../../base/id.ts";
import { redactCredentials } from "../../../base/telemetry/log.ts";
import type { AcpInput } from "../../../protocol/acp/input.ts";
import {
  ACP_TOOL_BODY_LIMIT,
  type AcpNoticeItem,
  type AcpToolDetail,
} from "../../../protocol/acp/items.ts";
import type { AcpSessionHandle } from "../../../protocol/acp/mod.ts";
import type {
  AcpCommand,
  AcpSessionMeta,
  AcpUsage,
} from "../../../protocol/acp/session.ts";
import type {
  AcpChildUpdate,
  AcpTask,
  AcpUpdate,
} from "../../../protocol/acp/state.ts";
import type { AcpApprovalSubject } from "../../../protocol/approvals/gate-call.ts";
import type { ContentBlock } from "../../../protocol/lophn-agent/content-block.ts";
import { resendQueue, swapQueued } from "../queue.ts";
import { classifyReceived, type ReceivedText } from "../received.ts";
import type {
  AcpDialect,
  ChildTranscriptStep,
  ChildWorkEntry,
  ChildWorkState,
  ConfigOption,
  DialectPermissionOption,
} from "./dialect.ts";
import type {
  AcpRuntime,
  ReplayMode,
  RuntimeUpdateContext,
} from "./runtime.ts";
import type { Json, JsonRpcReply } from "./transport.ts";

type CommittableHandle = AcpSessionHandle & {
  commit?(updates: readonly AcpUpdate[]): void;
};

type Card = {
  question: string;
  header: string;
  options: { label: string; description: string }[];
  multiSelect: boolean;
};

type TrackedCall = {
  id: string;
  remoteId: string;
  name: string;
  kind: string;
  title: string;
  args: Json;
  path: string;
  input: string;
  startedAt: string;
  done: boolean;
  outlivesPrompt: boolean;
  detail: AcpToolDetail;
  subagentRole: string | null;
  childKey: string | null;
  question?: { group: string; asked: Card[]; answers: string[][] };
};

type QueuedEntry =
  | {
      kind: "message";
      id: string;
      content: ContentBlock[];
      text: string;
      /** True when re-queued after a failed mid-turn steer whose message is already in the timeline. */
      alreadyInTimeline?: boolean;
    }
  | {
      kind: "maintenance";
      id: string;
      command: string;
      argument: string;
      content: ContentBlock[];
      text: string;
    };

type Dialog =
  | {
      kind: "approval";
      rpc: string | number;
      request: string;
      call: TrackedCall | undefined;
      subject: AcpApprovalSubject;
      options: DialectPermissionOption[];
      alwaysPatterns: string[];
    }
  | {
      kind: "question";
      rpc: string | number;
      group: string;
      toolCall: string;
      asked: Card[];
      fields: { key: string; values: Map<string, string> }[] | null;
      permission: { id: string; label: string }[] | null;
    };

type ChildLane = {
  childId: string;
  seq: number;
  lastStepIndex: number;
  lastSummary: string | null;
  turnId: string | null;
  state: ChildWorkState;
  syntheticToolId: string | null;
};

type StreamBuffer = {
  call: string;
  text: string;
  thought: string;
  warning: boolean;
};

const SLASH = /^\/(\S+)(?:\s+([\s\S]*))?$/;
// biome-ignore lint/suspicious/noControlCharactersInRegex: strip ANSI escapes from notice messages.
const ANSI = /\u001b\[[0-9;]*m/g;
// acpStateSchema의 atSchema는 밀리초 3자리 UTC ISO 형식만 받는다. 외부 transcript의 created_at을 정규화한다.
const AT_FORMAT =
  /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/;

function normalizeAt(value: string, fallback: string): string {
  if (AT_FORMAT.test(value)) return value;
  if (value !== "") {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return new Date(parsed).toISOString();
  }
  return fallback;
}

const nonNegInt = (value: number | undefined): number | null =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.trunc(value))
    : null;

const isRec = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const rec = (value: unknown): Json => (isRec(value) ? value : {});
const arr = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const str = (value: unknown): string =>
  typeof value === "string" ? value : "";
const plain = (text: string): string => text.replace(ANSI, "");
const reason = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
const oneLine = (text: string, max: number): string =>
  text
    .replace(/\s*\n\s*/g, " ")
    .trim()
    .slice(0, max);
const cut = (text: string | null): string | null =>
  text !== null && text.length > ACP_TOOL_BODY_LIMIT
    ? text.slice(0, ACP_TOOL_BODY_LIMIT)
    : text;
const bodyOf = (input: string | null, output: string | null) => ({
  input: cut(input),
  output: cut(output),
  truncated:
    (input?.length ?? 0) > ACP_TOOL_BODY_LIMIT ||
    (output?.length ?? 0) > ACP_TOOL_BODY_LIMIT,
});

function toSubagentDetailState(
  state: ChildWorkState,
): "running" | "done" | "failed" | "cancelled" {
  switch (state) {
    case "running":
      return "running";
    case "ok":
      return "done";
    case "error":
      return "failed";
    case "cancelled":
      return "cancelled";
  }
}

function toTaskState(
  state: ChildWorkState,
): "running" | "done" | "failed" | "stopped" {
  switch (state) {
    case "running":
      return "running";
    case "ok":
      return "done";
    case "error":
      return "failed";
    case "cancelled":
      return "stopped";
  }
}

function toolStateToSubagentDetailState(
  state: "ok" | "error" | "denied" | "cancelled",
): "done" | "failed" | "cancelled" {
  if (state === "ok") return "done";
  if (state === "cancelled") return "cancelled";
  return "failed";
}

function toolStateToTaskState(
  state: "ok" | "error" | "denied" | "cancelled",
): "done" | "failed" | "stopped" {
  if (state === "ok") return "done";
  if (state === "cancelled") return "stopped";
  return "failed";
}

function stripWrapperTags(text: string): string {
  const userReq = /<USER_REQUEST>\s*([\s\S]*?)\s*<\/USER_REQUEST>/i.exec(text);
  if (userReq?.[1] !== undefined) return userReq[1].trim();
  const sysMsg = /<SYSTEM_MESSAGE>\s*([\s\S]*?)\s*<\/SYSTEM_MESSAGE>/i.exec(
    text,
  );
  if (sysMsg?.[1] !== undefined) return sysMsg[1].trim();
  return text.trim();
}

export type ProjectorDeps = {
  cwd: string;
  dialect: AcpDialect;
  session: AcpSessionHandle;
  clock: Clock;
  ids: IdSource;
  readFile(path: string): Promise<Uint8Array>;
  getRuntime(): AcpRuntime;
  respondRpc(id: string | number, result: Json): void;
  respondRpcError(id: string | number, code: number, message: string): void;
  ensureAlive(): Promise<string | null>;
  isProcessExited(): boolean;
  stderrTail(): string;
  switchSession(targetSessionId: string): Promise<void>;
};

export type AcpSessionProjector = {
  readonly turnId: string | null;
  readonly configs: readonly ConfigOption[];
  readonly legacyModels: readonly string[];
  readonly changed: { model: boolean; thought: boolean; mode: boolean };
  readonly isTurnActive: () => boolean;
  readonly runningCounts: () => { turn: boolean; tasks: number };
  setAgentMeta(info: { agentVersion: string; canImage: boolean }): void;
  setPendingReset(): void;
  beginReplay(mode: ReplayMode): void;
  onSessionOpened(info: {
    sessionId: string;
    data: Json;
    mode: ReplayMode | "live";
    method: "new" | "load" | "resume";
  }): void;
  commitReplay(mode: ReplayMode): void;
  abortReplay(): void;
  onSessionUpdate(update: Json, ctx: RuntimeUpdateContext): void;
  onAgentRequest(id: string | number, method: string, params: Json): void;
  onCancelRequest(requestId: unknown): void;
  onProcessExit(code: number | null, stderrTail: string): void;
  handleInput(message: AcpInput): Promise<void>;
  applyInitialConfigs(
    entries: readonly [
      string,
      string | undefined,
      "model" | "thought" | "mode",
    ][],
  ): Promise<void>;
  stopTurn(): void;
  info(text: string, level?: "info" | "warning"): void;
  resetForSessionSwitch(): void;
  pollChildWorkNow(): Promise<void>;
  close(): void;
};

export function createAcpSessionProjector(
  deps: ProjectorDeps,
): AcpSessionProjector {
  const { cwd, dialect, session, clock, ids } = deps;
  const now = () => clock.now();

  let closed = false;
  let seq = 0;
  let sessionId = "";
  let agentVersion: string | null = null;
  let canImage = true;
  let metaReady = false;

  // Replay collect state (zero-leak: never publishes to live stream until commitReplay).
  let collecting = false;
  let collectBuffer: AcpUpdate[] = [];
  let savedSeqBeforeReplay = 0;
  let pendingReset = false;
  let discardMetaDirty = false;
  // Coalesce consecutive user_message_chunk frames during collect replay.
  let replayUserText: string | null = null;

  // Turn & stream state.
  let turn: string | null = null;
  let turnWork = false;
  let cancelling = false;
  let lastStop = "";
  let maintenanceActive = false;
  let reactiveHold = false;
  let stream: StreamBuffer | null = null;
  let warnings: string[] = [];

  // Reactive settlement timers (spec 5.1.2).
  let quietTimer: ReturnType<typeof setTimeout> | undefined;
  let usageSettleTimer: ReturnType<typeof setTimeout> | undefined;
  let maxHoldTimer: ReturnType<typeof setTimeout> | undefined;

  // Calls, tasks, queue, dialogs.
  const calls = new Map<string, TrackedCall>();
  const denied = new Set<string>();
  const turnText = new Map<string, string>();
  const tasks = new Map<string, AcpTask>();
  let queue: QueuedEntry[] = [];
  let dialogs: Dialog[] = [];
  let openDialog: Dialog | null = null;

  // Read-only child work state.
  const childLanes = new Map<string, ChildLane>();
  let childPollTimer: ReturnType<typeof setInterval> | undefined;
  let childPollInFlight = false;

  // Session metadata.
  let configs: ConfigOption[] = [];
  let legacyModels: string[] = [];
  let changed = { model: false, thought: false, mode: false };
  let title: string | null = null;
  let context: { used: number; size: number } | null = null;
  let totals: Record<string, number> | null = null;
  let advertisedCommands: {
    name: string;
    description: string;
    hint: string | null;
  }[] = [];

  const emit = (update: AcpUpdate): void => {
    if (closed) return;
    if (collecting) {
      collectBuffer.push(update);
    } else {
      session.publish(update);
    }
  };

  const commitAtomic = (updates: readonly AcpUpdate[]): void => {
    if (closed || updates.length === 0) return;
    const committable = session as CommittableHandle;
    if (typeof committable.commit === "function") {
      committable.commit(updates);
    } else {
      for (const update of updates) session.publish(update);
    }
  };

  const cfg = (id: string) => configs.find((one) => one.id === id);
  const modelNow = () => cfg("model")?.current ?? "";
  const modeNow = () => cfg("mode")?.current ?? null;
  const supportsSteer = () => dialect.supportsMidTurnPromptSteer(agentVersion);

  function clearReactiveTimers(): void {
    if (quietTimer !== undefined) {
      clearTimeout(quietTimer);
      quietTimer = undefined;
    }
    if (usageSettleTimer !== undefined) {
      clearTimeout(usageSettleTimer);
      usageSettleTimer = undefined;
    }
    if (maxHoldTimer !== undefined) {
      clearTimeout(maxHoldTimer);
      maxHoldTimer = undefined;
    }
  }

  function hasOutlivingRunningTools(): boolean {
    for (const call of calls.values()) {
      if (!call.done && call.outlivesPrompt) return true;
    }
    for (const lane of childLanes.values()) {
      if (lane.state === "running") return true;
    }
    return false;
  }

  function countRunningTasks(): number {
    let count = 0;
    for (const task of tasks.values()) {
      if (task.state === "running") count += 1;
    }
    return count;
  }

  function publishTasks(): void {
    emit({ type: "tasks_changed", tasks: [...tasks.values()] });
  }

  function startChildPollingIfNeeded(): void {
    if (closed || dialect.readChildWork === undefined || sessionId === "") {
      return;
    }
    const shouldPoll = turn !== null || hasOutlivingRunningTools();
    if (!shouldPoll) {
      stopChildPolling();
      return;
    }
    if (childPollTimer !== undefined) return;
    const intervalMs = Math.max(50, dialect.childPollIntervalMs);
    childPollTimer = setInterval(() => {
      void pollChildWorkNow();
    }, intervalMs);
    childPollTimer.unref?.();
  }

  function stopChildPolling(): void {
    if (childPollTimer !== undefined) {
      clearInterval(childPollTimer);
      childPollTimer = undefined;
    }
  }

  function usageOf(): AcpUsage | null {
    if (context === null && totals === null) return null;
    return {
      context:
        context === null
          ? null
          : {
              tokens: nonNegInt(context.used) ?? 0,
              limit: nonNegInt(context.size) ?? 0,
              parts: [],
            },
      limits: [],
      input_tokens: nonNegInt(totals?.input),
      output_tokens: nonNegInt(totals?.output),
      cache_read_tokens: nonNegInt(totals?.cacheRead),
      cache_write_tokens: nonNegInt(totals?.cacheWrite),
      turns: nonNegInt(totals?.turns),
      costs: [],
      provider: null,
    };
  }

  function commandList(): AcpCommand[] {
    const withheld = new Set(
      dialect.withheldCommands.map((name) => name.toLowerCase()),
    );
    return [
      ...advertisedCommands
        .filter((one) => !withheld.has(one.name.toLowerCase()))
        .map((one) => ({
          name: one.name,
          aliases: [],
          description: one.description,
          argument_hint: one.hint,
          source: "harness" as const,
          opens:
            dialect.classifySlashCommand(one.name, []) === "maintenance" &&
            one.name.toLowerCase() === "compact"
              ? ("compact" as const)
              : null,
        })),
      ...dialect.localCommands,
    ];
  }

  function buildMeta(): AcpSessionMeta {
    const model = cfg("model");
    const thought = cfg("thought_level");
    const mode = cfg("mode");
    const current = model?.options.find((one) => one.value === model.current);
    return {
      title,
      cli_session: sessionId === "" ? null : sessionId,
      capabilities: {
        model: true,
        effort: true,
        mode: true,
        commands: true,
        rewind: false,
        rewind_files: false,
        fork: false,
        compact: true,
        rename: false,
        usage: true,
        steer: supportsSteer(),
        background: false,
        queue_edit: true,
        images: canImage,
        retry: true,
        sessions: false,
        stop_child: false,
        steer_child: false,
        tasks: false,
        toggles: false,
        goal: false,
        roles: false,
        shell: false,
        resume: true,
      },
      models: dialect.buildModelGroups(configs, legacyModels),
      model:
        model === undefined || model.current === ""
          ? null
          : {
              model: model.current,
              label: current?.name ?? model.current,
              options: thought === undefined ? {} : { effort: thought.current },
              layer: null,
            },
      modes: (mode?.options ?? [])
        .filter((one) => one.value !== "")
        .map((one) => ({
          id: one.value,
          label: one.name,
          description: one.description,
        })),
      mode: mode?.current ?? null,
      commands: commandList(),
      usage: usageOf(),
      toggles: [],
      goal: null,
      roles: null,
      harness: dialect.id,
    };
  }

  function publishMeta(): void {
    metaReady = true;
    emit({ type: "session_changed", session: buildMeta() });
  }

  function publishMetaPart(part: Partial<AcpSessionMeta>): void {
    if (collecting) return;
    if (metaReady) emit({ type: "session_changed", session: part });
  }

  function startTurn(): string {
    const id = ids.newId("trn");
    turn = id;
    turnWork = false;
    lastStop = "";
    emit({ type: "turn_started", turn: id, at: now() });
    if (!collecting) startChildPollingIfNeeded();
    return id;
  }

  const ensureTurn = (): string => turn ?? startTurn();

  function notice(body: AcpNoticeItem["notice"], outside = false): void {
    emit({
      type: "notice_added",
      item: {
        kind: "notice",
        id: ids.newId("msg"),
        seq: ++seq,
        at: now(),
        turn: outside ? null : turn,
        notice: body,
      },
    });
  }

  function info(text: string, level: "info" | "warning" = "info"): void {
    notice({ type: "info", text: redactCredentials(plain(text)), level });
  }

  function addMessage(
    id: string,
    content: ContentBlock[],
    extra?: { received?: ReceivedText; delivery?: "next_turn" | "steer" },
  ): string {
    const mine = ensureTurn();
    emit({
      type: "message_added",
      item: {
        kind: "message",
        id,
        seq: ++seq,
        at: now(),
        actor: extra?.received === undefined ? "user" : "received",
        sender: extra?.received?.sender ?? null,
        call: extra?.received?.call ?? null,
        reply_to: extra?.received?.reply_to ?? null,
        delivery: extra?.delivery ?? "next_turn",
        turn: mine,
        origin: null,
        content,
        reasoning: null,
        cards: [],
        complete: true,
      },
    });
    return mine;
  }

  function flushReplayUserText(): void {
    if (replayUserText === null) return;
    const text = replayUserText;
    replayUserText = null;
    if (text === "") return;
    const received = classifyReceived(text);
    if (received !== null) {
      addMessage(ids.newId("msg"), [{ type: "text", text: received.text }], {
        received,
      });
    } else {
      addMessage(ids.newId("msg"), [{ type: "text", text }]);
    }
  }

  function closeStream(): void {
    const current = stream;
    if (current === null) return;
    stream = null;
    if (current.warning) {
      warnings.push(current.text.trim());
      return;
    }
    if (current.text === "" && current.thought === "") return;
    turnWork = true;
    emit({
      type: "message_recorded",
      turn: ensureTurn(),
      message: ids.newId("msg"),
      model_call: collecting ? null : current.call,
      seq: ++seq,
      at: now(),
      body: {
        content:
          current.text === "" ? [] : [{ type: "text", text: current.text }],
        reasoning:
          current.thought === ""
            ? null
            : { text: current.thought, duration_ms: null },
        cards: [],
      },
    });
  }

  // --- Reactive wakeup timers (spec 5.1.2) ---
  function armReactiveTimers(): void {
    if (!dialect.reactiveWakeups || collecting || closed) return;
    const runtime = deps.getRuntime();
    if (runtime.outstandingPrompts > 0) return;

    if (usageSettleTimer !== undefined) {
      clearTimeout(usageSettleTimer);
      usageSettleTimer = undefined;
    }
    if (quietTimer !== undefined) {
      clearTimeout(quietTimer);
      quietTimer = undefined;
    }

    const runningTools = hasOutlivingRunningTools();
    const quietMs = runningTools
      ? dialect.reactiveTimers.runningToolsQuietMs
      : dialect.reactiveTimers.quietMs;

    quietTimer = setTimeout(() => {
      quietTimer = undefined;
      if (openDialog !== null || dialogs.length > 0) {
        armReactiveTimers();
        return;
      }
      if (deps.getRuntime().outstandingPrompts > 0) return;
      reactiveHold = false;
      endTurn("completed", undefined, { forceCancelTools: false });
    }, quietMs);
    quietTimer.unref?.();

    if (maxHoldTimer === undefined) {
      maxHoldTimer = setTimeout(() => {
        maxHoldTimer = undefined;
        if (deps.getRuntime().outstandingPrompts > 0) return;
        reactiveHold = false;
        endTurn("completed", undefined, { forceCancelTools: false });
      }, dialect.reactiveTimers.maxHoldMs);
      maxHoldTimer.unref?.();
    }
  }

  function noteReactiveActivity(): void {
    if (collecting) {
      ensureTurn();
      return;
    }
    if (turn === null) {
      startTurn();
      reactiveHold = true;
    }
    if (reactiveHold && deps.getRuntime().outstandingPrompts === 0) {
      armReactiveTimers();
    }
  }

  function onReactiveUsageUpdate(): void {
    if (
      !reactiveHold ||
      collecting ||
      closed ||
      deps.getRuntime().outstandingPrompts > 0
    ) {
      return;
    }
    if (hasOutlivingRunningTools()) return;
    if (usageSettleTimer !== undefined) clearTimeout(usageSettleTimer);
    usageSettleTimer = setTimeout(() => {
      usageSettleTimer = undefined;
      if (
        !reactiveHold ||
        deps.getRuntime().outstandingPrompts > 0 ||
        hasOutlivingRunningTools() ||
        openDialog !== null ||
        dialogs.length > 0
      ) {
        return;
      }
      reactiveHold = false;
      endTurn("completed", undefined, { forceCancelTools: false });
    }, dialect.reactiveTimers.usageSettleMs);
    usageSettleTimer.unref?.();
  }

  function onText(kind: "text" | "thought", text: string): void {
    if (text === "") return;
    if (collecting) flushReplayUserText();
    noteReactiveActivity();
    if (stream === null) {
      stream = {
        call: ids.newId("mcl"),
        text: "",
        thought: "",
        warning: kind === "text" && dialect.isWarningChunk(text),
      };
    }
    const current = stream;
    // Zero-leak replay invariant: NEVER emit writing_streamed during collect mode.
    if (!collecting && !current.warning) {
      emit({
        type: "writing_streamed",
        turn: ensureTurn(),
        model_call: current.call,
        kind: kind === "text" ? "text" : "reasoning",
        offset: current[kind].length,
        text,
        at: now(),
      });
    }
    current[kind] += text;
  }

  // --- Tool calls & Subagents ---
  function syncTaskForCall(
    call: TrackedCall,
    taskState: "running" | "done" | "failed" | "stopped",
    output: string | null,
  ): void {
    const isSubagent = call.detail.kind === "subagent";
    const taskKey = call.remoteId || call.id;
    const isTrackedBg = isSubagent || tasks.has(taskKey);
    if (!isTrackedBg) return;
    const description =
      call.detail.kind === "subagent"
        ? call.detail.description || call.detail.agent
        : call.title;
    tasks.set(taskKey, {
      id: taskKey,
      kind: isSubagent ? "agent" : call.kind === "execute" ? "shell" : "other",
      description,
      state: taskState,
      started_at: call.startedAt,
      output: cut(output),
    });
    publishTasks();
  }

  function startCall(
    u: Json,
    terminalInReplay?: {
      state: "ok" | "error" | "denied" | "cancelled";
      detail: AcpToolDetail | null;
      output: string | null;
    },
  ): TrackedCall {
    if (collecting) flushReplayUserText();
    closeStream();
    noteReactiveActivity();
    const args = isRec(u.rawInput) ? u.rawInput : rec(u.args);
    const name = str(u.name) || "tool";
    const remoteId = str(u.toolCallId);
    const kind = str(u.kind);
    const locations = arr(u.locations).map(rec);
    const classified = dialect.classifyToolCall(
      {
        toolCallId: remoteId,
        name,
        kind,
        title: str(u.title),
        args,
        locations,
      },
      cwd,
    );

    const startedAt = now();
    let initialDetail = classified.detail;
    if (terminalInReplay !== undefined) {
      if (terminalInReplay.detail !== null) {
        initialDetail = terminalInReplay.detail;
      } else if (initialDetail.kind === "subagent") {
        initialDetail = {
          ...initialDetail,
          state: toolStateToSubagentDetailState(terminalInReplay.state),
          last:
            terminalInReplay.output === null
              ? initialDetail.last
              : oneLine(terminalInReplay.output, 120),
        };
      }
    }

    const call: TrackedCall = {
      id: ids.newId("tcl"),
      remoteId,
      name,
      kind,
      title: classified.title,
      args,
      path: classified.path,
      input: JSON.stringify(args, null, 2),
      startedAt,
      done: terminalInReplay !== undefined,
      outlivesPrompt: classified.outlivesPrompt,
      detail: initialDetail,
      subagentRole: classified.subagent?.roleOrAgent ?? null,
      childKey: classified.subagent?.childKey ?? null,
    };
    calls.set(remoteId, call);
    turnWork = true;

    emit({
      type: "tool_started",
      item: {
        kind: "tool",
        id: call.id,
        seq: ++seq,
        at: startedAt,
        by: "agent",
        turn: ensureTurn(),
        tool: name,
        category: classified.category,
        title: classified.title.trim() || name,
        state:
          terminalInReplay === undefined ? "running" : terminalInReplay.state,
        duration_ms: terminalInReplay === undefined ? null : 0,
        detail: call.detail,
        body: bodyOf(call.input, terminalInReplay?.output ?? null),
      },
    });

    if (call.detail.kind === "subagent" && !call.done) {
      syncTaskForCall(call, "running", null);
      if (!collecting) {
        startChildPollingIfNeeded();
        void pollChildWorkNow();
      }
    }
    return call;
  }

  function resolveTerminalToolOutcome(
    call: TrackedCall,
    u: Json,
  ): {
    state: "ok" | "error" | "denied" | "cancelled";
    detail: AcpToolDetail | null;
    output: string | null;
  } {
    const raw = rec(u.rawOutput);
    const exit = typeof raw.exit_code === "number" ? raw.exit_code : 0;
    const status = str(u.status);
    const state: "ok" | "error" | "denied" | "cancelled" =
      status === "completed"
        ? exit === 0
          ? "ok"
          : "error"
        : denied.has(call.remoteId)
          ? "denied"
          : cancelling || status === "cancelled"
            ? "cancelled"
            : "error";

    const normalized = dialect.normalizeToolOutput(
      { name: call.name, kind: call.kind, args: call.args },
      u,
      cwd,
    );
    let detail: AcpToolDetail | null = normalized.diffDetail;
    if (detail === null && call.name === "ask_question") {
      const asked = call.question;
      const given = arr(call.args.questions).map(rec);
      detail = {
        kind: "question",
        group: asked?.group ?? null,
        outcome: state === "ok" ? "submitted" : "cancelled",
        lines: (asked?.asked ?? given.map(toCard)).map((one, index) => ({
          header: one.header,
          answer: asked?.answers[index]?.join(", ") ?? null,
        })),
      };
    } else if (detail === null && call.detail.kind === "subagent") {
      detail = {
        ...call.detail,
        state: toolStateToSubagentDetailState(state),
        last:
          normalized.output === null
            ? call.detail.last
            : oneLine(normalized.output, 120),
      };
    }
    return { state, detail, output: normalized.output };
  }

  function endCall(call: TrackedCall, u: Json): void {
    if (call.done) return;
    call.done = true;
    const outcome = resolveTerminalToolOutcome(call, u);
    if (outcome.detail !== null) call.detail = outcome.detail;

    emit({
      type: "tool_ended",
      tool_call: call.id,
      state: outcome.state,
      at: now(),
      detail: outcome.detail,
      body: bodyOf(call.input, outcome.output),
    });

    if (call.detail.kind === "subagent" || tasks.has(call.remoteId)) {
      syncTaskForCall(
        call,
        toolStateToTaskState(outcome.state),
        outcome.output,
      );
    }
    if (!collecting && call.detail.kind === "subagent") {
      void pollChildWorkNow();
    }
    if (reactiveHold && deps.getRuntime().outstandingPrompts === 0) {
      armReactiveTimers();
    }
  }

  function onTool(u: Json): void {
    const id = str(u.toolCallId);
    if (id === "") return;
    const status = str(u.status);
    const isTerminal =
      status === "completed" || status === "failed" || status === "cancelled";

    const existing = calls.get(id);
    if (existing === undefined) {
      if (collecting && isTerminal) {
        // In collect replay, fold an already-completed tool_call into a single
        // completed tool_started item (zero transient running state).
        const args = isRec(u.rawInput) ? u.rawInput : rec(u.args);
        const name = str(u.name) || "tool";
        const kind = str(u.kind);
        const tempCall: TrackedCall = {
          id: "",
          remoteId: id,
          name,
          kind,
          title: str(u.title),
          args,
          path: "",
          input: JSON.stringify(args, null, 2),
          startedAt: now(),
          done: false,
          outlivesPrompt: false,
          detail: { kind: "generic" },
          subagentRole: null,
          childKey: null,
        };
        const outcome = resolveTerminalToolOutcome(tempCall, u);
        startCall(u, outcome);
        return;
      }
      const created = startCall(u);
      if (isTerminal) endCall(created, u);
      return;
    }

    // Refresh args if a subsequent update carries richer rawInput.
    if (isRec(u.rawInput) && Object.keys(u.rawInput).length > 0) {
      existing.args = u.rawInput;
      existing.input = JSON.stringify(u.rawInput, null, 2);
    }
    noteReactiveActivity();
    if (isTerminal) endCall(existing, u);
  }

  // --- Approvals & Questions ---
  const toCard = (one: Json): Card => ({
    question: str(one.question) || "Question",
    header: oneLine(str(one.question) || "Question", 24),
    options: arr(one.options).map((option) => ({
      label: str(option),
      description: str(option),
    })),
    multiSelect: one.is_multi_select === true,
  });

  function pumpDialogs(): void {
    if (openDialog !== null) return;
    const next = dialogs.shift();
    if (next === undefined) return;
    openDialog = next;
    if (next.kind === "approval") {
      const always = next.options.some((one) => one.kind === "allow_always");
      emit({
        type: "approval_opened",
        approval: {
          id: next.request,
          subject: next.subject,
          choices: always ? ["once", "always", "reject"] : ["once", "reject"],
          always_patterns: next.alwaysPatterns,
        },
      });
    } else {
      emit({
        type: "question_asked",
        group: next.group,
        tool_call: next.toolCall,
        questions: next.asked,
      });
    }
  }

  function closeDialog(
    dialog: Dialog,
    how:
      | {
          approval: "allowed" | "denied" | "cancelled";
          choice?: "once" | "always";
        }
      | { question: "submitted" | "cancelled" },
  ): void {
    if (openDialog !== dialog) {
      dialogs = dialogs.filter((one) => one !== dialog);
      return;
    }
    openDialog = null;
    if (dialog.kind === "approval" && "approval" in how) {
      emit({
        type: "approval_closed",
        request: dialog.request,
        outcome: how.approval,
        choice: how.choice ?? null,
        reason: null,
        mode: null,
        seq: ++seq,
        at: now(),
      });
    } else if (dialog.kind === "question" && "question" in how) {
      emit({
        type: "question_resolved",
        group: dialog.group,
        outcome: how.question,
      });
    }
    pumpDialogs();
  }

  const cancelledAnswer = (dialog: Dialog): Json =>
    dialog.kind === "question" && dialog.permission === null
      ? { action: "cancel" }
      : { outcome: { outcome: "cancelled" } };

  function cancelDialogs(): void {
    const all = [openDialog, ...dialogs].filter(
      (one): one is Dialog => one !== null,
    );
    dialogs = [];
    for (const dialog of all) {
      deps.respondRpc(dialog.rpc, cancelledAnswer(dialog));
      closeDialog(
        dialog,
        dialog.kind === "approval"
          ? { approval: "cancelled" }
          : { question: "cancelled" },
      );
    }
  }

  function onPermission(rpc: string | number, params: Json): void {
    const tc = rec(params.toolCall);
    const remoteId = str(tc.toolCallId);
    const existing = calls.get(remoteId);
    const action = dialect.extractPermissionAction(params, existing, cwd);

    for (const warning of action.securityWarnings) {
      info(warning, "warning");
    }

    if (action.kind === "question") {
      const cardOptions = action.options
        .map((one) => ({ label: one.label, description: one.label }))
        .slice(0, 4);
      while (cardOptions.length < 2) {
        cardOptions.push({ label: "Cancel", description: "Cancel" });
      }
      dialogs.push({
        kind: "question",
        rpc,
        group: ids.newId("qgr"),
        toolCall: existing?.id ?? ids.newId("tcl"),
        asked: [
          {
            question: action.label,
            header: oneLine(action.label, 24),
            options: cardOptions,
            multiSelect: false,
          },
        ],
        fields: null,
        permission: action.options,
      });
      pumpDialogs();
      return;
    }

    const call = existing ?? (remoteId === "" ? undefined : startCall(tc));
    const refreshedAction =
      call !== existing
        ? dialect.extractPermissionAction(params, call, cwd)
        : action;
    dialogs.push({
      kind: "approval",
      rpc,
      request: ids.newId("apr"),
      call,
      subject:
        refreshedAction.kind === "approval"
          ? refreshedAction.subject
          : action.subject,
      options: action.options,
      alwaysPatterns: action.alwaysPatterns,
    });
    pumpDialogs();
  }

  function onElicitation(rpc: string | number, params: Json): void {
    const props = rec(rec(params.requestedSchema).properties);
    const fields: { key: string; values: Map<string, string> }[] = [];
    const asked: Card[] = [];
    const keys = Object.keys(props)
      .filter((key) => /^q\d+$/.test(key))
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
      .slice(0, 4);

    for (const key of keys) {
      const field = rec(props[key]);
      const values = new Map<string, string>();
      const options = arr(field.oneOf)
        .map(rec)
        .map((one) => ({
          label: str(one.title) || str(one.const),
          value: str(one.const),
        }))
        .slice(0, 4);
      for (const one of options) values.set(one.label, one.value);
      const label = str(field.title) || str(params.message) || "Question";
      const shown = options.map((one) => ({
        label: one.label,
        description: one.label,
      }));
      while (shown.length < 2) {
        shown.push({ label: "Other", description: "Other" });
      }
      asked.push({
        question: label,
        header: oneLine(label, 24),
        options: shown,
        multiSelect: false,
      });
      fields.push({ key, values });
    }

    const call = calls.get(str(params.toolCallId));
    const group = ids.newId("qgr");
    if (asked.length === 0) {
      deps.respondRpc(rpc, { action: "decline" });
      return;
    }
    if (call !== undefined) call.question = { group, asked, answers: [] };
    dialogs.push({
      kind: "question",
      rpc,
      group,
      toolCall: call?.id ?? ids.newId("tcl"),
      asked,
      fields,
      permission: null,
    });
    pumpDialogs();
  }

  function decide(message: Extract<AcpInput, { type: "decide" }>): void {
    const dialog = openDialog;
    if (dialog?.kind !== "approval" || dialog.request !== message.request) {
      return;
    }
    const kind = message.choice.kind;
    if (kind === "session" || kind === "mode") return;
    const want =
      kind === "once"
        ? ["allow_once"]
        : kind === "always"
          ? ["allow_always"]
          : ["reject_once", "reject_always"];
    const option = want
      .map((one) => dialog.options.find((it) => it.kind === one))
      .find((it) => it !== undefined);
    if (option === undefined) {
      deps.respondRpc(dialog.rpc, { outcome: { outcome: "cancelled" } });
      closeDialog(dialog, { approval: "cancelled" });
      return;
    }
    deps.respondRpc(dialog.rpc, {
      outcome: { outcome: "selected", optionId: option.id },
    });
    if (kind === "reject" && dialog.call !== undefined) {
      denied.add(dialog.call.remoteId);
    }
    closeDialog(
      dialog,
      kind === "reject"
        ? { approval: "denied" }
        : {
            approval: "allowed",
            choice: kind === "always" ? "always" : "once",
          },
    );
  }

  function answer(message: Extract<AcpInput, { type: "answer" }>): void {
    const dialog = openDialog;
    if (dialog?.kind !== "question") return;
    const given = message.answers.map((one) =>
      one.status === "answered" ? one.answer : [],
    );
    if (dialog.permission !== null) {
      const label = given[0]?.[0];
      const picked = dialog.permission.find((one) => one.label === label);
      deps.respondRpc(
        dialog.rpc,
        picked === undefined
          ? { outcome: { outcome: "cancelled" } }
          : { outcome: { outcome: "selected", optionId: picked.id } },
      );
      closeDialog(dialog, {
        question: picked === undefined ? "cancelled" : "submitted",
      });
      return;
    }
    const call = [...calls.values()].find(
      (one) => one.question?.group === dialog.group,
    );
    if (call?.question) call.question.answers = given;
    const content: Json = {};
    (dialog.fields ?? []).forEach((field, index) => {
      const reply = given[index] ?? [];
      const label = reply[0];
      const value = label === undefined ? undefined : field.values.get(label);
      if (value !== undefined) content[field.key] = value;
      else if (reply.length > 0)
        content[`${field.key}_other`] = reply.join(", ");
    });
    const answered = Object.keys(content).length > 0;
    deps.respondRpc(
      dialog.rpc,
      answered ? { action: "accept", content } : { action: "decline" },
    );
    closeDialog(dialog, { question: answered ? "submitted" : "cancelled" });
  }

  // --- Read-only Child Inspector projection ---
  function emitChild(childId: string, update: AcpChildUpdate): void {
    emit({ type: "child_update", child: childId, update });
  }

  function matchSubagentCallForChild(
    entry: ChildWorkEntry,
  ): TrackedCall | undefined {
    // 1. Already bound to this exact conversationId.
    for (const call of calls.values()) {
      if (
        call.detail.kind === "subagent" &&
        call.childKey === entry.conversationId
      ) {
        return call;
      }
    }
    const roleLower = entry.role.toLowerCase();
    const typeLower = entry.typeName.toLowerCase();
    // 2. Unbound subagent call whose role/agent name matches entry.role or entry.typeName.
    for (const call of calls.values()) {
      if (call.detail.kind !== "subagent") continue;
      if (call.childKey !== call.remoteId) continue; // already bound to another childId
      const callRole = (call.subagentRole ?? call.detail.agent).toLowerCase();
      if (
        callRole !== "" &&
        (roleLower.includes(callRole) ||
          callRole.includes(roleLower) ||
          (typeLower !== "" && typeLower === callRole))
      ) {
        return call;
      }
    }
    return undefined;
  }

  function projectChildSteps(
    lane: ChildLane,
    steps: readonly ChildTranscriptStep[],
  ): void {
    const fresh = steps.filter((step) => step.stepIndex > lane.lastStepIndex);
    if (fresh.length === 0) return;

    if (lane.turnId === null) {
      const tid = ids.newId("trn");
      lane.turnId = tid;
      emitChild(lane.childId, {
        type: "turn_started",
        turn: tid,
        at: normalizeAt(fresh[0]?.createdAt ?? "", now()),
      });
    }

    for (const step of fresh) {
      lane.lastStepIndex = step.stepIndex;
      const at = normalizeAt(step.createdAt, now());

      if (step.type === "USER_INPUT" || step.source === "USER_EXPLICIT") {
        const text = redactCredentials(stripWrapperTags(step.content ?? ""));
        if (text !== "") {
          emitChild(lane.childId, {
            type: "message_added",
            item: {
              kind: "message",
              id: ids.newId("msg"),
              seq: ++lane.seq,
              at,
              actor: "user",
              sender: null,
              call: null,
              reply_to: null,
              delivery: "next_turn",
              turn: lane.turnId,
              origin: null,
              content: [{ type: "text", text }],
              reasoning: null,
              cards: [],
              complete: true,
            },
          });
        }
        continue;
      }

      if (step.type === "SYSTEM_MESSAGE") {
        const text = redactCredentials(stripWrapperTags(step.content ?? ""));
        if (text !== "") {
          emitChild(lane.childId, {
            type: "message_added",
            item: {
              kind: "message",
              id: ids.newId("msg"),
              seq: ++lane.seq,
              at,
              actor: "received",
              sender: { kind: "program" },
              call: null,
              reply_to: null,
              delivery: "next_turn",
              turn: lane.turnId,
              origin: null,
              content: [{ type: "text", text }],
              reasoning: null,
              cards: [],
              complete: true,
            },
          });
        }
        continue;
      }

      if (step.type === "PLANNER_RESPONSE" || step.source === "MODEL") {
        const text =
          step.content !== null ? redactCredentials(step.content) : "";
        const thinking =
          step.thinking !== null ? redactCredentials(step.thinking) : "";

        if (
          step.type === "PLANNER_RESPONSE" &&
          (text !== "" || thinking !== "")
        ) {
          if (text !== "") lane.lastSummary = oneLine(text, 120);
          emitChild(lane.childId, {
            type: "message_recorded",
            turn: lane.turnId,
            message: ids.newId("msg"),
            model_call: null,
            seq: ++lane.seq,
            at,
            body: {
              content: text === "" ? [] : [{ type: "text", text }],
              reasoning:
                thinking === "" ? null : { text: thinking, duration_ms: null },
              cards: [],
            },
          });
        }

        for (const tc of step.toolCalls) {
          const inputText = redactCredentials(JSON.stringify(tc.args, null, 2));
          emitChild(lane.childId, {
            type: "tool_started",
            item: {
              kind: "tool",
              id: ids.newId("tcl"),
              seq: ++lane.seq,
              at,
              by: "agent",
              turn: lane.turnId,
              tool: tc.name,
              category: "other",
              title: tc.name,
              state: step.status === "ERROR" ? "error" : "ok",
              duration_ms: 0,
              detail: { kind: "generic" },
              body: bodyOf(inputText, null),
            },
          });
        }

        if (
          step.type === "GENERIC" &&
          step.error !== null &&
          step.error !== ""
        ) {
          emitChild(lane.childId, {
            type: "notice_added",
            item: {
              kind: "notice",
              id: ids.newId("msg"),
              seq: ++lane.seq,
              at,
              turn: lane.turnId,
              notice: {
                type: "info",
                text: redactCredentials(step.error),
                level: "warning",
              },
            },
          });
        }
      }
    }
  }

  async function pollChildWorkNow(): Promise<void> {
    if (
      closed ||
      collecting ||
      childPollInFlight ||
      sessionId === "" ||
      dialect.readChildWork === undefined
    ) {
      return;
    }
    childPollInFlight = true;
    try {
      const entries = await dialect.readChildWork(sessionId);
      if (closed || entries === null) return;

      let tasksDirty = false;
      for (const entry of entries) {
        let lane = childLanes.get(entry.conversationId);
        if (lane === undefined) {
          lane = {
            childId: entry.conversationId,
            seq: 0,
            lastStepIndex: -1,
            lastSummary: null,
            turnId: null,
            state: entry.state,
            syntheticToolId: null,
          };
          childLanes.set(entry.conversationId, lane);
        } else {
          lane.state = entry.state;
        }

        // Read & incrementally project child transcript (fail-closed).
        if (dialect.readChildTranscript !== undefined) {
          const steps = await dialect.readChildTranscript(entry.conversationId);
          if (closed) return;
          if (steps !== null) {
            projectChildSteps(lane, steps);
          }
        }

        // End child lane turn when child reaches a terminal state.
        if (entry.state !== "running" && lane.turnId !== null) {
          const tid = lane.turnId;
          lane.turnId = null;
          emitChild(lane.childId, {
            type: "turn_ended",
            turn: tid,
            at: now(),
            outcome:
              entry.state === "error"
                ? "failed"
                : entry.state === "cancelled"
                  ? "stopped"
                  : "completed",
            active_ms: null,
            error: null,
            messages: [],
            seq: ++lane.seq,
          });
        }

        const label = entry.role || entry.typeName || "subagent";
        const detailState = toSubagentDetailState(entry.state);
        const matchedCall = matchSubagentCallForChild(entry);

        if (
          matchedCall !== undefined &&
          matchedCall.detail.kind === "subagent"
        ) {
          const prev = matchedCall.detail;
          matchedCall.childKey = entry.conversationId;
          const nextDetail: AcpToolDetail = {
            ...prev,
            child: entry.conversationId,
            state: matchedCall.done ? prev.state : detailState,
            last: lane.lastSummary ?? prev.last,
          };
          if (
            nextDetail.child !== prev.child ||
            nextDetail.state !== prev.state ||
            nextDetail.last !== prev.last
          ) {
            matchedCall.detail = nextDetail;
            emit({
              type: "tool_detail_changed",
              tool_call: matchedCall.id,
              detail: nextDetail,
            });
          }
          const taskKey = matchedCall.remoteId;
          const nextTaskState = toTaskState(entry.state);
          const existingTask = tasks.get(taskKey);
          if (
            existingTask === undefined ||
            existingTask.state !== nextTaskState
          ) {
            tasks.set(taskKey, {
              id: taskKey,
              kind: "agent",
              description: nextDetail.description || nextDetail.agent,
              state: nextTaskState,
              started_at: existingTask?.started_at ?? matchedCall.startedAt,
              output: lane.lastSummary ?? existingTask?.output ?? null,
            });
            tasksDirty = true;
          }
        } else {
          // Synthetic subagent card for workers without a 1:1 ACP tool call (e.g. swarm n>1).
          const synthDetail: AcpToolDetail = {
            kind: "subagent",
            agent: label,
            description: entry.typeName || label,
            child: entry.conversationId,
            state: detailState,
            model: null,
            last: lane.lastSummary,
          };
          if (lane.syntheticToolId === null) {
            const toolId = ids.newId("tcl");
            lane.syntheticToolId = toolId;
            emit({
              type: "tool_started",
              item: {
                kind: "tool",
                id: toolId,
                seq: ++seq,
                at: now(),
                by: "agent",
                turn: turn,
                tool: "subagent",
                category: "other",
                title: label,
                state:
                  entry.state === "running"
                    ? "running"
                    : entry.state === "error"
                      ? "error"
                      : entry.state === "cancelled"
                        ? "cancelled"
                        : "ok",
                duration_ms: null,
                detail: synthDetail,
                body: null,
              },
            });
          } else {
            emit({
              type: "tool_detail_changed",
              tool_call: lane.syntheticToolId,
              detail: synthDetail,
            });
          }
          const taskKey = `child:${entry.conversationId}`;
          const nextTaskState = toTaskState(entry.state);
          const existingTask = tasks.get(taskKey);
          if (
            existingTask === undefined ||
            existingTask.state !== nextTaskState
          ) {
            tasks.set(taskKey, {
              id: taskKey,
              kind: "agent",
              description: label,
              state: nextTaskState,
              started_at: existingTask?.started_at ?? now(),
              output: lane.lastSummary,
            });
            tasksDirty = true;
          }
        }
      }

      if (tasksDirty) publishTasks();
      if (turn === null && !hasOutlivingRunningTools()) {
        stopChildPolling();
      }
    } catch {
      // Fail-closed: brain read failures must never break dock cards or the session.
    } finally {
      childPollInFlight = false;
    }
  }

  // --- Turn lifecycle ---
  function endTurn(
    outcome: "completed" | "stopped" | "failed",
    error?: { code: string; message: string },
    options?: { forceCancelTools?: boolean },
  ): void {
    if (turn === null) return;
    if (collecting) flushReplayUserText();
    closeStream();
    clearReactiveTimers();
    reactiveHold = false;
    maintenanceActive = false;

    let failure = error ?? null;
    const alerts = warnings;
    warnings = [];
    let result = outcome;
    if (alerts.length > 0) {
      if (outcome === "completed" && !turnWork) {
        result = "failed";
        failure = {
          code: "unavailable",
          message: redactCredentials(
            alerts.map((one) => dialect.formatWarningText(one)).join("\n"),
          ),
        };
      } else {
        for (const text of alerts) {
          info(dialect.formatWarningText(text), "warning");
        }
      }
    }

    cancelDialogs();

    const forceCancel =
      options?.forceCancelTools ??
      (outcome === "stopped" || outcome === "failed");
    for (const call of calls.values()) {
      if (call.done) continue;
      if (forceCancel || !call.outlivesPrompt) {
        endCall(call, { status: forceCancel ? "cancelled" : "completed" });
      }
    }
    if (forceCancel) {
      calls.clear();
    } else {
      // Keep only still-running outliving calls so late tool_call_update updates them in place.
      for (const [key, call] of calls) {
        if (call.done) calls.delete(key);
      }
    }

    const id = turn;
    turn = null;
    cancelling = false;
    emit({
      type: "turn_ended",
      turn: id,
      at: now(),
      outcome: result,
      active_ms: null,
      error: failure,
      messages: [],
      seq: ++seq,
    });

    if (!collecting) {
      void pollChildWorkNow();
      startChildPollingIfNeeded();
      void Promise.resolve().then(flushQueue);
    }
  }

  function addTokens(usage: Json): void {
    if (totals === null) return;
    for (const [key, value] of [
      ["input", usage.inputTokens],
      ["output", usage.outputTokens],
      ["cacheRead", usage.cachedReadTokens],
      ["cacheWrite", usage.cachedWriteTokens],
      ["turns", 1],
    ] as const) {
      if (typeof value === "number") totals[key] = (totals[key] ?? 0) + value;
    }
    publishMetaPart({ usage: usageOf() });
  }

  function handlePromptReply(
    reply: JsonRpcReply,
    remainingOutstanding: number,
    meta: {
      maintenanceCommand?: string;
      steer?: { id: string; content: ContentBlock[]; text: string };
    },
  ): void {
    let failed: string | null = null;
    if (reply.ok) {
      lastStop = str(reply.data.stopReason);
      addTokens(rec(reply.data.usage));
    } else if (meta.steer !== undefined) {
      // Mid-turn steer failure / turn-end race recovery: re-queue at front with the same id
      // so the message is never lost (unless process exited or user explicitly cancelled).
      if (!deps.isProcessExited() && !cancelling) {
        queue.unshift({
          kind: "message",
          id: meta.steer.id,
          content: meta.steer.content,
          text: meta.steer.text,
          alreadyInTimeline: true,
        });
        if (turn === null && remainingOutstanding === 0) {
          void Promise.resolve().then(flushQueue);
        }
      } else {
        info(
          `${dialect.command} did not take the message: ${reply.error}`,
          "warning",
        );
      }
    } else {
      failed = reply.error;
    }

    if (remainingOutstanding > 0 || turn === null) return;

    if (failed !== null) {
      const tailText = deps.stderrTail();
      endTurn("failed", {
        code: deps.isProcessExited() ? "unavailable" : "internal",
        message: `${failed}${deps.isProcessExited() && tailText !== "" ? `\n${tailText}` : ""}`,
      });
      return;
    }

    if (meta.maintenanceCommand !== undefined && !turnWork) {
      notice(
        {
          type: "command_output",
          command: meta.maintenanceCommand,
          text: dialect.formatMaintenanceOutput(
            meta.maintenanceCommand,
            context,
          ),
          format: "markdown",
        },
        true,
      );
    }

    if (cancelling || lastStop === "cancelled") {
      endTurn("stopped", undefined, { forceCancelTools: true });
      return;
    }
    if (lastStop === "refusal") {
      endTurn("failed", {
        code: "forbidden",
        message: `${dialect.command} declined the request.`,
      });
      return;
    }

    // Reactive wakeup deferral (spec 5.1.2):
    // On normal end_turn, if outliving tools/subagents (excluding IsDaemon & recurring cron)
    // are still running, keep them running in the dock and settle via reactive timers.
    if (dialect.reactiveWakeups && hasOutlivingRunningTools()) {
      closeStream();
      for (const call of calls.values()) {
        if (!call.done && call.outlivesPrompt) {
          syncTaskForCall(call, "running", null);
        }
      }
      reactiveHold = true;
      armReactiveTimers();
      void pollChildWorkNow();
      return;
    }

    endTurn("completed", undefined, { forceCancelTools: false });
  }

  // --- Prompt & input handling ---
  const textOf = (content: ContentBlock[]): string =>
    content
      .flatMap((block) =>
        block.type === "text" || block.type === "resource"
          ? [block.text]
          : block.type === "resource_link" &&
              !block.mimeType?.startsWith("image/")
            ? [block.uri.replace(/^file:\/\//, "")]
            : [],
      )
      .join("\n");

  async function blocksOf(
    content: ContentBlock[],
    text: string,
  ): Promise<Json[]> {
    const blocks: Json[] = [];
    for (const block of canImage ? content : []) {
      if (
        block.type !== "resource_link" ||
        !block.mimeType?.startsWith("image/")
      ) {
        continue;
      }
      try {
        const bytes = await deps.readFile(block.uri.replace(/^file:\/\//, ""));
        blocks.push({
          type: "image",
          mimeType: block.mimeType,
          data: Buffer.from(bytes).toString("base64"),
        });
      } catch {
        info(`Could not read the image ${block.name}.`, "warning");
      }
    }
    if (text !== "") blocks.push({ type: "text", text });
    return blocks;
  }

  function dispatchPrompt(
    blocks: readonly Json[],
    meta: {
      maintenanceCommand?: string;
      steer?: { id: string; content: ContentBlock[]; text: string };
    },
  ): void {
    clearReactiveTimers();
    reactiveHold = false;
    void deps
      .getRuntime()
      .sendPrompt(sessionId, blocks)
      .then(({ reply, remainingOutstanding }) =>
        handlePromptReply(reply, remainingOutstanding, meta),
      )
      .catch((error) => info(`prompt failed: ${reason(error)}`, "warning"));
  }

  async function beginUserTurn(one: {
    id: string;
    content: ContentBlock[];
    queued: boolean;
    alreadyInTimeline?: boolean;
  }): Promise<void> {
    const text = textOf(one.content);
    const dead = await deps.ensureAlive();
    const mine = ensureTurn();
    turnText.set(mine, text);
    if (one.alreadyInTimeline) {
      // Already placed in timeline during initial steer attempt; keep same id without duplicating.
    } else if (one.queued) {
      emit({
        type: "message_taken",
        message: one.id,
        seq: ++seq,
        delivery: "next_turn",
        turn: mine,
      });
    } else {
      addMessage(one.id, one.content, { delivery: "next_turn" });
    }
    if (dead !== null) {
      endTurn("failed", { code: "unavailable", message: dead });
      return;
    }
    dispatchPrompt(await blocksOf(one.content, text), {});
  }

  async function beginMaintenanceTurn(
    command: string,
    argument: string,
  ): Promise<void> {
    const dead = await deps.ensureAlive();
    ensureTurn();
    maintenanceActive = true;
    if (dead !== null) {
      endTurn("failed", { code: "unavailable", message: dead });
      return;
    }
    const raw = `/${command}${argument === "" ? "" : ` ${argument}`}`;
    dispatchPrompt([{ type: "text", text: raw }], {
      maintenanceCommand: command,
    });
  }

  async function dispatchSteer(one: {
    id: string;
    content: ContentBlock[];
    text: string;
    fromQueue: boolean;
  }): Promise<void> {
    // Own the message immediately at send time without waiting for user_message_chunk echo.
    closeStream();
    if (one.fromQueue) {
      emit({
        type: "message_taken",
        message: one.id,
        seq: ++seq,
        delivery: "steer",
        turn: turn,
      });
    } else {
      addMessage(one.id, one.content, { delivery: "steer" });
    }
    dispatchPrompt(await blocksOf(one.content, one.text), {
      steer: { id: one.id, content: one.content, text: one.text },
    });
  }

  function flushQueue(): void {
    const runtime = deps.getRuntime();
    if (
      turn !== null ||
      runtime.outstandingPrompts > 0 ||
      cancelling ||
      closed
    ) {
      return;
    }
    const next = queue.shift();
    if (next === undefined) return;
    if (next.kind === "maintenance") {
      emit({ type: "message_removed", message: next.id });
      void beginMaintenanceTurn(next.command, next.argument).catch((error) =>
        info(`command failed: ${reason(error)}`, "warning"),
      );
      return;
    }
    void beginUserTurn({
      id: next.id,
      content: next.content,
      queued: !next.alreadyInTimeline,
      alreadyInTimeline: next.alreadyInTimeline,
    }).catch((error) => info(`send failed: ${reason(error)}`, "warning"));
  }

  function enqueueEntry(entry: QueuedEntry): void {
    queue.push(entry);
    emit({
      type: "message_queued",
      queued: { id: entry.id, at: now(), content: entry.content },
    });
  }

  const isBusy = (): boolean =>
    turn !== null || deps.getRuntime().outstandingPrompts > 0 || cancelling;

  async function handleSlash(
    name: string,
    argument: string,
    source: { id: string; content: ContentBlock[]; rawText: string },
  ): Promise<void> {
    const cls = dialect.classifySlashCommand(
      name,
      advertisedCommands.map((one) => one.name),
    );
    if (cls === "withheld") {
      info(
        `/${name} is blocked in lophn to protect your CLI session.`,
        "warning",
      );
      return;
    }
    if (cls === "local") {
      info("Pick an earlier conversation from the session menu.");
      return;
    }
    if (cls === "maintenance") {
      if (isBusy()) {
        // Maintenance commands are ALWAYS queue-forced during active turns (never steer).
        enqueueEntry({
          kind: "maintenance",
          id: source.id,
          command: name,
          argument,
          content: source.content,
          text: source.rawText,
        });
        return;
      }
      return beginMaintenanceTurn(name, argument);
    }

    // Conversational / Agent command (DEFAULT: /swarm, /plan, /goal, /grill-me,
    // /browser, /schedule, /learn, skills, unknown /...):
    // MUST record as normal user message, send raw text verbatim, and force-queue during active turn.
    if (isBusy()) {
      enqueueEntry({
        kind: "message",
        id: source.id,
        content: source.content,
        text: source.rawText,
      });
      return;
    }
    return beginUserTurn({
      id: source.id,
      content: source.content,
      queued: false,
    });
  }

  async function onSend(
    message: Extract<AcpInput, { type: "send" }>,
  ): Promise<void> {
    const text = textOf(message.content);
    const slash = SLASH.exec(text.trim());
    if (slash?.[1] !== undefined) {
      return handleSlash(slash[1], slash[2]?.trim() ?? "", {
        id: message.id,
        content: message.content,
        rawText: text,
      });
    }

    if (!isBusy()) {
      return beginUserTurn({
        id: message.id,
        content: message.content,
        queued: false,
      });
    }

    if (
      message.delivery === "steer" &&
      supportsSteer() &&
      !cancelling &&
      !maintenanceActive
    ) {
      return dispatchSteer({
        id: message.id,
        content: message.content,
        text,
        fromQueue: false,
      });
    }

    enqueueEntry({
      kind: "message",
      id: message.id,
      content: message.content,
      text,
    });
  }

  function stopTurn(): void {
    if (turn === null || cancelling) return;
    cancelling = true;
    clearReactiveTimers();
    cancelDialogs();
    deps.getRuntime().cancelSession(sessionId);
    // If we were only in a reactive hold (no in-flight session/prompt to reply),
    // finalize immediately as stopped.
    if (reactiveHold && deps.getRuntime().outstandingPrompts === 0) {
      endTurn("stopped", undefined, { forceCancelTools: true });
    }
  }

  async function setModel(
    message: Extract<AcpInput, { type: "set_model" }>,
  ): Promise<void> {
    const set = async (configId: string, value: string): Promise<boolean> => {
      const reply = await deps
        .getRuntime()
        .setConfigOption(sessionId, configId, value);
      if (!reply.ok) {
        info(`Could not change ${configId}: ${reply.error}`, "warning");
        return false;
      }
      applyConfigs(reply.data.configOptions);
      return true;
    };
    if (message.model !== modelNow()) {
      if (!(await set("model", message.model))) return;
      changed.model = true;
    }
    const effort = message.options.effort;
    const thought = cfg("thought_level");
    if (
      effort !== undefined &&
      thought !== undefined &&
      effort !== thought.current &&
      thought.options.some((one) => one.value === effort)
    ) {
      if (await set("thought_level", effort)) changed.thought = true;
    }
    publishMeta();
  }

  async function setMode(mode: string): Promise<void> {
    if (!(cfg("mode")?.options ?? []).some((one) => one.value === mode)) return;
    const reply = await deps.getRuntime().setMode(sessionId, mode);
    if (!reply.ok) {
      info(`Could not change the mode: ${reply.error}`, "warning");
      return;
    }
    const current = cfg("mode");
    if (current !== undefined) current.current = mode;
    changed.mode = true;
    publishMeta();
  }

  function applyConfigs(raw: unknown): void {
    if (!Array.isArray(raw)) return;
    configs = dialect.parseConfigs(raw);
  }

  function unavailable(what: string): void {
    info(
      `${what} is not available over ${dialect.label}'s ACP mode.`,
      "warning",
    );
  }

  // --- Incoming session/update routing ---
  function onSessionUpdate(u: Json, ctx: RuntimeUpdateContext): void {
    const kind = str(u.sessionUpdate);
    switch (kind) {
      case "user_message_chunk": {
        // Echo-independent invariant (spec 3.1):
        // Live user_message_chunk is ALWAYS ignored unconditionally.
        // Only restore user messages during session/load collect replay.
        if (ctx.mode !== "collect") return;
        const content = rec(u.content);
        if (content.type !== "text") return;
        const chunk = str(content.text);
        if (chunk === "") return;
        if (replayUserText !== null) {
          replayUserText += chunk;
        } else {
          if (turn !== null) {
            closeStream();
            endTurn("completed", undefined, { forceCancelTools: false });
          }
          replayUserText = chunk;
        }
        return;
      }
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        if (ctx.mode === "discard") return;
        const content = rec(u.content);
        if (content.type !== "text") return;
        onText(
          kind === "agent_message_chunk" ? "text" : "thought",
          str(content.text),
        );
        return;
      }
      case "tool_call":
      case "tool_call_update": {
        if (ctx.mode === "discard") return;
        onTool(u);
        return;
      }
      case "session_info_update": {
        if (typeof u.title === "string" && u.title.trim() !== "") {
          title = u.title;
          if (ctx.mode === "discard") discardMetaDirty = true;
          else publishMetaPart({ title });
        }
        return;
      }
      case "usage_update": {
        if (typeof u.used === "number" && typeof u.size === "number") {
          context = { used: u.used, size: u.size };
          if (ctx.mode === "discard") discardMetaDirty = true;
          else {
            publishMetaPart({ usage: usageOf() });
            onReactiveUsageUpdate();
          }
        }
        return;
      }
      case "available_commands_update": {
        advertisedCommands = arr(u.availableCommands)
          .map(rec)
          .filter((one) => str(one.name) !== "")
          .map((one) => ({
            name: str(one.name),
            description: str(one.description),
            hint: str(rec(one.input).hint) || null,
          }));
        if (ctx.mode === "discard") discardMetaDirty = true;
        else publishMetaPart({ commands: commandList() });
        return;
      }
      case "config_option_update": {
        applyConfigs(u.configOptions);
        if (ctx.mode === "discard") discardMetaDirty = true;
        else if (!collecting) publishMeta();
        return;
      }
      case "current_mode_update": {
        const mode = cfg("mode");
        if (mode !== undefined) mode.current = str(u.currentModeId);
        if (ctx.mode === "discard") discardMetaDirty = true;
        else publishMetaPart({ mode: modeNow() });
        return;
      }
    }
  }

  return {
    get turnId() {
      return turn;
    },
    get configs() {
      return configs;
    },
    get legacyModels() {
      return legacyModels;
    },
    get changed() {
      return changed;
    },
    isTurnActive: () => turn !== null,
    runningCounts: () => ({
      turn: turn !== null,
      tasks: countRunningTasks(),
    }),
    setAgentMeta(info) {
      agentVersion = info.agentVersion || null;
      canImage = info.canImage;
    },
    setPendingReset() {
      pendingReset = true;
    },
    beginReplay(mode) {
      savedSeqBeforeReplay = seq;
      discardMetaDirty = false;
      replayUserText = null;
      if (mode === "collect") {
        collecting = true;
        collectBuffer = [];
      }
    },
    onSessionOpened({ sessionId: nextId, data, mode, method }) {
      sessionId = nextId;
      applyConfigs(data.configOptions);
      legacyModels = arr(rec(data.models).availableModels).map((one) =>
        str(rec(one).modelId),
      );
      changed = { model: false, thought: false, mode: false };
      if (method === "new") {
        totals = {};
        publishMeta();
      } else if (mode === "collect") {
        // Past token totals are unknown on load.
        totals = null;
      } else {
        discardMetaDirty = true;
      }
    },
    commitReplay(mode) {
      if (mode === "collect") {
        flushReplayUserText();
        closeStream();
        if (turn !== null) {
          endTurn("completed", undefined, { forceCancelTools: false });
        }
        const replayed = collectBuffer;
        collectBuffer = [];
        collecting = false;
        metaReady = true;

        const batch: AcpUpdate[] = [];
        if (pendingReset) {
          batch.push({ type: "session_reset" });
          pendingReset = false;
        }
        batch.push({ type: "session_changed", session: buildMeta() });
        batch.push(...replayed);
        commitAtomic(batch);
      } else {
        // mode === "discard" (revive): preserve existing timeline items, update metadata only if dirty.
        seq = savedSeqBeforeReplay;
        if (discardMetaDirty) {
          discardMetaDirty = false;
          publishMeta();
        }
      }
    },
    abortReplay() {
      collecting = false;
      collectBuffer = [];
      replayUserText = null;
      pendingReset = false;
      seq = savedSeqBeforeReplay;
      turn = null;
      stream = null;
      calls.clear();
    },
    onSessionUpdate,
    onAgentRequest(rpc, method, params) {
      if (method === "session/request_permission") {
        onPermission(rpc, params);
      } else if (method === "elicitation/create") {
        onElicitation(rpc, params);
      } else {
        deps.respondRpcError(rpc, -32601, `${method} is not supported`);
      }
    },
    onCancelRequest(requestId) {
      const target = [openDialog, ...dialogs].find(
        (one) => one?.rpc === requestId,
      );
      if (target !== undefined && target !== null) {
        closeDialog(
          target,
          target.kind === "approval"
            ? { approval: "cancelled" }
            : { question: "cancelled" },
        );
      }
    },
    onProcessExit(code, tailText) {
      if (closed) return;
      const suffix = tailText === "" ? "" : `\n${tailText}`;
      const message = `${dialect.command} exited${code === null ? "" : ` (code ${code})`}.${suffix}`;
      if (turn !== null) {
        endTurn("failed", { code: "unavailable", message });
      } else {
        info(message, "warning");
      }
    },
    async handleInput(message) {
      switch (message.type) {
        case "send":
          return onSend(message);
        case "stop":
          return stopTurn();
        case "retry": {
          const text = turnText.get(message.turn);
          if (text === undefined || isBusy()) return;
          return beginUserTurn({
            id: ids.newId("msg"),
            content: [{ type: "text", text }],
            queued: false,
          });
        }
        case "decide":
          return decide(message);
        case "answer":
          return answer(message);
        case "send_queued": {
          const index = queue.findIndex((one) => one.id === message.message);
          const one = queue[index];
          if (
            one === undefined ||
            turn === null ||
            cancelling ||
            maintenanceActive ||
            !supportsSteer()
          ) {
            return;
          }
          // Slash commands are queue-forced during active turns (spec 4.1).
          if (one.kind === "maintenance" || SLASH.test(one.text.trim())) {
            return;
          }
          queue.splice(index, 1);
          return dispatchSteer({
            id: one.id,
            content: one.content,
            text: one.text,
            fromQueue: true,
          });
        }
        case "remove_queued": {
          const index = queue.findIndex((one) => one.id === message.message);
          if (index < 0) return;
          queue.splice(index, 1);
          emit({ type: "message_removed", message: message.message });
          return;
        }
        case "edit_queued": {
          const one = queue.find((it) => it.id === message.message);
          if (one === undefined) return;
          one.content = message.content;
          one.text = textOf(message.content);
          resendQueue(queue, emit, now());
          return;
        }
        case "move_queued": {
          if (swapQueued(queue, message.message, message.direction) === null) {
            return;
          }
          resendQueue(queue, emit, now());
          return;
        }
        case "set_model":
          return setModel(message);
        case "set_mode":
          return setMode(message.mode);
        case "run_command": {
          const arg = message.argument.trim();
          const rawText = `/${message.name}${arg === "" ? "" : ` ${arg}`}`;
          return handleSlash(message.name, arg, {
            id: ids.newId("msg"),
            content: [{ type: "text", text: rawText }],
            rawText,
          });
        }
        case "compact":
          return handleSlash("compact", "", {
            id: ids.newId("msg"),
            content: [{ type: "text", text: "/compact" }],
            rawText: "/compact",
          });
        case "open_session": {
          if (isBusy()) {
            info(
              "Stop the running turn before opening another conversation.",
              "warning",
            );
            return;
          }
          return deps.switchSession(message.cli_session);
        }
        case "rewind":
          return unavailable("Rewind");
        case "fork":
          return unavailable("Fork");
        case "rename":
          return unavailable("Rename");
        case "stop_child":
        case "steer_child":
          return unavailable("Subagent control");
        case "stop_task":
        case "background_tool":
          return unavailable("Background tasks");
        case "set_toggle":
          return unavailable("Toggles");
        case "set_goal":
          return unavailable("Goal");
        case "run_shell":
        case "stop_shell":
          return unavailable("Shell mode");
        case "use_role":
          return unavailable("Roles");
        case "refresh_usage":
          return;
      }
    },
    async applyInitialConfigs(entries) {
      for (const [configId, value, track] of entries) {
        if (value === undefined) continue;
        const applied = await deps
          .getRuntime()
          .setConfigOption(sessionId, configId, value);
        if (applied.ok) {
          applyConfigs(applied.data.configOptions);
          changed[track] = true;
          publishMeta();
        }
      }
    },
    stopTurn,
    info,
    resetForSessionSwitch() {
      clearReactiveTimers();
      stopChildPolling();
      stream = null;
      calls.clear();
      denied.clear();
      turnText.clear();
      tasks.clear();
      childLanes.clear();
      queue = [];
      dialogs = [];
      openDialog = null;
      warnings = [];
      title = null;
      context = null;
      reactiveHold = false;
      maintenanceActive = false;
    },
    pollChildWorkNow,
    close() {
      closed = true;
      clearReactiveTimers();
      stopChildPolling();
    },
  };
}
