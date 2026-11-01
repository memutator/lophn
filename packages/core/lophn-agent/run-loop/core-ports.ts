import {
  type Clock,
  err,
  type IdSource,
  ok,
  type Result,
} from "../../../base/mod.ts";
import {
  type CallCost,
  checkpointTurn,
  decideToolCall,
  finishModelCall,
  finishToolCall,
  finishTurn,
  recordMessage,
  recordToolRequest,
  startModelCall,
  startToolCall,
  type TokenUsage,
  type ToolResult,
  TURN_BLOB_PURPOSES,
  turnRead,
} from "../../../protocol/lophn-agent/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import { estimatedCost } from "../usage/mod.ts";
import {
  definitionHash,
  executeToolCall,
  type ToolContext,
  type ToolDefinition,
  toolForWireName,
} from "../tools/mod.ts";
import { toolCallDisplay } from "../tools/display.ts";
import type {
  AgentEventSink,
  FinishRequest,
  LoopDeps,
  ModelAttempt,
  Pause,
  PendingInputs,
  StopCheck,
  StopReason,
  ToolCallRequest,
  ToolDone,
  ToolInfo,
  TurnContext,
  TurnInputs,
  TurnPorts,
} from "./ports.ts";
import { createLiveOutput, messageIdOf } from "./live-turns.ts";
import { inputText } from "./input-text.ts";
import { commandOf, type CoreCall, readOf } from "./core-call.ts";
import type { ModelBinding } from "../models/binding.ts";
import {
  type BlobPort,
  type RedactText,
  redactValue,
  storeRedacted,
  storeValue,
} from "./blobs.ts";

// agent loop의 port를 실제 core 호출로 잇는다. 읽기와 기록은 machine 자격의 loopback이고 tool 실행은 이
// turn의 agent 자격(`ToolContext.core`)이다. turn 행이 정본이다: 이 모듈은 상태를 따로 들고 있지 않고
// id·순번·마지막 model call만 기억한다. model call과 tool call의 사용 기록은 route를 best-effort로
// 부른다(기록을 못 해도 turn은 간다).

export type TurnSeat = {
  turn: string;
  session: string;
};

export type ToolSetup = {
  // session을 시작할 때 고정한 목록(model에는 wire 이름으로 간다).
  listed: readonly ToolDefinition[];
  // tool call 하나의 실행 맥락. 사람의 결정을 기다리는 호출(`gate.check`, `questions.ask`)은
  // core-ports가 감싸 기다리는 동안 turn의 시간을 세지 않게 한다.
  context(toolCall: Id<"tcl">): ToolContext;
  // `lophn {args}`를 부르는 명령의 이름과 입력으로 푼다. 없으면 명령 표만 쓴다.
  dispatch?(
    name: string,
    input: unknown,
  ): Promise<{ name: string; input: unknown }>;
  // 외부 MCP tool의 서버 이름. 없으면 내장 tool이다.
  server?(definition: ToolDefinition): string | null;
  // 외부 MCP tool의 기록 확장이다. 없는 tool·내장은 null이다.
  extension?(definition: ToolDefinition): {
    server_name: string;
    configuration_revision: number;
    original_tool: string;
    canonical_name: string;
  } | null;
};

type CorePortsDeps = {
  seat: TurnSeat;
  clock: Clock;
  ids: IdSource;
  machine: CoreCall;
  // 기록이 hash로 가리키는 본문을 먼저 저장하는 통로와 전송 전 redaction.
  blobs: BlobPort;
  redact: RedactText;
  // turn 기준이 고정한 resolved agent의 hash. model call·tool call 기록이 이 값을 가리킨다.
  agentHash: string;
  model: ModelBinding;
  tools: ToolSetup;
  context(): Promise<Result<TurnContext>>;
  turnInputs: TurnInputs;
  events: AgentEventSink;
  // 쓰는 중인 글을 core로 보내는 묶음이 기다리는 timer다.
  wait: LoopDeps["wait"];
};

const STOP_REASONS: ReadonlySet<string> = new Set<StopReason>([
  "user_stopped",
  "restarted",
  "session_ended",
]);

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

export function createCorePorts(deps: CorePortsDeps): TurnPorts {
  const { seat, machine, clock, ids } = deps;
  const store = (purpose: string, value: unknown) =>
    storeValue(deps.blobs, deps.redact, purpose, value);
  let attempts = 0;
  let lastModelCall: string | null = null;
  // 직전 model 호출의 사람이 읽을 reasoning과 잰 시간이다. `answer`가 그 응답의 message에
  // reasoning part로 싣는다. ModelAttempt에는 싣지 않는다(그 응답 하나의 자리다).
  let lastReasoning: { text: string; duration_ms: number | null } | null = null;
  const definitionOf = (name: string) =>
    toolForWireName(deps.tools.listed, name);

  function turnRecord() {
    return readOf(machine, turnRead, { turn: seat.turn });
  }

  function publish(
    type: "ToolCallStarted" | "ToolCallEnded" | "MessageRecorded",
    payload: Record<string, unknown>,
  ) {
    deps.events.publish({
      session: seat.session,
      type,
      at: clock.now(),
      payload: { turn: seat.turn, ...payload },
    } as Parameters<AgentEventSink["publish"]>[0]);
  }

  // ---- 멈춤·입력 ----

  // turn 행이 끝나 있으면 core가 닫은 것이다(멈춤, session 끝남, 꺼짐).
  async function stop(): Promise<StopCheck> {
    const read = await turnRecord();
    if (!read.ok || read.value.turn.state !== "finished") {
      return { stopped: false };
    }
    const outcome = read.value.turn.outcome;
    const reason =
      outcome?.kind === "interrupted" && STOP_REASONS.has(outcome.reason)
        ? outcome.reason
        : "user_stopped";
    return { stopped: true, reason };
  }

  async function inputs(): Promise<Result<PendingInputs>> {
    const first = await deps.turnInputs.first();
    if (!first.ok) return first;
    const steering = await deps.turnInputs.steering();
    if (!steering.ok) return steering;
    return ok({
      request: first.value === null ? null : inputText(first.value),
      steering: steering.value,
    });
  }

  // ---- model call ----

  async function modelAttempt(
    request: Parameters<TurnPorts["model"]["call"]>[0],
    signal: AbortSignal,
  ): Promise<Result<ModelAttempt>> {
    attempts += 1;
    lastReasoning = null;
    // 요청은 안전화한 값 하나를 저장하고 그 값을 보낸다. 안전화를 끝내지 못하면 보내지 않고, 저장한
    // 바이트와 보낸 바이트가 같다. 조립 근거도 전송 전에 저장하며 저장하지 못하면 보내지 않는다.
    const safeBody = await redactValue(deps.redact, request.body);
    if (!safeBody.ok) return safeBody;
    const inputBlob = await storeRedacted(
      deps.blobs,
      TURN_BLOB_PURPOSES.model_call_input,
      safeBody.value,
    );
    if (!inputBlob.ok) return inputBlob;
    const basisBlob = await store(TURN_BLOB_PURPOSES.model_call_basis, {
      seen: request.prompt.basis,
      diff: request.prompt.diff,
      cache_boundaries: request.prompt.cache_boundaries,
      input_budget: request.prompt.input_budget,
      measured_tokens: request.prompt.measured_tokens,
    });
    if (!basisBlob.ok) return basisBlob;
    const id = ids.newId("mcl");
    const startedAt = clock.now();
    const model = deps.model;
    const call = {
      id,
      turn: seat.turn,
      session: seat.session,
      model_use: "judgment" as const,
      agent_hash: deps.agentHash,
      purpose: "judgment" as const,
      attempt_kind: request.kind,
      attempt_order: attempts,
      retry_of: request.retry_of,
      model: model.call,
      input: inputBlob.value.hash,
      context_basis: basisBlob.value.hash,
      output: null,
      state: "started" as const,
      started_at: startedAt,
      finished_at: null,
      duration_ms: null,
      first_output_ms: null,
      outcome: null,
      usage: EMPTY_USAGE(model.usageRevision),
      cost: UNKNOWN_COST,
    };
    const started = await commandOf(
      machine,
      startModelCall,
      {
        call,
        applied_messages: request.applied,
        blob_sizes: {
          input: inputBlob.value.size,
          context_basis: basisBlob.value.size,
        },
        state_seq: "1",
      },
      { state_seq: "1" },
      `${id}:start`,
    );
    lastModelCall = id;
    // 이 요청이 가져간 steer는 입력함에서 비운다. 응답을 기다리는 사이 들어온 steer는 뒤에 남는다.
    if (request.applied.length > 0) {
      const settled = await deps.turnInputs.settled(request.applied.length);
      if (!settled.ok) return settled;
    }
    const live = createLiveOutput({
      session: seat.session as Id<"ses">,
      turn: seat.turn as Id<"trn">,
      modelCall: id as Id<"mcl">,
      send: (batch) => deps.events.output(batch),
      wait: deps.wait,
    });
    // reasoning 시간은 adapter가 알린 block의 시작(첫 reasoning delta)부터 끝(마지막
    // reasoning delta)까지다. 읽을 글 없이 암호화만 와도 빈 조각으로 시작·끝이 온다.
    let reasoningFirstMs: number | null = null;
    let reasoningLastMs: number | null = null;
    const invoked = await model.invoke(
      {
        callId: id,
        turn: seat.turn,
        session: seat.session,
        purpose: "judgment",
        model: model.call,
        endpoint: model.endpoint,
        inputHash: inputBlob.value.hash,
        contextBasisHash: basisBlob.value.hash,
        body: safeBody.value as Record<string, unknown>,
        usageRevision: model.usageRevision,
        onDelta: (delta) => {
          if (delta.kind === "reasoning") {
            const at = clock.nowMs();
            reasoningFirstMs ??= at;
            reasoningLastMs = at;
          }
          live.push(delta);
        },
      },
      signal,
    );
    // 이 attempt의 delta는 이 뒤로 없다. 보내지 않은 묶음은 버린다.
    live.stop();
    const output = invoked.ok ? invoked.value : undefined;
    lastReasoning =
      output?.reasoning == null
        ? null
        : {
            text: output.reasoning,
            duration_ms:
              reasoningFirstMs === null || reasoningLastMs === null
                ? null
                : reasoningLastMs - reasoningFirstMs,
          };
    const outcome = output?.outcome ?? {
      kind: "failed" as const,
      code: "credential_unavailable" as const,
      retry_at: null,
      finish_reason: null,
      http_status: null,
      provider_code: null,
    };
    const usage = output?.usage ?? EMPTY_USAGE(model.usageRevision);
    const price = model.call.price_basis;
    const charged = price === null ? undefined : estimatedCost(usage, price);
    const cost: CallCost =
      charged?.amount == null
        ? UNKNOWN_COST
        : {
            kind: "estimated",
            amount: charged.amount,
            currency: "USD",
            basis: (charged.rate_basis ?? {}) as Record<string, never>,
            confirmed_at: clock.now(),
          };
    const kept =
      output !== undefined &&
      (output.text.length > 0 || output.toolCalls.length > 0);
    let outputBlob: { hash: string; size: number } | null = null;
    if (kept || outcome.kind === "partial") {
      const stored = await store(TURN_BLOB_PURPOSES.model_call_output, {
        text: output?.text ?? "",
        tools: output?.toolCalls ?? [],
      });
      if (!stored.ok) return stored;
      outputBlob = stored.value;
    }
    if (started.ok) {
      await commandOf(
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
    }
    if (output === undefined) {
      return err(
        invoked.ok ? { code: "internal", message: "no output" } : invoked.error,
      );
    }
    // 글이 없는 reasoning 응답은 turn.ts의 answer 조건(tool call이 없거나 글이 있다)에
    // 걸리지 않는다. 그 응답도 agent message 하나이므로 tool call보다 먼저 여기서 남긴다.
    if (
      outcome.kind === "complete" &&
      output.text.trim() === "" &&
      output.toolCalls.length > 0
    ) {
      const recorded = await recordReply(id, "");
      if (!recorded.ok) return recorded;
    }
    const promptTokens =
      usage.input === null || usage.input <= 0
        ? undefined
        : usage.input + (usage.cache_read ?? 0) + (usage.cache_write ?? 0);
    return ok({
      id,
      outcome,
      text: output.text,
      toolCalls: output.toolCalls,
      ...(promptTokens === undefined ? {} : { promptTokens }),
    });
  }

  // ---- tool ----

  function info(name: string): ToolInfo | undefined {
    const definition = definitionOf(name);
    if (definition === undefined) return undefined;
    return {
      effect: definition.effect,
      server: deps.tools.server?.(definition) ?? null,
    };
  }

  // 사용 기록. 요청을 남기고 끝난 결과를 잇는다. 어느 쪽이든 못 남겨도 호출은 그대로 간다.
  async function record(
    call: ToolCallRequest,
    id: string,
    definition: ToolDefinition | undefined,
  ): Promise<Result<unknown>> {
    // 인자는 redaction한 바이트를 blob으로 저장한 뒤 그 hash로 기록한다.
    const inputBlob = await store(
      TURN_BLOB_PURPOSES.tool_call_input,
      call.input,
    );
    if (!inputBlob.ok) return inputBlob;
    return await commandOf(
      machine,
      recordToolRequest,
      {
        id,
        turn: seat.turn,
        model_call: call.model_call,
        response_key: call.key,
        response_order: call.order,
        tool: definition?.name ?? call.name,
        definition_revision:
          definition === undefined
            ? "unlisted"
            : await definitionHash(definition),
        effect: definition?.effect ?? "read",
        confirm: false,
        // 외부 MCP tool의 원래 서버·tool 쌍이다. 내장·없는 tool은 null이다.
        extension:
          definition === undefined
            ? null
            : (deps.tools.extension?.(definition) ?? null),
        input: inputBlob.value.hash,
        input_size: inputBlob.value.size,
        retry_of: call.retry_of,
        attempt: call.attempt,
      },
      { turn_state_seq: "0", model_call_finished_seq: "0" },
      `${id}:request`,
    );
  }

  const done = (
    tool_call: string,
    status: ToolDone["status"],
    code: string,
    summary: string,
  ): ToolDone => ({
    tool_call,
    status,
    code,
    result: {
      status,
      summary,
      content: null,
      complete: true,
      source: null,
      continuation: null,
      pending: [],
    },
  });

  // 사람의 결정을 기다리는 동안 turn의 시간을 세지 않게 맥락의 기다림 둘을 감싼다. Gate가 run을 돌려줬는지도
  // 여기서 본다(결정 기록에 Gate가 물었다는 사실을 싣는다).
  function paused(
    ctx: ToolContext,
    pause: Pause,
    gated: { ran: boolean },
  ): ToolContext {
    return {
      ...ctx,
      gate: {
        async check(input) {
          pause.begin();
          try {
            const checked = await ctx.gate.check(input);
            if (checked.ok && checked.value.kind === "run") gated.ran = true;
            return checked;
          } finally {
            pause.end();
          }
        },
      },
      questions: {
        async ask(call, questions) {
          pause.begin();
          try {
            return await ctx.questions.ask(call, questions);
          } finally {
            pause.end();
          }
        },
      },
    };
  }

  function endedOutcome(outcome: {
    kind: string;
    code: string;
  }): "ok" | "error" | "denied" | "cancelled" {
    if (outcome.kind === "success") return "ok";
    if (outcome.kind === "not_executed") {
      if (outcome.code === "cancelled") return "cancelled";
      if (outcome.code === "denied" || outcome.code === "rejected") {
        return "denied";
      }
    }
    return "error";
  }

  async function attemptTool(
    call: ToolCallRequest,
    signal: AbortSignal,
    pause: Pause,
  ): Promise<ToolDone> {
    const definition = definitionOf(call.name);
    const id = ids.newId("tcl") as Id<"tcl">;
    const recorded = await record(call, id, definition);
    const display = await toolCallDisplay(
      definition,
      definition?.name ?? call.name,
      call.input,
      deps.redact,
    );
    publish("ToolCallStarted", {
      tool_call: id,
      tool: definition?.name ?? call.name,
      display,
    });
    const startedMs = clock.nowMs();

    // 각 command의 compare는 앞 command가 올린 state_seq다(요청 0, decide 1, start 2). command 출력에는
    // state_seq가 없어 성공한 만큼 센다.
    let seq = 0;
    let bookkeeping: string | null = null;
    const gated = { ran: false };
    // 결정과 시작은 handler가 돌기 직전에 남긴다. 실패하면 tool을 실행하지 않는다.
    const ctx = paused({ ...deps.tools.context(id), signal }, pause, gated);
    const listed = ctx.listed.map((tool) =>
      tool !== definition || tool.handler === undefined
        ? tool
        : {
            ...tool,
            handler: async (input: unknown, context: ToolContext) => {
              const entered = recorded.ok
                ? await enter(id, seq, gated.ran)
                : ok(undefined);
              if (!entered.ok) {
                bookkeeping = entered.error.message;
                return entered;
              }
              if (recorded.ok) seq += 2;
              return await tool.handler!(input, context);
            },
          },
    );
    const executed = await executeToolCall(
      { ...ctx, listed },
      call.name,
      call.input,
    );
    if (bookkeeping !== null) {
      publish("ToolCallEnded", { tool_call: id, outcome: "error" });
      return done(id, "uncertain", "uncertain", bookkeeping);
    }
    let outputBlob: { hash: string; size: number } | null = null;
    if (executed.outcome.kind === "success") {
      const stored = await store(
        TURN_BLOB_PURPOSES.tool_call_output,
        executed.result,
      );
      // 결과를 저장하지 못하면 확정 사실이 없다. 불명확으로 닫는다.
      if (!stored.ok) {
        publish("ToolCallEnded", { tool_call: id, outcome: "error" });
        return done(
          id,
          "uncertain",
          "uncertain",
          "the result could not be stored",
        );
      }
      outputBlob = stored.value;
    }
    if (recorded.ok) {
      // 기록 열의 결과도 blob과 같이 redaction을 거친 값만 남긴다.
      const safeResult = await redactValue(deps.redact, executed.result);
      if (!safeResult.ok) {
        publish("ToolCallEnded", { tool_call: id, outcome: "error" });
        return done(
          id,
          "uncertain",
          "uncertain",
          "the result could not be recorded",
        );
      }
      const finished = await commandOf(
        machine,
        finishToolCall,
        {
          tool_call: id,
          outcome: executed.outcome,
          output: outputBlob?.hash ?? null,
          ...(outputBlob === null ? {} : { output_size: outputBlob.size }),
          result: safeResult.value as ToolResult,
          finished_at: clock.now(),
          duration_ms: Math.max(0, clock.nowMs() - startedMs),
        },
        { state_seq: String(seq) },
        `${id}:finish`,
      );
      if (!finished.ok) {
        publish("ToolCallEnded", { tool_call: id, outcome: "error" });
        return done(
          id,
          "uncertain",
          "uncertain",
          "the result could not be recorded",
        );
      }
    }
    publish("ToolCallEnded", {
      tool_call: id,
      outcome: endedOutcome(executed.outcome),
    });
    return {
      tool_call: id,
      status: executed.outcome.kind,
      code: executed.outcome.code,
      result: executed.result,
    };
  }

  // handler 직전에 결정(requested → decided)과 시작(→ started)을 남긴다. Gate가 물어 허락한 call과
  // 묻지 않은 call(정책상 허락)을 reason으로 가른다.
  async function enter(
    id: Id<"tcl">,
    seq: number,
    gated: boolean,
  ): Promise<Result<void>> {
    const decided = await commandOf(
      machine,
      decideToolCall,
      {
        tool_call: id,
        decision: {
          decision: "allow",
          reason: gated ? "gate_run" : "no_gate",
          assignment_revision: null,
          agent_hash: deps.agentHash,
        },
      },
      { state_seq: String(seq) },
      `${id}:decide`,
    );
    if (!decided.ok) {
      return err({
        code: decided.error.code,
        message: "the decision could not be recorded",
      });
    }
    const turn = await turnRecord();
    if (!turn.ok) {
      return err({
        code: turn.error.code,
        message: "the start could not be recorded",
      });
    }
    const started = await commandOf(
      machine,
      startToolCall,
      { tool_call: id, started_at: clock.now() },
      {
        state_seq: String(seq + 1),
        turn_state_seq: turn.value.turn.state_seq,
        // command는 이 값을 보지 않는다. 자격 재검사는 실행기가 하고 turn은 assignment 판을 들고 있지 않다.
        assignment_revision: 1,
      },
      `${id}:start`,
    );
    return started.ok
      ? ok(undefined)
      : err({
          code: started.error.code,
          message: "the start could not be recorded",
        });
  }

  // 진입하지 않고 끝나는 call(없는 tool·잘못된 인자·미실행)이다. 시작하지 않았으므로 event는 없다.
  function close(
    _call: ToolCallRequest,
    why: { status: "failure" | "not_executed"; code: string; summary: string },
  ): Promise<ToolDone> {
    return Promise.resolve(
      done(ids.newId("tcl"), why.status, why.code, why.summary),
    );
  }

  // ---- 끝·기록 ----

  async function finish(request: FinishRequest) {
    const current = await turnRecord();
    if (!current.ok) return current;
    // 결과는 확정한 사실이고 redaction한 바이트를 blob으로 저장한 뒤 그 hash로 끝낸다.
    const result = await store(TURN_BLOB_PURPOSES.turn_result, {
      outcome: request.outcome,
      facts: request.facts,
      limit: request.limit,
    });
    if (!result.ok) return result;
    const finished = await commandOf(
      machine,
      finishTurn,
      {
        turn: seat.turn,
        outcome: request.outcome,
        result: result.value.hash,
        result_size: result.value.size,
      },
      { state_seq: current.value.turn.state_seq },
      `${seat.turn}:finish`,
    );
    if (finished.ok) return ok({ finished: true as const });
    if (
      finished.error.code === "conflict" &&
      finished.error.message.includes("steering")
    ) {
      return ok({ finished: false as const, reason: "pending_input" as const });
    }
    return finished;
  }

  // 그 model 호출의 응답을 agent message 하나로 남긴다. part 순서는 reasoning, text다. 답은
  // 이 session 자신이 보낸 메시지로 session 기록에 남는다. runtime(machine)이 쓰고 core가 이
  // turn이 이 session에서 도는 중인지 본다. id를 그 호출에서 정해 멈춤 wrapper와 child가 같은
  // 응답을 저장해도 둘째는 같은 id 규칙에 걸린다. 남길 part가 없으면 아무것도 남기지 않는다.
  // `emptyTextPart`는 answer 길이다: 마지막 응답은 글이 비어도 남겨야 run의 답이 그 응답이 되고,
  // 빈 답은 no_answer로 끝난다(`wiring/runs.ts`).
  async function recordReply(
    modelCall: string,
    text: string,
    emptyTextPart = false,
  ): Promise<Result<void>> {
    const parts: { kind: string; text: string; duration_ms?: number | null }[] =
      [];
    if (lastReasoning !== null) {
      parts.push({
        kind: "reasoning",
        text: lastReasoning.text,
        duration_ms: lastReasoning.duration_ms,
      });
    }
    if (text.trim() !== "" || emptyTextPart) {
      parts.push({ kind: "text", text });
    }
    if (parts.length === 0) return ok(undefined);
    const message = messageIdOf(modelCall);
    const recorded = await commandOf(
      machine,
      recordMessage,
      {
        id: message,
        session: seat.session,
        turn: seat.turn,
        content: { schema_version: 1, parts },
      },
      {},
      `${seat.turn}:answer:${modelCall}`,
    );
    if (!recorded.ok) return recorded;
    // 그 응답의 tool call보다 먼저 불리므로 MessageRecorded가 그 응답의 ToolCallStarted보다 먼저 간다.
    publish("MessageRecorded", { message, model_call: modelCall });
    return ok(undefined);
  }

  return {
    stop,
    inputs,
    context: deps.context,
    model: {
      pack: deps.model.pack,
      available: () => deps.model.available(),
      call: modelAttempt,
    },
    tools: {
      info,
      attempt: attemptTool,
      close,
      ...(deps.tools.dispatch === undefined
        ? {}
        : { dispatch: deps.tools.dispatch }),
    },
    async checkpoint(elapsed) {
      const current = await turnRecord();
      if (!current.ok || current.value.turn.state !== "running") return;
      await commandOf(
        machine,
        checkpointTurn,
        { turn: seat.turn, elapsed },
        { state_seq: current.value.turn.state_seq },
        `${seat.turn}:checkpoint:${elapsed.active_ms}:${elapsed.stall_ms}`,
      );
    },
    answer(text) {
      return recordReply(lastModelCall!, text, true);
    },
    finish,
  };
}
