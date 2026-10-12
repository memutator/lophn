import { type Clock, type IdSource, type Result } from "../../../base/mod.ts";
import {
  assignmentRead,
  type CallCost,
  type CompactFailureReason,
  compactSession,
  failSessionCompact,
  finishModelCall,
  finishRewindSummary,
  modelCallList,
  type ModelChoice,
  modelDefaultsRead,
  RUN_BLOB_PURPOSES,
  sessionCompactRequests,
  startModelCall,
  takeRewindSummaryRequest,
  type TokenUsage,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  COMPACT_RESHRINK_MAX,
  compactSummaryRequest,
  inputBudget,
  measureWire,
  type SessionMessage,
  splitSummaryMaterial,
  summaryBodyTokens,
  summaryOutputCap,
  visibleMessages,
} from "../prompt-assembly/mod.ts";
import { estimatedCost } from "../usage/mod.ts";
import { resolveRunAgent } from "../agents/layers.ts";
import { commandOf, type CoreCall, readOf } from "../run-loop/core-call.ts";
import type { ModelBinding } from "../models/binding.ts";
import {
  type BlobPort,
  type RedactText,
  redactValue,
  storeRedacted,
  storeValue,
} from "../run-loop/blobs.ts";
import { readSessionConversation } from "./history.ts";

// 사람이 요청한 Compact를 끝낸다(lophn-agent/conversation, harness/prompt-assemble,
// harness/model). 요청은 core의 읽기로 고르고(끝나지 않은 run이 있는 session의 요청은 나오지
// 않는다), session의 앞 구간을 prompt-assemble의 요약 규칙으로 요약하는 model call을 한 뒤, 끝까지 성공한
// 그 call을 CompactSession으로 잇는다. 요약 call은 run과 agent 대신 session에 묶여 run이 한 번도 없는
// session도 요약한다. 요약 model은 Workspace의 Model for summaries이고 그 칸이 비면 session agent의
// model이다. 요약용 model을 따로 골랐으면 그 실패를 agent model로 바꿔 처리하지 않는다. 어떤 실패든
// 요청만 이유와 함께 닫고 session과 원문은 그대로다.

// 요약 call이 예약하는 출력 크기. 요약 본문 상한(summaryOutputCap)은 최대 4,000 token이라 그만큼 예약한다.
const RESERVED_OUTPUT = 4000;

// 요약 call 하나의 크기다. input은 입력 예산이고 body는 요약 본문 상한(summaryOutputCap(input))이다.
type SummaryLimit = { input: number; body: number };

export type CompactResult =
  | { kind: "idle" }
  | {
    kind: "compacted";
    session: string;
    request: string;
    summary_call: string;
  }
  | {
    kind: "failed";
    session: string;
    request: string;
    reason: CompactFailureReason;
  };

export type RangeSummary =
  | { kind: "idle" }
  | { kind: "summarized"; session: string; summary_call: string }
  | { kind: "failed"; reason: CompactFailureReason };

export type Compactor = {
  // 가장 오래된 열린 요청 하나를 끝낸다. 없으면 idle이다.
  next(): Promise<CompactResult>;
  // 사람이 요청한 "Summarize from here" 하나를 core에서 가져와 요약하고 끝난 call(또는 실패 이유)을 돌려준다.
  // 가져올 요청이 없거나 core에 닿지 못하면 idle이다.
  nextRange(): Promise<RangeSummary>;
};

export type RangeSummarizer = {
  // "Summarize from here"의 요약 call이다. 고른 seq부터의 보이는 대화를 요약해 call을 돌려줄 뿐
  // session을 바꾸지 않는다.
  summarizeFrom(input: {
    session: string;
    assignment: string;
    from_seq: string;
  }): Promise<RangeSummary>;
};

export type CompactorDeps = {
  clock: Clock;
  ids: IdSource;
  // machine 자격의 loopback.
  machine: CoreCall;
  blobs: BlobPort;
  redact: RedactText;
  resolveModel(
    input: { model: ModelChoice; purpose: "organizing" },
  ): Promise<Result<ModelBinding>>;
};

type Request = {
  session: string;
  assignment: string;
  request_seq: string;
};

const EMPTY_USAGE = (revision: string): TokenUsage => ({
  input: null,
  output: null,
  cache_read: null,
  cache_write: null,
  reasoning: null,
  cache_in_input: null,
  reasoning_in_output: null,
  definition_revision: revision,
});

const UNKNOWN_COST: CallCost = {
  kind: "unknown",
  amount: null,
  currency: null,
  basis: null,
  confirmed_at: null,
};

// 한 걸음이 실패한 이유. 요청을 이 이유로 닫는다.
class Failure extends Error {
  readonly reason: CompactFailureReason;

  constructor(reason: CompactFailureReason) {
    super(reason);
    this.reason = reason;
  }
}

export function createCompactor(
  deps: CompactorDeps,
): Compactor & RangeSummarizer {
  const { machine, clock, ids } = deps;

  // 요약 model. 따로 고른 Model for summaries가 먼저이고 비면 그 session agent의 model이다(구성 resolve다).
  async function summaryChoice(request: Request): Promise<ModelChoice | null> {
    const defaults = await readOf(machine, modelDefaultsRead, {});
    if (!defaults.ok) return null;
    if (defaults.value.defaults.summaries !== null) {
      return defaults.value.defaults.summaries;
    }
    const assigned = await readOf(machine, assignmentRead, {
      assignment: request.assignment,
    });
    if (!assigned.ok) return null;
    const made = await resolveRunAgent(machine, {
      run: {
        id: request.session,
        session: request.session,
        source: { kind: "message" },
      },
      assignment: assigned.value.assignment,
      skills: [],
      mcp: () => Promise.resolve([]),
    });
    return made.ok && made.value.kind === "resolved"
      ? made.value.agent.model
      : null;
  }

  async function nextAttempt(session: string): Promise<number | null> {
    const listed = await readOf(machine, modelCallList, { session });
    if (!listed.ok) return null;
    return listed.value.calls.reduce(
      (most, call) =>
        call.run === null ? Math.max(most, call.attempt_order) : most,
      0,
    ) + 1;
  }

  // 요약 call 하나. 시작을 기록한 뒤 보내고 끝을 기록한다. 완전한 답이 아니면 이유와 함께 던진다.
  async function summarizeOnce(
    request: Request,
    binding: ModelBinding,
    limit: SummaryLimit,
    attempt: { order: number },
    input: {
      previous: string | null;
      messages: readonly SessionMessage[];
      shorten?: string;
    },
  ): Promise<{ id: string; text: string }> {
    const prompt = compactSummaryRequest({ ...input, cap: limit.body });
    const packed = binding.pack(prompt);
    if (measureWire(packed) > limit.input) throw new Failure("too_large");
    // 요청은 안전화한 값 하나를 저장하고 그 값을 보낸다. 안전화를 끝내지 못하면 보내지 않는다.
    const safeBody = await redactValue(deps.redact, packed.body);
    if (!safeBody.ok) throw new Failure("model_unavailable");
    const inputBlob = await storeRedacted(
      deps.blobs,
      RUN_BLOB_PURPOSES.model_call_input,
      safeBody.value,
    );
    if (!inputBlob.ok) throw new Failure("model_unavailable");
    const first = input.messages[0];
    const last = input.messages[input.messages.length - 1];
    const basisBlob = await storeValue(
      deps.blobs,
      deps.redact,
      RUN_BLOB_PURPOSES.model_call_basis,
      {
        kind: "compact_summary",
        session: request.session,
        request_seq: request.request_seq,
        shortened: input.shorten !== undefined,
        has_previous: input.previous !== null,
        from_seq: first === undefined ? null : String(first.seq),
        through_seq: last === undefined ? null : String(last.seq),
        measured: measureWire(packed),
        input_budget: limit.input,
      },
    );
    if (!basisBlob.ok) throw new Failure("model_unavailable");

    const id = ids.newId("mcl");
    const order = attempt.order++;
    const call = {
      id,
      run: null,
      session: request.session,
      model_use: "organizing" as const,
      agent_hash: null,
      purpose: "conversation_compression" as const,
      attempt_kind: "initial" as const,
      attempt_order: order,
      retry_of: null,
      model: binding.call,
      input: inputBlob.value.hash,
      context_basis: basisBlob.value.hash,
      output: null,
      state: "started" as const,
      started_at: clock.now(),
      finished_at: null,
      duration_ms: null,
      first_output_ms: null,
      outcome: null,
      usage: EMPTY_USAGE(binding.usageRevision),
      cost: UNKNOWN_COST,
    };
    const started = await commandOf(
      machine,
      startModelCall,
      {
        call,
        applied_messages: [],
        blob_sizes: {
          input: inputBlob.value.size,
          context_basis: basisBlob.value.size,
        },
        state_seq: "1",
      },
      { state_seq: "1" },
      `${id}:start`,
    );
    if (!started.ok) throw new Failure("model_unavailable");

    const invoked = await binding.invoke({
      callId: id,
      run: null,
      session: request.session,
      purpose: "organizing",
      model: binding.call,
      endpoint: binding.endpoint,
      inputHash: inputBlob.value.hash,
      contextBasisHash: basisBlob.value.hash,
      body: safeBody.value as Record<string, unknown>,
      timeoutMs: binding.timeoutMs,
      usageRevision: binding.usageRevision,
    }, new AbortController().signal);
    const output = invoked.ok ? invoked.value : undefined;
    const outcome = output?.outcome ?? {
      kind: "failed" as const,
      code: "credential_unavailable" as const,
      retry_at: null,
      finish_reason: null,
      http_status: null,
      provider_code: null,
    };
    const usage = output?.usage ?? EMPTY_USAGE(binding.usageRevision);
    const price = binding.call.price_basis;
    const charged = price === null ? undefined : estimatedCost(usage, price);
    const cost: CallCost = charged?.amount == null ? UNKNOWN_COST : {
      kind: "estimated",
      amount: charged.amount,
      currency: "USD",
      basis: (charged.rate_basis ?? {}) as Record<string, never>,
      confirmed_at: clock.now(),
    };
    const kept = output !== undefined && output.text.length > 0;
    let outputBlob: { hash: string; size: number } | null = null;
    if (kept || outcome.kind === "partial") {
      const stored = await storeValue(
        deps.blobs,
        deps.redact,
        RUN_BLOB_PURPOSES.model_call_output,
        { text: output?.text ?? "", tools: [] },
      );
      if (!stored.ok) throw new Failure("model_failed");
      outputBlob = stored.value;
    }
    const finished = await commandOf(
      machine,
      finishModelCall,
      {
        call: id,
        output: outputBlob?.hash ?? null,
        ...(outputBlob === null ? {} : { output_size: outputBlob.size }),
        outcome,
        usage,
        cost,
        duration_ms: output?.durationMs ?? null,
        first_output_ms: output?.firstOutputMs ?? null,
        state_seq: "2",
      },
      { state_seq: "1" },
      `${id}:finish`,
    );
    if (!finished.ok) throw new Failure("model_failed");
    if (
      output === undefined || outcome.kind !== "complete" ||
      output.text.trim() === ""
    ) throw new Failure("model_failed");
    return { id, text: output.text };
  }

  // 요약 한 걸음. 본문이 상한을 넘으면 직전 결과를 주고 다시 줄이게 한다(최대 두 번). 잘라 맞추지 않는다.
  async function summarize(
    request: Request,
    binding: ModelBinding,
    limit: SummaryLimit,
    attempt: { order: number },
    input: { previous: string | null; messages: readonly SessionMessage[] },
  ): Promise<{ id: string; text: string }> {
    let done = await summarizeOnce(request, binding, limit, attempt, input);
    for (let again = 0; again < COMPACT_RESHRINK_MAX; again++) {
      if (summaryBodyTokens(done.text) <= limit.body) return done;
      done = await summarizeOnce(request, binding, limit, attempt, {
        previous: null,
        messages: [],
        shorten: done.text,
      });
    }
    if (summaryBodyTokens(done.text) > limit.body) {
      throw new Failure("summary_too_long");
    }
    return done;
  }

  async function fail(
    request: Request,
    reason: CompactFailureReason,
  ): Promise<CompactResult> {
    await commandOf(
      machine,
      failSessionCompact,
      { session: request.session, reason },
      { request_seq: request.request_seq },
      `${request.session}:compact:${request.request_seq}:fail`,
    );
    return {
      kind: "failed",
      session: request.session,
      request: request.request_seq,
      reason,
    };
  }

  // 재료를 Model for summaries로 요약하는 model call을 한다. 재료가 입력 예산 절반을 넘으면 순서를 지킨
  // chunk로 나눠 앞 chunk의 요약을 이어받는다. Compact와 rewind의 "Summarize from here"가 같이 쓴다.
  async function summarizeMaterial(
    request: Request,
    material: readonly SessionMessage[],
    earlier: string | null,
  ): Promise<
    | { kind: "ok"; id: string }
    | { kind: "failed"; reason: CompactFailureReason }
    | { kind: "idle" }
  > {
    const failed = (reason: CompactFailureReason) => ({
      kind: "failed" as const,
      reason,
    });
    const choice = await summaryChoice(request);
    if (choice === null) return failed("model_unavailable");
    const resolved = await deps.resolveModel({
      model: choice,
      purpose: "organizing",
    });
    if (!resolved.ok) return failed("model_unavailable");
    const binding = resolved.value;
    const budget = inputBudget(
      binding.call.limits,
      Math.min(RESERVED_OUTPUT, binding.call.limits.output_limit),
    );
    if (!budget.ok) return failed("too_large");
    const limit: SummaryLimit = {
      input: budget.value,
      body: summaryOutputCap(budget.value),
    };
    // 앞 요약이 들어갈 몫(본문 상한)은 chunk에서 뺀다.
    const cap = Math.floor(limit.input / 2) - limit.body;
    const chunks = cap <= 0 ? null : splitSummaryMaterial(material, cap);
    if (chunks === null) return failed("too_large");
    const attempt = await nextAttempt(request.session);
    if (attempt === null) return { kind: "idle" };
    try {
      let previous = earlier;
      let last: { id: string; text: string } | undefined;
      const counter = { order: attempt };
      for (const chunk of chunks) {
        last = await summarize(request, binding, limit, counter, {
          previous,
          messages: chunk,
        });
        previous = last.text;
      }
      return { kind: "ok", id: last!.id };
    } catch (error) {
      if (error instanceof Failure) return failed(error.reason);
      throw error;
    }
  }

  async function work(request: Request): Promise<CompactResult> {
    const read = await readSessionConversation(machine, {
      session: request.session,
      request: null,
    });
    // 읽지 못한 것은 요약할 수 없는 session이 아니라 지금 닿지 못한 core다. 요청은 열려 있고 다음에 다시 본다.
    if (!read.ok) return { kind: "idle" };
    const conversation = read.value;
    // 숨긴 구간은 요약에 들지 않고 접힌 구간은 그 요약이 자리를 맡는다.
    const material = visibleMessages(conversation);
    if (material.length === 0) {
      return await fail(request, "nothing_to_summarize");
    }
    const summary = await summarizeMaterial(
      request,
      material,
      conversation.compaction?.text ?? null,
    );
    if (summary.kind === "idle") return summary;
    if (summary.kind === "failed") return await fail(request, summary.reason);
    // 요약이 덮는 끝은 확정 메시지여야 한다. 마지막이 접힌 구간 요약이면 그 구간의 마지막 메시지다.
    const lastSeq = material[material.length - 1]!.seq;
    const through = conversation.messages.filter((message) =>
      message.seq <= lastSeq
    ).at(-1)!;
    const ended = await commandOf(
      machine,
      compactSession,
      {
        session: request.session,
        summary_call: summary.id,
        through_seq: String(through.seq),
      },
      { state: "open", request_seq: request.request_seq },
      `${request.session}:compact:${request.request_seq}`,
    );
    // 요약하는 사이 run이 시작됐거나 session이 바뀌어 core가 끝내기를 거절하면 이 요약은 쓰지 않는다.
    if (!ended.ok) return await fail(request, "session_changed");
    return {
      kind: "compacted",
      session: request.session,
      request: request.request_seq,
      summary_call: summary.id,
    };
  }

  // rewind의 "Summarize from here". 고른 메시지부터 지금까지 보이는 대화를 Compact와
  // 같은 요약 call(Model for summaries)로 요약하고 그 call을 돌려준다. session은 아무것도 바뀌지 않고, 요약을
  // 접는 일(Rewind의 summary_call)은 사람이 확정한다. 실패해도 session과 원문은 그대로다.
  async function summarizeFrom(input: {
    session: string;
    assignment: string;
    from_seq: string;
  }): Promise<RangeSummary> {
    const read = await readSessionConversation(machine, {
      session: input.session,
      request: null,
    });
    if (!read.ok) return { kind: "idle" };
    const material = visibleMessages(read.value).filter((message) =>
      message.seq >= BigInt(input.from_seq)
    );
    if (material.length === 0) {
      return { kind: "failed", reason: "nothing_to_summarize" };
    }
    const summary = await summarizeMaterial(
      {
        session: input.session,
        assignment: input.assignment,
        request_seq: input.from_seq,
      },
      material,
      null,
    );
    return summary.kind === "ok"
      ? { kind: "summarized", session: input.session, summary_call: summary.id }
      : summary;
  }

  return {
    async nextRange() {
      const taken = await readOf(machine, takeRewindSummaryRequest, {});
      if (!taken.ok || taken.value.request === null) return { kind: "idle" };
      const request = taken.value.request;
      const summary = await summarizeFrom({
        session: request.session,
        assignment: request.assignment,
        from_seq: request.from_seq,
      });
      // 읽지 못해 idle이면 요청은 가져간 채로 남는다. 사람은 기다리다 다시 요청한다(기한이 있다).
      if (summary.kind === "idle") return summary;
      await readOf(machine, finishRewindSummary, {
        id: request.id,
        result: summary.kind === "summarized"
          ? { kind: "summarized", summary_call: summary.summary_call }
          : { kind: "failed", reason: summary.reason },
      });
      return summary;
    },
    async next() {
      const listed = await readOf(machine, sessionCompactRequests, {});
      if (!listed.ok) return { kind: "idle" };
      const first = listed.value.requests[0];
      if (first === undefined) return { kind: "idle" };
      return await work(first);
    },
    summarizeFrom,
  };
}
