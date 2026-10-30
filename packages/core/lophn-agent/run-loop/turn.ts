import type { Result } from "../../../base/mod.ts";
import {
  assembleTurnPrompt,
  estimateTokens,
  type HistoryMessage,
  type HistoryPart,
  type PromptAnchor,
  sessionMaterial,
  textTokens,
  type TurnPromptResult,
  type WireSize,
} from "../prompt-assembly/mod.ts";
import {
  historyResultParts,
  KEEP_IMAGES,
  omitOldImages,
  omitOldToolResults,
} from "./history.ts";
import {
  callWithinLimits,
  type ConfirmedFacts,
  type LimitReason,
  limitResult,
  type TurnLimiter,
} from "./limits.ts";
import type {
  FinishRequest,
  LoopDeps,
  LoopEnd,
  LoopFailureReason,
  ModelAttempt,
  ModelCallRequest,
  Pause,
  PendingInputs,
  StopReason,
  TurnContext,
  TurnInput,
} from "./ports.ts";
import { inputText } from "./input-text.ts";
import {
  abortableWait,
  isTransientFailure,
  MODEL_RETRY_MAX,
  modelRetryDelayMs,
  PARTIAL_RUN_MAX,
} from "./retry.ts";
import {
  awaitAbortable,
  type BatchControl,
  type CallResult,
  type Gate,
  runToolBatch,
} from "./tool-batch.ts";

// turn 하나. 순서는 멈춤 확인 → 접수 입력
// 선택 → 한도 검사 → prompt 조립 → 조립 뒤 입력·멈춤 재확인 → model call 하나(완전 응답 확인) → 응답 저장 →
// tool 묶음 → 결과 기록 → 계속·종료 판정이다. 판단은 model이 하고 이 순서와 확인은 machine이 한다.

export type LoopState = {
  deps: LoopDeps;
  input: TurnInput;
  limiter: TurnLimiter;
  // 사람의 결정을 기다리는 동안 turn의 시간을 세지 않는다.
  pause: Pause;
  // 멈춤·설정 회수 때 모든 진행 호출에 중단을 요청하는 신호.
  control: AbortController;
  flags: {
    stop: StopReason | null;
    providerRevoked: boolean;
    revokedServers: Set<string>;
  };
  // model call마다 중단 신호가 따로 있어 provider 회수가 진행 중인 call만 취소할 수 있다.
  modelCalls: Set<AbortController>;
  serverCalls: Map<string, Set<AbortController>>;
  history: HistoryMessage[];
  // 연속으로 받은 partial 응답 수. 완전한 응답이 오면 0이 된다.
  partialRun: number;
  // 앞 call의 실제 prompt token과 그때의 크기. 다음 call의 입력 예산을 여기서 잰다. 이력을 줄이면 버린다.
  anchor: PromptAnchor | null;
  // 이전 대화(session 이력)가 차지하는 token 추정. 첫 조립에서 한 번 잰다.
  sessionTokens: number | null;
  // 이 turn 첫 call의 prompt token과 그때의 이전 대화 token 추정.
  opening: { tokens: number; session: number } | null;
  // provider가 입력이 너무 크다고 거절해 이력을 줄이고 다시 보낸 수.
  overflowRecoveries: number;
  // 다음 turn을 시작하기 전에 이 session을 Compact한다.
  compactNext: boolean;
  facts: {
    changes: string[];
    unexecuted: string[];
    unknown_effects: string[];
  };
};

type TurnResult =
  | { kind: "continue" }
  | {
      kind: "end";
      end: LoopEnd;
    };

const continueTurn: TurnResult = { kind: "continue" };

function endWith(end: LoopEnd): TurnResult {
  return { kind: "end", end };
}

// 진행 호출에 중단을 요청하고 부모 신호가 중단돼도 따라 중단되는 하위 신호를 만든다.
function linked(parent: AbortSignal): AbortController {
  const child = new AbortController();
  if (parent.aborted) child.abort();
  else parent.addEventListener("abort", () => child.abort(), { once: true });
  return child;
}

async function stopped(state: LoopState): Promise<StopReason | null> {
  if (state.flags.stop !== null) return state.flags.stop;
  const check = await state.deps.ports.stop();
  if (!check.stopped) return null;
  state.flags.stop = check.reason;
  state.control.abort();
  return check.reason;
}

function stoppedEnd(reason: StopReason): TurnResult {
  return endWith({ kind: "stopped", reason });
}

async function confirmedFacts(state: LoopState): Promise<ConfirmedFacts> {
  const pending = await state.deps.ports.inputs();
  return {
    changes: [...state.facts.changes],
    unexecuted: [...state.facts.unexecuted],
    unknown_effects: [...state.facts.unknown_effects],
    unapplied_inputs: pending.ok ? pending.value.steering.map((s) => s.id) : [],
  };
}

// 정리는 machine이 확정한 사실만으로 한다. model을 다시 부르지 않는다.
async function finishWith(
  state: LoopState,
  outcome: FinishRequest["outcome"],
  limit: Record<string, unknown> | null,
  facts?: ConfirmedFacts,
): Promise<TurnResult> {
  const confirmed = facts ?? (await confirmedFacts(state));
  // 끝난 순간까지의 active를 `TurnEnded`가 싣게 한다. 마지막 checkpoint 뒤에 흐른 시간이 빠지지 않게 한다.
  await state.deps.ports.checkpoint(state.limiter.snapshot());
  const finished = await state.deps.ports.finish({
    outcome,
    facts: confirmed,
    limit,
  });
  if (finished.ok && finished.value.finished) {
    return endWith({ kind: "finished", outcome });
  }
  if (finished.ok) return continueTurn;
  // 사람이 먼저 멈춰 turn이 이미 끝났을 수 있다. 그때는 멈춤이 확정 사실이다.
  const reason = await stopped(state);
  if (reason !== null) return stoppedEnd(reason);
  return endWith({ kind: "finish_failed", outcome, error: finished.error });
}

function failWith(
  state: LoopState,
  reason: LoopFailureReason,
): Promise<TurnResult> {
  return finishWith(state, { kind: "failed", reason }, null);
}

async function limitEnd(
  state: LoopState,
  reason: LimitReason,
): Promise<TurnResult> {
  const facts = await confirmedFacts(state);
  const result = limitResult({
    turn: state.input.turn,
    reason,
    elapsed: state.limiter.snapshot(),
    attempts: state.limiter.attempts,
    limits: state.input.limits,
    confirmed: facts,
  });
  return await finishWith(state, result.outcome, result.facts, facts);
}

// 진행 호출이 중단돼 돌아왔을 때 왜 중단했는지로 끝낸다.
async function abortEnd(state: LoopState): Promise<TurnResult> {
  const reason = await stopped(state);
  if (reason !== null) return stoppedEnd(reason);
  if (state.flags.providerRevoked) {
    return await failWith(state, "configuration_unavailable");
  }
  const limit = state.limiter.check();
  if (limit !== null) return await limitEnd(state, limit);
  return await failWith(state, "model_error");
}

function sameSteering(a: PendingInputs, b: PendingInputs): boolean {
  return (
    a.steering.length === b.steering.length &&
    a.steering.every((item, index) => item.id === b.steering[index].id)
  );
}

// ---- prompt 조립 ----

type Prepared = {
  prompt: Extract<TurnPromptResult, { status: "ready" }>;
  inputs: PendingInputs;
};

// 조립 뒤 추정이 예산의 SHRINK_AT을 넘으면 turn 안 이력을 SHRINK_TO 아래로 줄인다. 한 번에 넉넉히 줄여
// 줄일 때마다 나는 cache miss를 드물게 한다.
const SHRINK_AT = 0.85;
const SHRINK_TO = 0.6;
// 첫 call이 예산의 COMPACT_AT보다 크고 그 가운데 이전 대화가 COMPACT_SESSION_SHARE 이상이면 다음 turn 전에
// Compact한다. 이전 대화는 turn 안에서 줄일 수 없고, 남은 몫이 turn 안 tool loop의 자리다.
const COMPACT_AT = 0.5;
const COMPACT_SESSION_SHARE = 0.2;
// provider가 입력이 크다고 거절했을 때 이력을 줄여 다시 보내는 최대 수.
const OVERFLOW_RECOVERY_MAX = 2;

// turn 안 이력의 오래된 tool 결과를 줄여 이 요청을 target token 아래로 내린다. 줄인 것이 없으면 false다.
function shrinkHistory(
  state: LoopState,
  size: WireSize,
  measured: number,
  target: number,
): boolean {
  const need = Math.max(estimateTokens(size), measured) - target;
  if (need <= 0) return false;
  const shrunk = omitOldToolResults(state.history, need);
  if (shrunk.freed === 0) return false;
  state.history = shrunk.history;
  // 줄인 뒤 크기는 다음 call의 실제 token이 올 때까지 크기로만 센다.
  state.anchor = null;
  return true;
}

// 이전 대화(Compact 요약 포함)가 차지하는 token 추정이다.
function sessionTokens(context: TurnContext): number {
  const material = sessionMaterial(context.session);
  let tokens =
    material.compact_summary === null
      ? 0
      : textTokens(material.compact_summary);
  for (const message of material.history) {
    for (const part of message.parts) {
      if (part.kind === "text" || part.kind === "tool_result") {
        tokens += textTokens(part.text);
      }
    }
  }
  return tokens;
}

function blockedEnd(
  state: LoopState,
  reason: Extract<TurnPromptResult, { status: "blocked" }>["reason"],
): Promise<TurnResult> {
  // turn 안에서 더 줄일 것이 없다. 다음 turn 전에 이전 대화를 Compact하고, 이 call은 보내지 않는다.
  if (reason === "input_over_budget") state.compactNext = true;
  return failWith(
    state,
    reason === "input_over_budget"
      ? "context_limit"
      : "configuration_unavailable",
  );
}

// 같은 쪽이 이어 말한 것은 한 message의 조각이다.
function pushHistory(
  messages: HistoryMessage[],
  role: HistoryMessage["role"],
  parts: readonly HistoryPart[],
): void {
  const last = messages[messages.length - 1];
  if (last !== undefined && last.role === role) {
    messages[messages.length - 1] = { role, parts: [...last.parts, ...parts] };
  } else messages.push({ role, parts });
}

const SUMMARY_HEADING =
  "Summary of the earlier part of this conversation, written when the person compacted it:";

// 이전 대화(Compact 요약 포함), 이 turn의 요청, 이 turn에서 쌓은 이력, 아직 반영하지 않은 steering과 notice 순이다.
function historyOf(
  state: LoopState,
  context: TurnContext,
  inputs: PendingInputs,
): HistoryMessage[] {
  const messages: HistoryMessage[] = [];
  const conversation = sessionMaterial(context.session);
  if (conversation.compact_summary !== null) {
    pushHistory(messages, "user", [
      {
        kind: "text",
        text: `${SUMMARY_HEADING}\n${conversation.compact_summary}`,
      },
    ]);
  }
  for (const message of conversation.history) {
    pushHistory(messages, message.role, message.parts);
  }
  if (inputs.request !== null) {
    pushHistory(messages, "user", [{ kind: "text", text: inputs.request }]);
  }
  for (const message of omitOldImages(state.history, KEEP_IMAGES)) {
    pushHistory(messages, message.role, message.parts);
  }
  const tail = [
    ...inputs.steering.map((item) => inputText(item.input)),
    ...context.notices,
  ];
  if (tail.length > 0) {
    pushHistory(
      messages,
      "user",
      tail.map((text) => ({ kind: "text", text })),
    );
  }
  return messages;
}

async function prepare(
  state: LoopState,
  first: PendingInputs,
): Promise<Prepared | TurnResult> {
  const { deps } = state;
  let inputs = first;
  for (;;) {
    const read = await deps.ports.context();
    if (!read.ok) return await failWith(state, "configuration_unavailable");
    const context = read.value;
    const assembled = await assembleTurnPrompt(
      {
        ...context.prompt,
        history: historyOf(state, context, inputs),
        anchor: state.anchor,
      },
      { pack: deps.ports.model.pack },
    );
    if (assembled.status === "blocked") {
      const over = assembled.over;
      if (
        over !== undefined &&
        shrinkHistory(
          state,
          over.size,
          over.measured_tokens,
          Math.floor(over.input_budget * SHRINK_TO),
        )
      ) {
        continue;
      }
      return await blockedEnd(state, assembled.reason);
    }
    if (
      assembled.measured_tokens > assembled.input_budget * SHRINK_AT &&
      shrinkHistory(
        state,
        assembled.size,
        assembled.measured_tokens,
        Math.floor(assembled.input_budget * SHRINK_TO),
      )
    ) {
      continue;
    }
    state.sessionTokens ??= sessionTokens(context);
    context.keep(assembled.basis);
    // 오래 조립하는 사이 도착한 멈춤과 수정 입력을 놓치지 않는다.
    const reason = await stopped(state);
    if (reason !== null) return stoppedEnd(reason);
    const again = await deps.ports.inputs();
    if (!again.ok) return await failWith(state, "configuration_unavailable");
    if (sameSteering(inputs, again.value)) return { prompt: assembled, inputs };
    inputs = again.value;
  }
}

// ---- 시작 직전 확인 ----

function makeGate(state: LoopState, applied: ReadonlySet<string>): Gate {
  return async (server) => {
    if ((await stopped(state)) !== null) return "stopped";
    if (state.limiter.check() !== null) return "limit_reached";
    if (
      state.flags.providerRevoked ||
      (server !== null && state.flags.revokedServers.has(server))
    )
      return "configuration_revoked";
    const pending = await state.deps.ports.inputs();
    if (pending.ok && pending.value.steering.some((s) => !applied.has(s.id))) {
      return "superseded";
    }
    return null;
  };
}

// ---- model call ----

type ModelStep =
  | { kind: "complete"; attempt: ModelAttempt }
  | { kind: "partial"; attempt: ModelAttempt }
  // 새 입력이 와서 retry를 취소했다. 다음 turn이 새 입력으로 다시 조립한다.
  | { kind: "restart" }
  // provider가 입력이 context보다 크다고 거절했다.
  | { kind: "overflow" }
  | { kind: "end"; end: TurnResult };

function failureReason(code: string | null): LoopFailureReason {
  if (code === "context_exceeded") return "context_limit";
  if (code === "credential_unavailable" || code === "model_unavailable") {
    return "configuration_unavailable";
  }
  return "model_error";
}

async function callModel(
  state: LoopState,
  prepared: Prepared,
): Promise<ModelStep> {
  const { deps, limiter } = state;
  const body = deps.ports.model.pack(prepared.prompt.request).body as Record<
    string,
    unknown
  >;
  let previous: string | null = null;
  let retries = 0;
  for (;;) {
    const request: ModelCallRequest = {
      prompt: prepared.prompt,
      body,
      applied:
        previous === null ? prepared.inputs.steering.map((s) => s.id) : [],
      kind: previous === null ? "initial" : "retry",
      retry_of: previous,
    };
    const guarded = await callWithinLimits<
      Awaited<ReturnType<typeof awaitAbortable<Result<ModelAttempt>>>>
    >(limiter, "judgment", async () => {
      const call = linked(state.control.signal);
      state.modelCalls.add(call);
      // 진행 없는 시간·전체 시간 한도에 닿으면 이 호출을 중단한다.
      const deadline = limiter.nextDeadlineMs();
      if (deadline !== null) {
        void (deps.deadline ?? abortableWait)(deadline, call.signal).then(
          (how) => {
            if (how === "elapsed") call.abort();
          },
        );
      }
      try {
        return await awaitAbortable(
          deps.ports.model.call(request, call.signal),
          call.signal,
          { wait: deps.wait, graceMs: deps.abortGraceMs ?? 5000 },
        );
      } finally {
        call.abort();
        state.modelCalls.delete(call);
      }
    });
    if (!guarded.called) {
      return { kind: "end", end: await limitEnd(state, guarded.limit) };
    }
    const settled = guarded.value;
    if (!settled.done) {
      limiter.endAttempt("cancelled");
      return { kind: "end", end: await abortEnd(state) };
    }
    if (!settled.value.ok) {
      limiter.endAttempt("failed");
      return {
        kind: "end",
        end: await failWith(state, "configuration_unavailable"),
      };
    }
    const attempt = settled.value.value;
    const outcome = attempt.outcome;
    if (outcome.kind === "complete") {
      limiter.endAttempt("complete");
      return { kind: "complete", attempt };
    }
    if (outcome.kind === "partial") {
      limiter.endAttempt("partial");
      return { kind: "partial", attempt };
    }
    if (outcome.kind === "cancelled") {
      limiter.endAttempt("cancelled");
      return { kind: "end", end: await abortEnd(state) };
    }
    limiter.endAttempt("failed");
    if (outcome.code === "context_exceeded") return { kind: "overflow" };
    if (!isTransientFailure(outcome) || retries >= MODEL_RETRY_MAX) {
      return {
        kind: "end",
        end: await failWith(state, failureReason(outcome.code)),
      };
    }
    // 일시 실패만 같은 입력으로 다시 보낸다. 서버 최소 시각을 지킨다.
    retries += 1;
    const delay = modelRetryDelayMs(
      retries,
      outcome.retry_at,
      deps.clock.nowMs(),
    );
    const how = await deps.wait(delay, state.control.signal);
    if (how === "aborted") {
      return { kind: "end", end: await abortEnd(state) };
    }
    // 예정 retry는 멈춤·새 입력·설정 회수·한도에서 취소한다.
    const reason = await stopped(state);
    if (reason !== null) return { kind: "end", end: stoppedEnd(reason) };
    if (!(await deps.ports.model.available()) || state.flags.providerRevoked) {
      return {
        kind: "end",
        end: await failWith(state, "configuration_unavailable"),
      };
    }
    const again = await deps.ports.inputs();
    if (again.ok && !sameSteering(prepared.inputs, again.value)) {
      return { kind: "restart" };
    }
    previous = attempt.id;
  }
}

// ---- history ----

function appendUser(state: LoopState, parts: HistoryPart[]): void {
  const last = state.history[state.history.length - 1];
  if (last !== undefined && last.role === "user") {
    state.history[state.history.length - 1] = {
      role: "user",
      parts: [...last.parts, ...parts],
    };
  } else state.history.push({ role: "user", parts });
}

function record(state: LoopState, results: readonly CallResult[]): void {
  const { facts } = state;
  for (const result of results) {
    const call = result.tool_call ?? `${result.key}:unconfirmed`;
    const info = state.deps.ports.tools.info(result.name);
    if (
      result.status === "success" &&
      info !== undefined &&
      info.effect !== "read"
    ) {
      facts.changes.push(call);
    } else if (result.status === "not_executed") facts.unexecuted.push(call);
    else if (result.status === "uncertain") facts.unknown_effects.push(call);
  }
}

// ---- turn ----

export async function runTurn(state: LoopState): Promise<TurnResult> {
  const { deps, limiter } = state;
  const ports = deps.ports;
  // 1. 멈춤 확인
  const reason = await stopped(state);
  if (reason !== null) return stoppedEnd(reason);
  // 2. 접수 입력 선택
  const picked = await ports.inputs();
  if (!picked.ok) return await failWith(state, "configuration_unavailable");
  // 3. 한도 검사. 사람 기다림 중에는 loop가 돌지 않는다(대기 시간은 limiter가 빼고 센다).
  const limit = limiter.check();
  if (limit !== null) return await limitEnd(state, limit);
  if (state.flags.providerRevoked || !(await ports.model.available())) {
    return await failWith(state, "configuration_unavailable");
  }
  // 4–5. prompt 조립과 조립 뒤 재확인. 막히면 model을 부르지 않는다.
  const prepared = await prepare(state, picked.value);
  if ("kind" in prepared) return prepared;
  // 6. model call 하나와 완전 응답 확인
  const step = await callModel(state, prepared);
  if (step.kind === "end") return step.end;
  // 보낸 steering은 이 call에 반영됐다. 이후 이력에서 이어진다.
  const steering = prepared.inputs.steering.map((item) =>
    inputText(item.input),
  );
  if (steering.length > 0) {
    appendUser(
      state,
      steering.map((text) => ({ kind: "text", text })),
    );
  }
  if (step.kind === "restart") return continueTurn;
  if (step.kind === "overflow") return await afterOverflow(state, prepared);
  const attempt = step.attempt;
  noteUsage(state, prepared, attempt);
  if (step.kind === "partial") {
    state.partialRun += 1;
    if (state.partialRun >= PARTIAL_RUN_MAX) {
      return await failWith(state, "model_error");
    }
    // 불완전한 응답의 tool은 하나도 시작하지 않고 잘림 사실만 다음 판단에 전한다.
    const why = attempt.outcome.finish_reason ?? "unknown";
    appendUser(state, [
      {
        kind: "text",
        text: `[machine] The previous response was cut off (${why}). None of its tool calls were started. Continue from what is confirmed.`,
      },
    ]);
    await ports.checkpoint(limiter.snapshot());
    return continueTurn;
  }
  state.partialRun = 0;
  return await afterModel(
    state,
    attempt,
    new Set(prepared.inputs.steering.map((item) => item.id)),
  );
}

// 받은 응답의 실제 prompt token을 다음 call의 기준으로 둔다. 첫 call이면 다음 turn 전에 Compact할지 정한다.
function noteUsage(
  state: LoopState,
  prepared: Prepared,
  attempt: ModelAttempt,
): void {
  const prompt = prepared.prompt;
  if (attempt.promptTokens !== undefined) {
    state.anchor = { tokens: attempt.promptTokens, ...prompt.size };
  }
  if (state.opening !== null) return;
  state.opening = {
    tokens: attempt.promptTokens ?? prompt.measured_tokens,
    session: state.sessionTokens ?? 0,
  };
  if (
    state.opening.tokens > prompt.input_budget * COMPACT_AT &&
    state.opening.session >= prompt.input_budget * COMPACT_SESSION_SHARE
  ) {
    state.compactNext = true;
  }
}

// provider가 입력이 크다고 거절했다. 추정이 실제보다 작았다는 뜻이라 보낸 크기의 SHRINK_TO 아래로 줄여 다시
// 보낸다. 줄일 것이 없으면 다음 turn 전에 Compact하게 두고 끝낸다.
async function afterOverflow(
  state: LoopState,
  prepared: Prepared,
): Promise<TurnResult> {
  const prompt = prepared.prompt;
  if (state.overflowRecoveries < OVERFLOW_RECOVERY_MAX) {
    const target = Math.floor(
      Math.min(prompt.input_budget, prompt.measured_tokens) * SHRINK_TO,
    );
    if (shrinkHistory(state, prompt.size, prompt.measured_tokens, target)) {
      state.overflowRecoveries += 1;
      return continueTurn;
    }
  }
  state.compactNext = true;
  return await failWith(state, "context_limit");
}

// 완전한 응답 하나를 처리한다: 응답을 그 응답의 agent message로 남기고, tool이면 묶음 실행·결과 기록, 답이면
// 종료 판정이다.
async function afterModel(
  state: LoopState,
  attempt: ModelAttempt,
  applied: ReadonlySet<string>,
): Promise<TurnResult> {
  const { deps, limiter } = state;
  const ports = deps.ports;
  // 마지막 응답(tool call이 없는 것)은 글이 비어도 남긴다. run의 답이 그 message의 글이라서다. 중간 응답은
  // 사람이 볼 글이 있을 때만 남긴다.
  if (attempt.toolCalls.length === 0 || attempt.text.trim() !== "") {
    const answered = await ports.answer(attempt.text);
    if (!answered.ok) return await failWith(state, "configuration_unavailable");
  }
  if (attempt.toolCalls.length === 0) {
    return await conclude(state, attempt.text, applied);
  }
  // 7. tool 묶음
  const control: BatchControl = {
    tools: ports.tools,
    modelCall: attempt.id,
    gate: makeGate(state, applied),
    signalFor(server) {
      const call = linked(state.control.signal);
      if (server !== null) {
        const set = state.serverCalls.get(server) ?? new Set();
        set.add(call);
        state.serverCalls.set(server, set);
        if (state.flags.revokedServers.has(server)) call.abort();
      }
      return {
        signal: call.signal,
        release() {
          if (server !== null) state.serverCalls.get(server)?.delete(call);
        },
      };
    },
    wait: deps.wait,
    random: deps.random,
    graceMs: deps.abortGraceMs ?? 5000,
    pause: state.pause,
  };
  const batch = await runToolBatch(control, attempt.toolCalls);
  // 8. 결과 영속 기록은 call마다 끝났다. 이력과 사실을 잇는다.
  const parts: HistoryPart[] = [];
  if (attempt.text.trim() !== "") {
    parts.push({ kind: "text", text: attempt.text });
  }
  // tool_use는 model이 보낸 그대로다. tool_result 짝과 provider의 호출 검사가 그 이름·입력을 본다.
  for (const result of batch.results) {
    parts.push({
      kind: "tool_use",
      id: result.key,
      name: result.called.name,
      input: result.called.input,
      ...(result.called.signature === undefined
        ? {}
        : { signature: result.called.signature }),
    });
  }
  state.history.push({ role: "assistant", parts });
  const answers: HistoryPart[] = [];
  for (const result of batch.results) {
    answers.push(...historyResultParts(result));
  }
  state.history.push({ role: "user", parts: answers });
  record(state, batch.results);
  // 확정한 tool 결과는 진행이다.
  if (batch.results.some((result) => result.entries > 0)) limiter.toolResult();
  await ports.checkpoint(limiter.snapshot());
  // 9. 계속·종료 판정은 다음 걸음이 한다.
  return continueTurn;
}

// tool 없는 완전한 답. 그 응답의 글은 afterModel이 이미 남겼다. 미반영 steering이 있으면 종료하지 않고 새
// 판단으로 간다.
async function conclude(
  state: LoopState,
  text: string,
  applied: ReadonlySet<string>,
): Promise<TurnResult> {
  const { deps } = state;
  const pending = await deps.ports.inputs();
  const fresh =
    pending.ok && pending.value.steering.some((item) => !applied.has(item.id));
  if (!fresh) {
    const finished = await finishWith(
      state,
      { kind: "completed", reason: "answer_completed" },
      null,
    );
    if (finished.kind === "end") return finished;
  }
  if (text.trim() !== "") {
    state.history.push({ role: "assistant", parts: [{ kind: "text", text }] });
  }
  return continueTurn;
}
