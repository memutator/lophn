import {
  type Clock,
  err,
  type IdSource,
  ok,
  type Result,
} from "../../../base/mod.ts";
import type { Span, Tracer } from "../../../base/telemetry/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import {
  type AgentRuntime,
  type CallCost,
  checkpointTurn,
  decideToolCall,
  finishModelCall,
  finishToolCall,
  finishTurn,
  recordMessage,
  recordToolRequest,
  setSessionAiTitle,
  startModelCall,
  startToolCall,
  type TokenUsage,
  type ToolResult,
  TURN_BLOB_PURPOSES,
  turnRead,
  workspaceSessionRead,
} from "../../../protocol/lophn-agent/mod.ts";
import { toWireToolName } from "../../../protocol/lophn-agent/tool-catalog.ts";
import type { ModelBinding } from "../models/binding.ts";
import {
  parseSessionTitle,
  sessionTitleRequest,
} from "../prompt-assembly/title.ts";
import { toolCallDisplay } from "../tools/display.ts";
import {
  definitionHash,
  executeToolCall,
  type ToolContext,
  type ToolDefinition,
  toolForWireName,
} from "../tools/mod.ts";
import { estimatedCost } from "../usage/mod.ts";
import {
  type BlobPort,
  type RedactText,
  redactValue,
  storeRedacted,
  storeValue,
} from "./blobs.ts";
import { type CoreCall, commandOf, readOf } from "./core-call.ts";
import { type ImageReader, inputParts, loadParts } from "./input-text.ts";
import { createLiveOutput, messageIdOf } from "./live-turns.ts";
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
import {
  inAgentSpan,
  modelCallEndAttributes,
  modelCallStartAttributes,
  setAttributes,
  toolCallEndAttributes,
  toolCallStartAttributes,
} from "./spans.ts";

// agent loop의 port를 실제 core 호출로 잇는다. 읽기와 기록은 machine 자격의 loopback이고 tool 실행은 이
// turn의 agent 자격(`ToolContext.core`)이다. turn 행이 정본이다: 이 모듈은 상태를 따로 들고 있지 않고
// id·순번·마지막 model call만 기억한다. model call과 tool call의 사용 기록은 route를 best-effort로
// 부른다(기록을 못 해도 turn은 간다). 다만 tool 호출은 요청을 기록하지 못하면 읽기만 돈다.

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
  // model call·tool call span을 낸다. 없으면 span 없이 돈다.
  tracer?: Tracer;
  machine: CoreCall;
  // 받은 image part의 bytes를 읽는다. 이 session의 메시지가 참조하는 blob만 읽힌다.
  images: ImageReader;
  // 기록이 hash로 가리키는 본문을 먼저 저장하는 통로와 전송 전 redaction.
  blobs: BlobPort;
  redact: RedactText;
  // turn 기준이 고정한 resolved agent의 hash. model call·tool call 기록이 이 값을 가리킨다.
  agentHash: string;
  // 받은 call 글이 runtime마다 달라 이력 재생과 같은 runtime으로 입력을 싼다.
  runtime: AgentRuntime;
  model: ModelBinding;
  tools: ToolSetup;
  context(): Promise<Result<TurnContext>>;
  turnInputs: TurnInputs;
  events: AgentEventSink;
  // 쓰는 중인 글을 core로 보내는 묶음이 기다리는 timer다.
  wait: LoopDeps["wait"];
};

// 제목 call은 첫 turn과 나란히 돈다. 늦게 오는 제목은 쓸모가 줄어 오래 기다리지 않는다.
const TITLE_TIMEOUT_MS = 30_000;

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

// 기록 열에 넣는 줄인 result다. 내용은 버리되 이미지는 개수만 남긴다: 다음 model 호출 전 context 추정이 이 열에서
// 이미지 수를 센다(`session/context.ts`).
function compactRecord(result: ToolResult): ToolResult {
  const image = (result.content as { image?: { media_type?: unknown } } | null)
    ?.image;
  const kept =
    image !== undefined && image !== null && typeof image === "object"
      ? { image: { media_type: String(image.media_type), data_base64: "" } }
      : null;
  return {
    ...result,
    summary:
      result.summary.length > 400
        ? `${result.summary.slice(0, 399)}…`
        : result.summary,
    content: kept,
    pending: [
      ...result.pending.slice(0, 31),
      "The stored record omits the content.",
    ],
  };
}

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

  // 첫 입력의 part는 turn 안에서 바뀌지 않는데 inputs()가 여러 번 불리므로 blob을 한 번만 읽는다. 이 closure가 turn
  // 하나이므로 turn이 끝나면 버려진다.
  let firstParts: Promise<Awaited<ReturnType<typeof loadParts>>> | undefined;

  async function inputs(): Promise<Result<PendingInputs>> {
    const first = await deps.turnInputs.first();
    if (!first.ok) return first;
    const steering = await deps.turnInputs.steering();
    if (!steering.ok) return steering;
    const firstInput = first.value;
    // 받은 turn의 입력과 뒤 이력이 같은 part 함수(inputParts)와 같은 reader를 쓴다.
    return ok({
      request:
        firstInput === null
          ? null
          : await (firstParts ??= loadParts(
              inputParts(firstInput, deps.runtime),
              deps.images,
            )),
      steering: await Promise.all(
        steering.value.map(async (item) => ({
          ...item,
          parts: await loadParts(
            inputParts(item.input, deps.runtime),
            deps.images,
          ),
        })),
      ),
    });
  }

  // ---- model call ----

  // span 안에서 돌려 provider로 나가는 HTTP client span이 이 시도 아래에 달리게 한다.
  function tracedModelAttempt(
    request: Parameters<TurnPorts["model"]["call"]>[0],
    signal: AbortSignal,
  ): Promise<Result<ModelAttempt>> {
    return inAgentSpan(
      deps.tracer,
      "agent.model_call",
      modelCallStartAttributes({
        session: seat.session,
        turn: seat.turn,
        provider: deps.model.call.provider,
        model: deps.model.call.name,
        purpose: "judgment",
        kind: request.kind,
        order: attempts + 1,
      }),
      async (span) => {
        const result = await modelAttempt(request, signal, span);
        if (!result.ok) {
          span?.setStatus("error");
          span?.setAttribute("lophn.code", result.error.code);
        } else if (
          result.value.outcome.kind !== "complete" &&
          result.value.outcome.kind !== "cancelled"
        ) {
          span?.setStatus("error");
        }
        return result;
      },
    );
  }

  async function modelAttempt(
    request: Parameters<TurnPorts["model"]["call"]>[0],
    signal: AbortSignal,
    span: Span | undefined,
  ): Promise<Result<ModelAttempt>> {
    // 번호는 여기서 바로 잡는다. 아래에서 기다리는 사이 같은 turn의 다른 call(제목)이 counter를 올리면, 나중에 읽은
    // 값이 그 call과 같은 번호가 되어 시작이 거절되고 turn이 model을 부르지 못한 채 실패한다.
    const order = (attempts += 1);
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
    span?.setAttribute("lophn.model_call", id);
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
      attempt_order: order,
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
    // 행이 없으면 steer를 비우거나 model을 부르지 않는다. 그러면 steer가 queue에 남아 다음 시도가 다시 싣는다.
    if (!started.ok) return started;
    lastModelCall = id;
    // 이 요청이 가져간 steer는 queue에서 비운다. 응답을 기다리는 사이 들어온 steer는 뒤에 남는다.
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
    let outcome = output?.outcome ?? {
      kind: "failed" as const,
      code: "credential_unavailable" as const,
      retry_at: null,
      finish_reason: null,
      http_status: null,
      provider_code: null,
    };
    const usage = output?.usage ?? EMPTY_USAGE(model.usageRevision);
    setAttributes(span, modelCallEndAttributes(outcome, usage));
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
    let storeFailure: Result<never> | undefined;
    if (kept || outcome.kind === "partial") {
      const stored = await store(TURN_BLOB_PURPOSES.model_call_output, {
        text: output?.text ?? "",
        tools: output?.toolCalls ?? [],
      });
      if (stored.ok) {
        outputBlob = stored.value;
      } else {
        // 글을 남기지 못해도 started 행은 끝낸다. 열린 채 두면 turn이 닫힐 때까지 started로 남는다.
        storeFailure = stored;
        outcome = {
          kind: "failed",
          code: "unknown",
          retry_at: null,
          finish_reason: null,
          http_status: null,
          provider_code: null,
        };
      }
    }
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
    if (storeFailure !== undefined) return storeFailure;
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

  function names(): readonly string[] {
    return deps.tools.listed.map((tool) => toWireToolName(tool.name));
  }

  function info(name: string): ToolInfo | undefined {
    const definition = definitionOf(name);
    if (definition === undefined) return undefined;
    return {
      effect: definition.effect,
      server: deps.tools.server?.(definition) ?? null,
    };
  }

  // 사용 기록. 요청을 남기고 끝난 결과를 잇는다. 요청을 못 남기면 읽기만 돈다(attemptTool). 끝난 결과를 못
  // 남기면 불명확으로 닫는다.
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

  function tracedAttemptTool(
    call: ToolCallRequest,
    signal: AbortSignal,
    pause: Pause,
  ): Promise<ToolDone> {
    return inAgentSpan(
      deps.tracer,
      "agent.tool_call",
      toolCallStartAttributes({
        session: seat.session,
        turn: seat.turn,
        modelCall: call.model_call,
        tool: definitionOf(call.name)?.name,
        attempt: call.attempt,
      }),
      async (span) => {
        const done = await attemptTool(call, signal, pause);
        setAttributes(span, toolCallEndAttributes(done));
        if (done.status !== "success") span?.setStatus("error");
        return done;
      },
    );
  }

  async function attemptTool(
    call: ToolCallRequest,
    signal: AbortSignal,
    pause: Pause,
  ): Promise<ToolDone> {
    const definition = definitionOf(call.name);
    const id = ids.newId("tcl") as Id<"tcl">;
    const recorded = await record(call, id, definition);
    // 기록 없이 쓰기가 돌면 rewind 기록도 남지 않는다. 돌지 않은 것은 확정 사실이라 not_executed다.
    if (
      !recorded.ok &&
      definition !== undefined &&
      definition.effect !== "read"
    ) {
      return done(
        id,
        "not_executed",
        "unrecorded",
        "The call could not be recorded, so it did not run.",
      );
    }
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
    // state_seq가 없어 성공한 만큼 센다. enter가 중간에 실패해도 닫기가 행의 현재 값을 알도록 enter가 올린다.
    const cursor = { seq: 0 };
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
                ? await enter(id, cursor, gated.ran)
                : ok(undefined);
              if (!entered.ok) {
                bookkeeping = entered.error.message;
                return entered;
              }
              return await tool.handler!(input, context);
            },
          },
    );
    // 이 뒤에서 행이 요청·진입 상태로 남는 길은 모두 giveUp으로 닫는다. 끝나지 않은 행은 ACP 화면에 영원히
    // 실행 중으로 남는다.
    const giveUp = async (summary: string): Promise<ToolDone> => {
      publish("ToolCallEnded", { tool_call: id, outcome: "error" });
      const closed = done(id, "uncertain", "uncertain", summary);
      if (recorded.ok) {
        // 닫기가 실패해도 turn은 간다. 원래 finish가 이미 commit됐다면 conflict이고 그대로 둔다.
        await commandOf(
          machine,
          finishToolCall,
          {
            tool_call: id,
            outcome: { kind: "uncertain", code: "uncertain" },
            output: null,
            result: closed.result,
            finished_at: clock.now(),
            duration_ms: Math.max(0, clock.nowMs() - startedMs),
          },
          { state_seq: String(cursor.seq) },
          `${id}:close`,
        );
      }
      return closed;
    };
    // handler가 던지면 효과가 났는지 알 수 없다. 던짐을 batch까지 올리면 행이 진입 상태로 남고 turn이 죽는다.
    let executed: Awaited<ReturnType<typeof executeToolCall>>;
    try {
      executed = await executeToolCall(
        { ...ctx, listed },
        call.name,
        call.input,
      );
    } catch {
      return await giveUp("the tool call threw");
    }
    if (bookkeeping !== null) return await giveUp(bookkeeping);
    let outputBlob: { hash: string; size: number } | null = null;
    if (executed.outcome.kind === "success") {
      const stored = await store(
        TURN_BLOB_PURPOSES.tool_call_output,
        executed.result,
      );
      // 결과를 저장하지 못하면 확정 사실이 없다. 불명확으로 닫는다.
      if (!stored.ok) return await giveUp("the result could not be stored");
      outputBlob = stored.value;
    }
    if (recorded.ok) {
      // 기록 열의 결과도 blob과 같이 redaction을 거친 값만 남긴다.
      const safeResult = await redactValue(deps.redact, executed.result);
      if (!safeResult.ok)
        return await giveUp("the result could not be recorded");
      const finishInput = {
        tool_call: id,
        outcome: executed.outcome,
        output: outputBlob?.hash ?? null,
        ...(outputBlob === null ? {} : { output_size: outputBlob.size }),
        finished_at: clock.now(),
        duration_ms: Math.max(0, clock.nowMs() - startedMs),
      };
      let finished = await commandOf(
        machine,
        finishToolCall,
        { ...finishInput, result: safeResult.value as ToolResult },
        { state_seq: String(cursor.seq) },
        `${id}:finish`,
      );
      // 기록 열의 result는 core의 JSON 본문 한도(256 KiB·깊이 16·항목 4,096)와 summary 400자를 지켜야 한다.
      // 넘는 결과(큰 이미지·긴 page·깊은 설정 schema)는 거절되고 같은 입력의 재시도도 같으므로 줄인 기록으로
      // 한 번 더 낸다. 전체는 output blob에 있고 model에는 전체가 간다.
      if (!finished.ok && finished.error.code === "invalid_input") {
        finished = await commandOf(
          machine,
          finishToolCall,
          {
            ...finishInput,
            result: compactRecord(safeResult.value as ToolResult),
          },
          { state_seq: String(cursor.seq) },
          `${id}:finish-compact`,
        );
      }
      if (!finished.ok) return await giveUp("the result could not be recorded");
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
    cursor: { seq: number },
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
      { state_seq: String(cursor.seq) },
      `${id}:decide`,
    );
    if (!decided.ok) {
      return err({
        code: decided.error.code,
        message: "the decision could not be recorded",
      });
    }
    cursor.seq += 1;
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
        state_seq: String(cursor.seq),
        turn_state_seq: turn.value.turn.state_seq,
        // command는 이 값을 보지 않는다. 자격 재검사는 실행기가 하고 turn은 assignment 판을 들고 있지 않다.
        assignment_revision: 1,
      },
      `${id}:start`,
    );
    if (!started.ok) {
      return err({
        code: started.error.code,
        message: "the start could not be recorded",
      });
    }
    cursor.seq += 1;
    return ok(undefined);
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
  async function recordReply(
    modelCall: string,
    text: string,
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
    if (text.trim() !== "") {
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

  // 첫 요청의 제목을 model로 짓는 call 하나. 이 turn의 call로 기록하되 판단(judgment)이 아니라 정리(organizing)라
  // 문맥 크기 기준에 들지 않는다. 실패하면 자른 자동 제목이 그대로 남는다.
  async function titleAttempt(text: string): Promise<void> {
    // 바꿀 대상은 지금 session에 적힌 제목이다. 요청 글에서 자동 제목을 다시 계산해 맞추면 이미지나 file이 붙은
    // 말(자동 제목에 `[image]`가 든다)과 `/` 명령에서 어긋나 AI 제목이 붙지 않는다. 읽은 뒤 사람이 rename하면
    // command가 바꾸지 않는다.
    const read = await readOf(machine, workspaceSessionRead, {
      session: seat.session,
    });
    if (!read.ok) return;
    const expected = read.value.session.title;
    if (expected === null) return;
    const model = deps.model;
    const prompt = sessionTitleRequest(text);
    const packed = model.pack(prompt);
    const safeBody = await redactValue(deps.redact, packed.body);
    if (!safeBody.ok) return;
    const inputBlob = await storeRedacted(
      deps.blobs,
      TURN_BLOB_PURPOSES.model_call_input,
      safeBody.value,
    );
    if (!inputBlob.ok) return;
    const basisBlob = await store(TURN_BLOB_PURPOSES.model_call_basis, {
      kind: "session_title",
      session: seat.session,
    });
    if (!basisBlob.ok) return;
    const order = (attempts += 1);
    const id = ids.newId("mcl");
    const started = await commandOf(
      machine,
      startModelCall,
      {
        call: {
          id,
          turn: seat.turn,
          session: seat.session,
          model_use: "organizing" as const,
          agent_hash: deps.agentHash,
          purpose: "title_summary" as const,
          attempt_kind: "initial" as const,
          attempt_order: order,
          retry_of: null,
          model: model.call,
          input: inputBlob.value.hash,
          context_basis: basisBlob.value.hash,
          output: null,
          state: "started" as const,
          started_at: clock.now(),
          finished_at: null,
          duration_ms: null,
          first_output_ms: null,
          outcome: null,
          usage: EMPTY_USAGE(model.usageRevision),
          cost: UNKNOWN_COST,
        },
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
    if (!started.ok) return;
    const invoked = await model.invoke(
      {
        callId: id,
        turn: seat.turn,
        session: seat.session,
        purpose: "organizing",
        model: model.call,
        endpoint: model.endpoint,
        inputHash: inputBlob.value.hash,
        contextBasisHash: basisBlob.value.hash,
        body: safeBody.value as Record<string, unknown>,
        usageRevision: model.usageRevision,
      },
      AbortSignal.timeout(TITLE_TIMEOUT_MS),
    );
    const output = invoked.ok ? invoked.value : undefined;
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
    const outputBlob =
      output !== undefined && output.text.length > 0
        ? await store(TURN_BLOB_PURPOSES.model_call_output, {
            text: output.text,
            tools: [],
          })
        : null;
    const kept = outputBlob?.ok === true ? outputBlob.value : null;
    await commandOf(
      machine,
      finishModelCall,
      {
        call: id,
        output: kept?.hash ?? null,
        ...(kept === null ? {} : { output_size: kept.size }),
        outcome:
          outcome.kind === "partial" && kept === null
            ? { ...outcome, kind: "failed" as const, code: "unknown" as const }
            : outcome,
        usage,
        cost,
        duration_ms: output?.durationMs ?? null,
        first_output_ms: output?.firstOutputMs ?? null,
        state_seq: "2",
      },
      { state_seq: "1" },
      `${id}:finish`,
    );
    if (output === undefined || outcome.kind !== "complete") return;
    const title = parseSessionTitle(output.text);
    if (title === null) return;
    await commandOf(
      machine,
      setSessionAiTitle,
      { session: seat.session, expected, title },
      {},
      `${seat.session}:ai-title`,
    );
  }

  return {
    stop,
    inputs,
    context: deps.context,
    title(text) {
      // 첫 turn을 기다리게 하지 않는다. 어떤 실패도 turn에 닿지 않는다.
      void titleAttempt(text).catch(() => undefined);
    },
    model: {
      pack: deps.model.pack,
      available: () => deps.model.available(),
      call: tracedModelAttempt,
    },
    tools: {
      info,
      names,
      attempt: tracedAttemptTool,
      close,
      ...(deps.tools.dispatch === undefined
        ? {}
        : { dispatch: deps.tools.dispatch }),
    },
    async checkpoint(elapsed, history) {
      const current = await turnRecord();
      if (!current.ok) return;
      const { turn } = current.value;
      // 사람이 멈춘 turn도 마지막 tool round의 이력은 받는다.
      const stoppedByPerson =
        turn.state === "finished" &&
        turn.outcome?.kind === "interrupted" &&
        turn.outcome.reason === "user_stopped";
      if (turn.state !== "running" && !stoppedByPerson) return;
      // 이력을 남기지 못하면 시간만 남긴다. 다음 turn은 이 turn을 메시지로만 읽는다.
      const stored =
        history === undefined || history.length === 0
          ? null
          : await store(TURN_BLOB_PURPOSES.turn_history, history);
      const kept = stored?.ok === true ? stored.value : null;
      if (stoppedByPerson && kept === null) return;
      await commandOf(
        machine,
        checkpointTurn,
        {
          turn: seat.turn,
          elapsed,
          ...(kept === null
            ? {}
            : { history: kept.hash, history_size: kept.size }),
        },
        { state_seq: turn.state_seq },
        `${seat.turn}:checkpoint:${elapsed.active_ms}:${elapsed.stall_ms}:${kept?.hash ?? ""}`,
      );
    },
    answer(text) {
      return recordReply(lastModelCall!, text);
    },
    finish,
  };
}
