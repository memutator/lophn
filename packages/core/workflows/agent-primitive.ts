import { type Clock, ERROR_CODES, type ErrorCode } from "../../base/mod.ts";
import type { Id, JsonValue } from "../../protocol/base/mod.ts";
import type {
  AgentAddress,
  PermissionMode,
  TurnOutcome,
} from "../../protocol/lophn-agent/mod.ts";
import type {
  FlowAgentMode,
  SessionChoice,
  SessionOpenMode,
  WorkflowOrigin,
  WorkflowOutcomeReason,
  WorkflowSoftOutput,
} from "../../protocol/workflows/mod.ts";

// 열린 outgoing agent_calls가 모두 닫힌 뒤 새 turn이 시작되는지 기다리는 짧은 유예 시간(ms).
export const DEFAULT_SETTLEMENT_GRACE_MS = 500;

export type WorkflowOutcome<T> =
  | { ok: true; result: T }
  | {
      ok: false;
      reason: WorkflowOutcomeReason;
      message: string;
      session?: Id<"ses">;
    };

export type AgentTurnEndedStatus = "completed" | "failed" | "stopped";

export type AgentTurnEndedEvent = {
  session: Id<"ses">;
  turn?: Id<"trn">;
  status: AgentTurnEndedStatus;
  errorReason?: WorkflowOutcomeReason;
  errorMessage?: string;
  lastAssistantText?: string | null;
};

export type AgentTurnStartedEvent = {
  session: Id<"ses">;
  turn?: Id<"trn">;
};

export type AgentCallsSettledEvent = {
  session: Id<"ses">;
  call?: Id<"cal">;
  state?: "done" | "failed" | "cancelled";
  failReason?: string | null;
};

export type AgentReportEvent = {
  instance: Id<"wfi">;
  step: string;
  session: Id<"ses">;
  summary: string;
  refs?: string[];
  data?: unknown;
};

export type AgentStalledInfo = {
  origin: WorkflowOrigin;
  session: Id<"ses">;
  at: string;
  reason?: WorkflowOutcomeReason;
  message?: string;
};

export type AgentHandOffInput = {
  agent: AgentAddress;
  prompt: string;
  input?: JsonValue;
  schema?: Record<string, JsonValue>;
  // undefined면 새 session을 열고, 값이 있으면 그 session을 이어 쓴다.
  session?: Id<"ses">;
  // 넘길 때마다 sessions.workflow_origin에 기록·갱신한다.
  origin: WorkflowOrigin;
  mode: FlowAgentMode;
  human: boolean;
  open?: SessionOpenMode;
  permissionMode?: PermissionMode;
};

export type AgentHandOffResult =
  | { ok: true; session: Id<"ses">; turn?: Id<"trn"> | null }
  | {
      ok: false;
      reason: WorkflowOutcomeReason;
      message: string;
      session?: Id<"ses">;
    };

export type AgentRemoteHandOffInput = {
  on: string;
  agent: AgentAddress;
  prompt: string;
  input?: JsonValue;
  schema?: Record<string, JsonValue>;
  mode: FlowAgentMode;
  session?: SessionChoice | Id<"ses">;
  sameSession?: Id<"ses"> | null;
  origin: WorkflowOrigin;
  signal?: AbortSignal;
};

export type AgentPrimitiveTimers = {
  set(fn: () => void, ms: number): unknown;
  clear(handle: unknown): void;
};

export const systemAgentTimers: AgentPrimitiveTimers = {
  set(fn, ms) {
    const handle = setTimeout(fn, ms);
    if (
      typeof handle === "object" &&
      handle !== null &&
      "unref" in handle &&
      typeof (handle as { unref?: () => void }).unref === "function"
    ) {
      (handle as { unref: () => void }).unref();
    }
    return handle;
  },
  clear(handle) {
    clearTimeout(handle as ReturnType<typeof setTimeout>);
  },
};

// 다른 feature module을 직접 import하지 않고 wiring/workflows.ts와 engine이 주입하는 port 계약이다.
export type AgentPrimitivePorts = {
  handOff(input: AgentHandOffInput): Promise<AgentHandOffResult>;
  handOffRemote?(
    input: AgentRemoteHandOffInput,
  ): Promise<WorkflowOutcome<WorkflowSoftOutput>>;
  openOutgoingCalls(session: Id<"ses">): number | Promise<number>;
  subscribeTurnEnded(fn: (event: AgentTurnEndedEvent) => void): () => void;
  subscribeCallsSettled(
    fn: (event: AgentCallsSettledEvent) => void,
  ): () => void;
  subscribeReport(fn: (event: AgentReportEvent) => void): () => void;
  // 선택: follow-up turn 시작을 바로 감지하면 긴 후속 turn 중 grace window 오탐을 막는다.
  subscribeTurnStarted?(fn: (event: AgentTurnStartedEvent) => void): () => void;
  // 선택: grace window 만료 직전 실행 중인 turn 유무를 재확인한다.
  isTurnRunning?(session: Id<"ses">): boolean | Promise<boolean>;
  // 선택: 다음 turn을 열 미소비 입력이 대기 중인지 확인한다.
  hasPendingMessages?(session: Id<"ses">): boolean | Promise<boolean>;
  stopSession(session: Id<"ses">): void | Promise<void>;
  onStalled?(info: AgentStalledInfo): void | Promise<void>;
  clock: Clock;
  timers?: AgentPrimitiveTimers;
  settlementGraceMs?: number;
};

export type AgentPrimitiveRequest = {
  agent: AgentAddress;
  prompt: string;
  input?: JsonValue;
  schema?: Record<string, JsonValue>;
  mode?: FlowAgentMode;
  // "new"(기본), "same"(sameSession 재사용), 또는 명시적 session id.
  session?: SessionChoice | Id<"ses">;
  // session === "same"일 때 재사용할 기존 session id.
  sameSession?: Id<"ses"> | null;
  origin: WorkflowOrigin;
  // 다른 컴퓨터의 참가자. 지정되면 handOffRemote 경로로 위임한다.
  on?: string;
  // 사람 step은 stall 판정에서 제외한다.
  human?: boolean;
  // session을 탭으로 열지 background로 돌릴지. 없으면 agent 정의와 기본 규칙을 따른다.
  open?: SessionOpenMode;
  // participant에 고정된 권한 단계(lophn/custom participant만).
  permissionMode?: PermissionMode;
  // mode: "report"에서 stall이 났을 때 stalled Outcome으로 바로 끝낼지(true), report/cancel을 계속 기다릴지(false, 기본).
  stalledResolves?: boolean;
  signal?: AbortSignal;
  settlementGraceMs?: number;
};

const BOUNDARY_ERROR_CODES: ReadonlySet<string> = new Set(ERROR_CODES);

// TurnOutcome과 선택적 경계 error code를 WorkflowOutcomeReason으로 정확히 매핑한다(모든 실패를 model_error로 뭉개지 않는다).
export function mapTurnOutcomeToReason(
  outcome: TurnOutcome,
  errorCodeHint?: string | null,
): WorkflowOutcomeReason {
  if (outcome.kind === "interrupted") {
    return outcome.reason === "user_stopped" ? "cancelled" : "interrupted";
  }
  if (outcome.kind === "failed") {
    if (
      errorCodeHint !== undefined &&
      errorCodeHint !== null &&
      BOUNDARY_ERROR_CODES.has(errorCodeHint)
    ) {
      return errorCodeHint as ErrorCode;
    }
    switch (outcome.reason) {
      case "model_error":
      case "context_limit":
      case "model_attempt_limit":
      case "no_answer":
        return "model_error";
      case "stall_limit":
        return "stalled";
      case "target_unavailable":
      case "configuration_unavailable":
      case "model_required":
      case "clock_uncertain":
        return "unavailable";
      case "internal":
      case "tool_error":
      case "repeated_tool_failure":
      case "effect_unknown":
      case "active_limit":
        return "internal";
    }
  }
  return "internal";
}

function abortMessage(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  if (reason instanceof Error && reason.message !== "") return reason.message;
  if (typeof reason === "string" && reason !== "") return reason;
  return "cancelled";
}

function resolveReuseSession(
  choice: SessionChoice | Id<"ses"> | undefined,
  sameSession: Id<"ses"> | null | undefined,
): Id<"ses"> | undefined {
  if (choice === undefined || choice === "new") return undefined;
  if (choice === "same") return sameSession ?? undefined;
  return choice;
}

function failedOutcome(
  reason: WorkflowOutcomeReason,
  message: string,
  session?: Id<"ses">,
): WorkflowOutcome<WorkflowSoftOutput> {
  return session === undefined
    ? { ok: false, reason, message }
    : { ok: false, reason, message, session };
}

function runRemote(
  ports: AgentPrimitivePorts,
  req: AgentPrimitiveRequest,
  mode: FlowAgentMode,
): Promise<WorkflowOutcome<WorkflowSoftOutput>> {
  const signal = req.signal;
  if (signal?.aborted) {
    return Promise.resolve(failedOutcome("cancelled", abortMessage(signal)));
  }
  if (ports.handOffRemote === undefined) {
    return Promise.resolve(
      failedOutcome("unavailable", "remote agent handoff is not configured"),
    );
  }
  const remoteInput: AgentRemoteHandOffInput = {
    on: req.on!,
    agent: req.agent,
    prompt: req.prompt,
    ...(req.input !== undefined ? { input: req.input } : {}),
    ...(req.schema !== undefined ? { schema: req.schema } : {}),
    mode,
    ...(req.session !== undefined ? { session: req.session } : {}),
    ...(req.sameSession !== undefined ? { sameSession: req.sameSession } : {}),
    origin: req.origin,
    ...(signal !== undefined ? { signal } : {}),
  };
  return new Promise<WorkflowOutcome<WorkflowSoftOutput>>((resolve) => {
    let settled = false;
    const finish = (outcome: WorkflowOutcome<WorkflowSoftOutput>) => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      resolve(outcome);
    };
    const onAbort = () => {
      finish(failedOutcome("cancelled", abortMessage(signal!)));
    };
    if (signal !== undefined) {
      signal.addEventListener("abort", onAbort, { once: true });
    }
    let promise: Promise<WorkflowOutcome<WorkflowSoftOutput>>;
    try {
      promise = ports.handOffRemote!(remoteInput);
    } catch (e) {
      finish(
        failedOutcome("internal", e instanceof Error ? e.message : String(e)),
      );
      return;
    }
    promise.then(
      (outcome) => finish(outcome),
      (e) =>
        finish(
          failedOutcome("internal", e instanceof Error ? e.message : String(e)),
        ),
    );
  });
}

// 통합 agent() 실행 primitive:
// - mode: "turn" — turn 완료 시 열린 outgoing agent_calls가 0이면 마지막 assistant 응답 반환,
//   열린 call이 남아 있으면 정산 대기(모두 닫힌 뒤 grace window 안에 후속 turn이 없으면 stalled).
// - mode: "report" — 명시적 workflow.report 도착 시 완료, report 없이 turn이 끝나고 열린 call이 0이면
//   attempt당 최대 1회 onStalled 호출(human step 제외).
// - AbortSignal — stopSession 호출, listener·timer 정리 후 cancelled 반환.
// - on: <machine> — handOffRemote로 원격 위임.
export function runAgentPrimitive(
  ports: AgentPrimitivePorts,
  req: AgentPrimitiveRequest,
): Promise<WorkflowOutcome<WorkflowSoftOutput>> {
  const mode: FlowAgentMode = req.mode ?? "turn";
  if (req.on !== undefined) {
    return runRemote(ports, req, mode);
  }

  const signal = req.signal;
  if (signal?.aborted) {
    return Promise.resolve(failedOutcome("cancelled", abortMessage(signal)));
  }

  const timers = ports.timers ?? systemAgentTimers;
  const graceMs =
    req.settlementGraceMs ??
    ports.settlementGraceMs ??
    DEFAULT_SETTLEMENT_GRACE_MS;
  const human = req.human === true;
  const reuseSession = resolveReuseSession(req.session, req.sameSession);

  return new Promise<WorkflowOutcome<WorkflowSoftOutput>>((resolve) => {
    let settled = false;
    let activeSession: Id<"ses"> | null = null;
    let handOffPending = true;
    let turnActive = true;
    let awaitingOutgoingCalls = false;
    let stalledNotified = false;
    let callsSettledSeq = 0;
    let graceHandle: unknown = null;
    let graceDeadlineMs: number | null = null;

    type BufferedEvent =
      | { kind: "turn_started"; event: AgentTurnStartedEvent }
      | { kind: "turn_ended"; event: AgentTurnEndedEvent }
      | { kind: "calls_settled"; event: AgentCallsSettledEvent }
      | { kind: "report"; event: AgentReportEvent };
    const buffered: BufferedEvent[] = [];
    const unsubs: Array<() => void> = [];

    function clearGraceTimer(): void {
      if (graceHandle !== null) {
        timers.clear(graceHandle);
        graceHandle = null;
        graceDeadlineMs = null;
      }
    }

    function finish(outcome: WorkflowOutcome<WorkflowSoftOutput>): void {
      if (settled) return;
      settled = true;
      clearGraceTimer();
      signal?.removeEventListener("abort", onAbort);
      for (const unsub of unsubs.splice(0)) {
        try {
          unsub();
        } catch {
          // 정리 중 개별 unsubscribe 실패가 결과 반환을 막지 않는다.
        }
      }
      resolve(outcome);
    }

    async function readOpenCalls(session: Id<"ses">): Promise<number | null> {
      try {
        return await ports.openOutgoingCalls(session);
      } catch (e) {
        finish(
          failedOutcome(
            "internal",
            e instanceof Error ? e.message : String(e),
            session,
          ),
        );
        return null;
      }
    }

    async function notifyStallOnce(
      session: Id<"ses">,
      reason: WorkflowOutcomeReason,
      message: string,
    ): Promise<void> {
      if (settled || human || stalledNotified) return;
      stalledNotified = true;
      if (ports.onStalled !== undefined) {
        try {
          await ports.onStalled({
            origin: req.origin,
            session,
            at: ports.clock.now(),
            reason,
            message,
          });
        } catch {
          // stall hook 오류가 primitive 정리를 깨뜨리지 않는다.
        }
      }
      if (!settled && req.stalledResolves === true) {
        finish(failedOutcome("stalled", message, session));
      }
    }

    function scheduleSettlementGrace(session: Id<"ses">): void {
      if (settled || turnActive || !awaitingOutgoingCalls) return;
      clearGraceTimer();
      const scheduledAt = ports.clock.nowMs();
      graceDeadlineMs = scheduledAt + graceMs;
      graceHandle = timers.set(() => {
        graceHandle = null;
        void onGraceExpired(session, graceDeadlineMs);
      }, graceMs);
    }

    async function onGraceExpired(
      session: Id<"ses">,
      expectedDeadline: number | null,
    ): Promise<void> {
      if (settled || turnActive || !awaitingOutgoingCalls) return;
      if (graceDeadlineMs !== expectedDeadline) return;
      graceDeadlineMs = null;

      const open = await readOpenCalls(session);
      if (open === null || settled || turnActive || !awaitingOutgoingCalls) {
        return;
      }
      if (open > 0) return;

      if (ports.isTurnRunning !== undefined) {
        try {
          if (await ports.isTurnRunning(session)) {
            turnActive = true;
            return;
          }
        } catch {
          // 상태 조회 실패는 아래 stall 판정으로 넘긴다.
        }
      }
      if (settled || turnActive || !awaitingOutgoingCalls) return;
      awaitingOutgoingCalls = false;

      const message =
        "all outgoing agent calls settled without a follow-up turn";
      if (mode === "turn") {
        finish(failedOutcome("stalled", message, session));
      } else {
        await notifyStallOnce(session, "stalled", message);
      }
    }

    function handleTurnStarted(event: AgentTurnStartedEvent): void {
      if (
        settled ||
        activeSession === null ||
        event.session !== activeSession
      ) {
        return;
      }
      turnActive = true;
      stalledNotified = false;
      clearGraceTimer();
    }

    async function handleTurnEnded(event: AgentTurnEndedEvent): Promise<void> {
      if (
        settled ||
        activeSession === null ||
        event.session !== activeSession
      ) {
        return;
      }
      const session = activeSession;
      turnActive = false;
      clearGraceTimer();

      const checkFollowUp = async (): Promise<
        "running" | "pending" | "none"
      > => {
        if (ports.hasPendingMessages !== undefined) {
          try {
            if (await ports.hasPendingMessages(session)) return "pending";
          } catch {
            // 조회 실패는 아래 판정으로 넘긴다.
          }
        }
        if (ports.isTurnRunning !== undefined) {
          try {
            if (await ports.isTurnRunning(session)) return "running";
          } catch {
            // 조회 실패는 아래 판정으로 넘긴다.
          }
        }
        return "none";
      };

      if (mode === "turn") {
        if (event.status === "failed") {
          const reason = event.errorReason ?? "model_error";
          const message =
            event.errorMessage !== undefined && event.errorMessage !== ""
              ? event.errorMessage
              : reason;
          finish(failedOutcome(reason, message, session));
          return;
        }
        if (event.status === "stopped") {
          const reason = event.errorReason ?? "cancelled";
          const message =
            event.errorMessage !== undefined && event.errorMessage !== ""
              ? event.errorMessage
              : "turn stopped";
          finish(failedOutcome(reason, message, session));
          return;
        }
        const seqBefore = callsSettledSeq;
        const open = await readOpenCalls(session);
        if (open === null || settled || turnActive) return;
        if (open === 0) {
          const followUp = await checkFollowUp();
          if (settled || turnActive) return;
          if (followUp === "running") {
            turnActive = true;
            return;
          }
          if (followUp === "pending") {
            awaitingOutgoingCalls = true;
            scheduleSettlementGrace(session);
            return;
          }
          finish({
            ok: true,
            result: { summary: event.lastAssistantText ?? "" },
          });
          return;
        }
        awaitingOutgoingCalls = true;
        // openOutgoingCalls 조회 중 call 정산 event가 지나갔으면 한 번 더 확인한다.
        if (callsSettledSeq !== seqBefore) {
          await handleCallsSettled({ session });
        }
        return;
      }

      // mode === "report": 명시적 workflow.report만 성공으로 본다. 사람 step은 stall 판정에서 제외한다.
      if (human) return;
      const seqBefore = callsSettledSeq;
      const open = await readOpenCalls(session);
      if (open === null || settled || turnActive) return;
      if (open > 0) {
        awaitingOutgoingCalls = true;
        if (callsSettledSeq !== seqBefore) {
          await handleCallsSettled({ session });
        }
        return;
      }
      const followUp = await checkFollowUp();
      if (settled || turnActive) return;
      if (followUp === "running") {
        turnActive = true;
        return;
      }
      if (followUp === "pending") {
        awaitingOutgoingCalls = true;
        scheduleSettlementGrace(session);
        return;
      }
      awaitingOutgoingCalls = false;
      const stallReason: WorkflowOutcomeReason =
        event.status === "failed"
          ? (event.errorReason ?? "model_error")
          : event.status === "stopped"
            ? (event.errorReason ?? "cancelled")
            : "stalled";
      const stallMessage =
        event.errorMessage !== undefined && event.errorMessage !== ""
          ? event.errorMessage
          : event.status === "completed"
            ? "turn ended without workflow.report"
            : stallReason;
      await notifyStallOnce(session, stallReason, stallMessage);
    }

    async function handleCallsSettled(
      event: AgentCallsSettledEvent,
    ): Promise<void> {
      if (
        settled ||
        activeSession === null ||
        event.session !== activeSession
      ) {
        return;
      }
      callsSettledSeq += 1;
      if (!awaitingOutgoingCalls || turnActive) return;
      const session = activeSession;
      const open = await readOpenCalls(session);
      if (open === null || settled || turnActive || !awaitingOutgoingCalls) {
        return;
      }
      if (open === 0) {
        scheduleSettlementGrace(session);
      }
    }

    function handleReport(event: AgentReportEvent): void {
      if (settled || activeSession === null) return;
      if (mode !== "report") return;
      if (
        event.instance !== req.origin.instance ||
        event.step !== req.origin.step ||
        event.session !== activeSession
      ) {
        return;
      }
      const result: WorkflowSoftOutput = {
        summary: event.summary,
        ...(event.refs !== undefined ? { refs: event.refs } : {}),
        ...(event.data !== undefined ? { data: event.data } : {}),
      };
      finish({ ok: true, result });
    }

    const onAbort = () => {
      if (settled) return;
      const sessionToStop = activeSession ?? reuseSession;
      const message = abortMessage(signal!);
      const stopPromise =
        sessionToStop === undefined
          ? Promise.resolve()
          : Promise.resolve()
              .then(() => ports.stopSession(sessionToStop))
              .catch(() => {});
      // listener·timer를 즉시 정리하고 stopSession 완료를 기다린 뒤 cancelled로 끝낸다.
      clearGraceTimer();
      signal?.removeEventListener("abort", onAbort);
      for (const unsub of unsubs.splice(0)) {
        try {
          unsub();
        } catch {
          // ignore cleanup failure
        }
      }
      void stopPromise.then(() => {
        finish(failedOutcome("cancelled", message, sessionToStop));
      });
    };

    if (signal !== undefined) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    // handOff 이전에 구독을 걸어 handOff 도중 동기/즉시 도착하는 event를 놓치지 않는다.
    if (ports.subscribeTurnStarted !== undefined) {
      unsubs.push(
        ports.subscribeTurnStarted((event) => {
          if (settled) return;
          if (handOffPending) {
            buffered.push({ kind: "turn_started", event });
            return;
          }
          handleTurnStarted(event);
        }),
      );
    }
    unsubs.push(
      ports.subscribeTurnEnded((event) => {
        if (settled) return;
        if (handOffPending) {
          buffered.push({ kind: "turn_ended", event });
          return;
        }
        void handleTurnEnded(event);
      }),
    );
    unsubs.push(
      ports.subscribeCallsSettled((event) => {
        if (settled) return;
        if (handOffPending) {
          buffered.push({ kind: "calls_settled", event });
          return;
        }
        void handleCallsSettled(event);
      }),
    );
    unsubs.push(
      ports.subscribeReport((event) => {
        if (settled) return;
        if (handOffPending) {
          buffered.push({ kind: "report", event });
          return;
        }
        handleReport(event);
      }),
    );

    const handOffInput: AgentHandOffInput = {
      agent: req.agent,
      prompt: req.prompt,
      ...(req.input !== undefined ? { input: req.input } : {}),
      ...(req.schema !== undefined ? { schema: req.schema } : {}),
      ...(reuseSession !== undefined ? { session: reuseSession } : {}),
      origin: req.origin,
      mode,
      human,
      ...(req.open !== undefined ? { open: req.open } : {}),
      ...(req.permissionMode !== undefined
        ? { permissionMode: req.permissionMode }
        : {}),
    };

    void Promise.resolve()
      .then(() => ports.handOff(handOffInput))
      .then(
        async (handed) => {
          handOffPending = false;
          if (settled) {
            // cancel과 handOff가 겹쳐 뒤늦게 session이 열렸으면 turn이 남지 않게 stopSession을 부른다.
            if (handed.ok && handed.session !== reuseSession) {
              try {
                await ports.stopSession(handed.session);
              } catch {
                // ignore
              }
            }
            return;
          }
          if (!handed.ok) {
            finish(
              failedOutcome(handed.reason, handed.message, handed.session),
            );
            return;
          }
          activeSession = handed.session;
          for (const item of buffered.splice(0)) {
            if (settled) break;
            switch (item.kind) {
              case "turn_started":
                handleTurnStarted(item.event);
                break;
              case "turn_ended":
                await handleTurnEnded(item.event);
                break;
              case "calls_settled":
                await handleCallsSettled(item.event);
                break;
              case "report":
                handleReport(item.event);
                break;
            }
          }
        },
        (e) => {
          handOffPending = false;
          finish(
            failedOutcome(
              "internal",
              e instanceof Error ? e.message : String(e),
              reuseSession,
            ),
          );
        },
      );
  });
}
