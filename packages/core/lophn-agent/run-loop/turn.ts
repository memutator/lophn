import type { Result } from "../../../base/mod.ts";
import type {
  ViewTab,
  WorkspaceReadOutput,
} from "../../../protocol/shell/mod.ts";
import {
  assemblePrompt,
  type AssembleResult,
  buildTurnContext,
  type HistoryMessage,
  type HistoryPart,
  type PromptAssembly,
  type PromptInput,
  type RenderedMaterial,
  renderMaterial,
  sessionMaterial,
  shrinkMaterial,
  skillInstructionText,
  type TurnContext,
  type TurnContextView,
} from "../prompt-assembly/mod.ts";
import { historyResultPart } from "./history.ts";
import {
  callWithinLimits,
  type ConfirmedFacts,
  type LimitReason,
  limitResult,
  type RunLimiter,
} from "./limits.ts";
import type {
  FinishRequest,
  LoopDeps,
  LoopEnd,
  LoopFailureReason,
  ModelAttempt,
  ModelCallRequest,
  PendingInputs,
  ResumeState,
  RunContext,
  RunInput,
  StopReason,
} from "./ports.ts";
import {
  abortableWait,
  isTransientFailure,
  MODEL_RETRY_MAX,
  modelRetryDelayMs,
} from "./retry.ts";
import {
  awaitAbortable,
  type BatchControl,
  type CallResult,
  type Gate,
  runToolBatch,
} from "./tool-batch.ts";

// turn 하나(requirements lophn-agent/harness/run-loop R9–R11, R23). 순서는 멈춤 확인 → 접수 입력
// 선택 → 한도 검사 → prompt 조립 → 조립 뒤 입력·멈춤 재확인 → model call 하나(완전 응답 확인) →
// tool 묶음 → 결과 기록 → 계속·종료 판정이다. 판단은 model이 하고 이 순서와 확인은 machine이 한다.

export type LoopState = {
  deps: LoopDeps;
  input: RunInput;
  limiter: RunLimiter;
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
  facts: {
    changes: string[];
    unexecuted: string[];
    unknown_effects: string[];
  };
  // 복구·결정 뒤 재개일 때 첫 turn 하나가 쓰는 재료. 쓰고 나면 비운다.
  resume: {
    pending: NonNullable<ResumeState["pending"]> | null;
    retry: ResumeState["retry"];
  };
};

export type TurnResult = { kind: "continue" } | {
  kind: "end";
  end: LoopEnd;
};

const continueTurn: TurnResult = { kind: "continue" };

function endWith(end: LoopEnd): TurnResult {
  return { kind: "end", end };
}

// 진행 호출에 중단을 요청하고 부모 신호가 중단돼도 따라 중단되는 하위 신호를 만든다.
export function linked(parent: AbortSignal): AbortController {
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

// 정리는 machine이 확정한 사실만으로 한다. model을 다시 부르지 않는다(R22).
async function finishWith(
  state: LoopState,
  outcome: FinishRequest["outcome"],
  limit: Record<string, unknown> | null,
  facts?: ConfirmedFacts,
): Promise<TurnResult> {
  const confirmed = facts ?? await confirmedFacts(state);
  const finished = await state.deps.ports.finish({
    outcome,
    facts: confirmed,
    limit,
  });
  if (finished.ok && finished.value.finished) {
    return endWith({ kind: "finished", outcome });
  }
  if (finished.ok) return continueTurn;
  // 사람이 먼저 멈춰 run이 이미 끝났을 수 있다. 그때는 멈춤이 확정 사실이다.
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
    run: state.input.run,
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
  return a.steering.length === b.steering.length &&
    a.steering.every((item, index) => item.id === b.steering[index].id);
}

// ---- 화면 모으기(prompt-assemble turn context) ----

const MAX_VIEW_PAGES = 64;

async function gatherView(
  state: LoopState,
  context: RunContext,
): Promise<TurnContext> {
  const { deps } = state;
  const input = {
    collected_at: deps.clock.now(),
    timezone: context.timezone,
  };
  const redact = { redact: deps.instructions.redact };
  const session = state.input.session;
  if (session === null) {
    return await buildTurnContext(redact, {
      ...input,
      view: { availability: "no_session" },
      tabs: [],
    });
  }
  async function read(page?: number): Promise<Result<WorkspaceReadOutput>> {
    return await deps.ports.view(
      page === undefined ? { session: session! } : { session: session!, page },
    );
  }
  const failed = (): Promise<TurnContext> =>
    buildTurnContext(redact, {
      ...input,
      view: { availability: "collect_failed" } satisfies TurnContextView,
      tabs: [],
    });
  const first = await read();
  if (!first.ok) return await failed();
  if (first.value.availability !== "current") {
    return await buildTurnContext(redact, {
      ...input,
      view: first.value,
      tabs: [],
    });
  }
  const tabs: ViewTab[] = [...(first.value.tab_page ?? [])];
  let next = first.value.next_page;
  for (let pages = 0; next !== undefined; pages++) {
    if (pages >= MAX_VIEW_PAGES) return await failed();
    const page = await read(next);
    if (!page.ok || page.value.availability !== "current") {
      return await failed();
    }
    tabs.push(...(page.value.tab_page ?? []));
    next = page.value.next_page;
  }
  return await buildTurnContext(redact, {
    ...input,
    view: first.value,
    tabs,
  });
}

// ---- prompt 조립 ----

type Prepared = {
  assembly: PromptAssembly;
  inputs: PendingInputs;
};

function blockedEnd(
  state: LoopState,
  reason: Extract<AssembleResult, { status: "blocked" }>["reason"],
): Promise<TurnResult> {
  // 입력이 예산을 넘는 것은 compaction의 몫이고 조립이 막힌 call은 보내지 않는다.
  const overflow = reason === "mandatory_input_overflow" ||
    reason === "input_over_budget";
  return failWith(
    state,
    overflow ? "context_limit" : "configuration_unavailable",
  );
}

async function prepare(
  state: LoopState,
  first: PendingInputs,
): Promise<Prepared | TurnResult> {
  const { deps } = state;
  const promptDeps = { ...deps.instructions, pack: deps.ports.model.pack };
  let inputs = first;
  for (;;) {
    const read = await deps.ports.context();
    if (!read.ok) return await failWith(state, "configuration_unavailable");
    const context = read.value;
    const turn = await gatherView(state, context);
    const options = { collected_at: deps.clock.now() };
    const skills = skillInstructionText(context.skills);
    const conversation = sessionMaterial(context.session);
    const build = (material: RenderedMaterial): PromptInput => ({
      product: context.product,
      role: context.role === null ? null : {
        instructions: skills === null
          ? context.role.instructions
          : `${context.role.instructions}\n\n${skills}`,
      },
      tools: context.tools,
      work: context.work,
      material: {
        purpose: context.purpose,
        run_facts: context.run_facts,
        compact_summary: conversation.compact_summary,
        materials: material.materials,
        compaction_summary: null,
        history: [...conversation.history, ...state.history],
        request: inputs.request,
        steering: inputs.steering.map((item) => item.text),
      },
      turn_context: turn.text,
      evidence: {
        references: material.references,
        omissions: material.omissions,
        turn_context: turn.basis,
      },
      limits: context.limits,
      reserved_output: context.reserved_output,
    });
    let rendered = await renderMaterial(context.sources, options);
    let assembled = await assemblePrompt(promptDeps, build(rendered));
    if (
      assembled.status === "blocked" && assembled.reason === "input_over_budget"
    ) {
      rendered = await shrinkMaterial(
        context.sources,
        options,
        async (candidate) =>
          (await assemblePrompt(promptDeps, build(candidate))).status ===
            "ready",
      );
      assembled = await assemblePrompt(promptDeps, build(rendered));
    }
    if (assembled.status === "blocked") {
      return await blockedEnd(state, assembled.reason);
    }
    // 오래 조립하는 사이 도착한 멈춤과 수정 입력을 놓치지 않는다(R9).
    const reason = await stopped(state);
    if (reason !== null) return stoppedEnd(reason);
    const again = await deps.ports.inputs();
    if (!again.ok) return await failWith(state, "configuration_unavailable");
    if (sameSteering(inputs, again.value)) {
      return { assembly: assembled.assembly, inputs };
    }
    inputs = again.value;
  }
}

// ---- 시작 직전 확인 ----

function makeGate(state: LoopState, applied: ReadonlySet<string>): Gate {
  return async (server) => {
    if (await stopped(state) !== null) return "stopped";
    if (state.limiter.check() !== null) return "limit_reached";
    if (
      state.flags.providerRevoked ||
      (server !== null && state.flags.revokedServers.has(server))
    ) return "configuration_revoked";
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
  const body = deps.ports.model.pack(prepared.assembly.request)
    .body as Record<string, unknown>;
  let previous: string | null = null;
  let retries = 0;
  // 재시작 뒤 retry 대기를 잇는다. 예정 시각은 처음부터 다시 재지 않고 남은 간격만 기다리며 쓴 횟수는
  // 그대로다(R7).
  const resumed = state.resume.retry;
  state.resume.retry = null;
  if (resumed !== null) {
    previous = resumed.previous;
    retries = resumed.retries;
    if (retries >= MODEL_RETRY_MAX) {
      // 재시도를 다 쓴 실패다. 한도를 새로 주지 않고 같은 이유로 끝낸다.
      return { kind: "end", end: await failWith(state, "model_error") };
    }
    const at = resumed.retry_at === null ? null : Date.parse(resumed.retry_at);
    const remaining = at === null || Number.isNaN(at)
      ? 0
      : Math.max(0, at - Date.parse(deps.clock.now()));
    if (remaining > 0) {
      const how = await deps.wait(remaining, state.control.signal);
      if (how === "aborted") {
        return { kind: "end", end: await abortEnd(state) };
      }
    }
    const reason = await stopped(state);
    if (reason !== null) return { kind: "end", end: stoppedEnd(reason) };
    if (!(await deps.ports.model.available()) || state.flags.providerRevoked) {
      return {
        kind: "end",
        end: await failWith(state, "configuration_unavailable"),
      };
    }
  }
  for (;;) {
    const request: ModelCallRequest = {
      assembly: prepared.assembly,
      body,
      applied: previous === null
        ? prepared.inputs.steering.map((s) => s.id)
        : [],
      kind: previous === null ? "initial" : "retry",
      retry_of: previous,
    };
    const guarded = await callWithinLimits<
      Awaited<ReturnType<typeof awaitAbortable<Result<ModelAttempt>>>>
    >(limiter, "judgment", async () => {
      const call = linked(state.control.signal);
      state.modelCalls.add(call);
      // 진행 없는 시간·전체 시간 한도에 닿으면 이 호출을 중단한다(R20, R21).
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
    if (!isTransientFailure(outcome) || retries >= MODEL_RETRY_MAX) {
      return {
        kind: "end",
        end: await failWith(state, failureReason(outcome.code)),
      };
    }
    // 일시 실패만 같은 입력으로 다시 보낸다. 서버 최소 시각을 지킨다(R23).
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

async function resultPart(
  state: LoopState,
  result: CallResult,
): Promise<HistoryPart> {
  return await historyResultPart(state.deps.clock.now(), result);
}

function record(state: LoopState, results: readonly CallResult[]): void {
  const { facts } = state;
  for (const result of results) {
    const call = result.tool_call ?? `${result.key}:unconfirmed`;
    const info = state.deps.ports.tools.info(result.name);
    if (
      result.status === "success" && info !== undefined &&
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
  // 복구·결정 뒤 재개: 이미 받은 완전한 응답의 남은 일부터 잇는다. model을 다시 부르지 않는다(R8).
  const pending = state.resume.pending;
  if (pending !== null) {
    state.resume.pending = null;
    return await afterModel(state, pending.attempt, new Set(), pending);
  }
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
  const steering = prepared.inputs.steering.map((item) => item.text);
  if (steering.length > 0) {
    appendUser(state, steering.map((text) => ({ kind: "text", text })));
  }
  if (step.kind === "restart") return continueTurn;
  const attempt = step.attempt;
  if (step.kind === "partial") {
    // 불완전한 응답의 tool은 하나도 시작하지 않고 잘림 사실만 다음 판단에 전한다(R11).
    const why = attempt.outcome.finish_reason ?? "unknown";
    appendUser(state, [{
      kind: "text",
      text:
        `[machine] The previous response was cut off (${why}). None of its tool calls were started. Continue from what is confirmed.`,
    }]);
    await ports.checkpoint(limiter.snapshot());
    return continueTurn;
  }
  return await afterModel(
    state,
    attempt,
    new Set(prepared.inputs.steering.map((item) => item.id)),
    null,
  );
}

// 완전한 응답 하나를 처리한다: 답이면 기록·종료 판정, tool이면 묶음 실행·결과 기록. resumed가 있으면
// 이미 확정한 결과는 다시 부르지 않는다.
async function afterModel(
  state: LoopState,
  attempt: ModelAttempt,
  applied: ReadonlySet<string>,
  resumed: ResumeState["pending"],
): Promise<TurnResult> {
  const { deps, limiter } = state;
  const ports = deps.ports;
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
    ...(resumed === null ? {} : {
      confirmed: new Map(resumed.confirmed.map((item) => [item.key, item])),
      started: new Map(Object.entries(resumed.started)),
    }),
  };
  const batch = await runToolBatch(control, attempt.toolCalls);
  // 8. 결과 영속 기록은 call마다 끝났다. 이력과 사실을 잇는다.
  const parts: HistoryPart[] = [];
  if (attempt.text.trim() !== "") {
    parts.push({ kind: "text", text: attempt.text });
  }
  for (const result of batch.results) {
    parts.push({
      kind: "tool_use",
      id: result.key,
      name: result.name,
      input: result.input,
    });
  }
  state.history.push({ role: "assistant", parts });
  const answers: HistoryPart[] = [];
  for (const result of batch.results) {
    answers.push(await resultPart(state, result));
  }
  state.history.push({ role: "user", parts: answers });
  record(state, batch.results);
  // 확정한 tool 결과는 진행이다(R21).
  if (batch.results.some((result) => result.entries > 0)) limiter.toolResult();
  await ports.checkpoint(limiter.snapshot());
  // 9. 계속·종료 판정
  if (batch.waiting !== null) {
    const waited = await ports.wait(batch.waiting);
    if (!waited.ok) return await failWith(state, "configuration_unavailable");
    limiter.enterWait();
    await ports.checkpoint(limiter.snapshot());
    return endWith({ kind: "waiting", ...batch.waiting });
  }
  return continueTurn;
}

// tool 없는 완전한 답. 미반영 steering이 있으면 종료하지 않고 새 판단으로 간다(R14).
async function conclude(
  state: LoopState,
  text: string,
  applied: ReadonlySet<string>,
): Promise<TurnResult> {
  const { deps } = state;
  const pending = await deps.ports.inputs();
  const fresh = pending.ok &&
    pending.value.steering.some((item) => !applied.has(item.id));
  if (!fresh) {
    const answered = await deps.ports.answer(text);
    if (!answered.ok) return await failWith(state, "configuration_unavailable");
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
