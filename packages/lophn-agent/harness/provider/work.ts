// model 호출 공통 interface(architecture §5.2). runtime 내부 interface는
// `invokeModelCall(input, signal)`이다. 세 adapter(anthropic-messages·
// openai-responses·openai-chat-completions)가 같은 입력·출력을 갖는다. SDK의
// 숨은 retry는 0이다: retry 횟수·간격·총 시도 수의 주인은 run-loop다(provider#R20).

import {
  canonicalize,
  err,
  ok,
  type Result,
  sha256Hex,
} from "../../../base/mod.ts";
import {
  type CallCost,
  type CallModel,
  CONNECTION_TEST_TIMEOUT_MS,
  type ModelCallRecord,
  type ModelOutcome,
  type ProviderCheck,
  type ProviderCredential,
  type ProviderRecord,
  type TokenUsage,
} from "../../../contracts/lophn-agent/mod.ts";
import { buildRequest as buildChat } from "./adapters/chat-completions.ts";
import { buildRequest as buildMessages } from "./adapters/messages.ts";
import { buildRequest as buildResponses } from "./adapters/responses.ts";
import {
  type AvailabilityChange,
  availabilityFromVerdict,
} from "./credentials.ts";
import type { FailureVerdict } from "./failures.ts";
import type { ToolCall } from "./adapters/messages.ts";
import type { SseOver } from "./adapters/stream.ts";

// 호출 입력. resolve가 준 판과 run 근거다(§5.2).
export type ModelCallInput = {
  // 시도 id. 호출 시작 기록과 같은 id다.
  callId: string;
  // 명시 연결 test에는 run·세션이 없다(architecture §7).
  run: string | null;
  session: string | null;
  purpose: "judgment" | "organizing" | "connection_test";
  model: CallModel;
  // endpoint는 API base다. adapter가 표의 path를 붙인다.
  endpoint: string;
  // 보호한 prompt와 context_basis hash. 값은 여기 없다(R7).
  inputHash: string;
  contextBasisHash: string;
  // 전송할 본문(adapter가 번역한 wire bytes).
  body: Record<string, unknown>;
  // prompt-assemble이 준 cache 경계는 buildRequest에서 이미 표시됐다.
  timeoutMs: number | null;
  // token 사용량 정의 판. 보고 사용량에 붙는다(usage#R6).
  usageRevision: string;
  // 재전송 대상 opaque 추론이 있는 요청의 state-free 계속 검증 입력이다(질문 Q7).
  continuation?: { pendingReasoning: boolean; reasoningRequired: boolean };
};

// 호출 출력. 순서·대응을 보존한 text·tool requests다(§5.2).
export type ModelCallOutput = {
  id: string;
  outcome: ModelOutcome;
  text: string;
  toolCalls: ToolCall[];
  // 완성 확인 뒤 tool만 실행 대상이다. partial·failed의 tool은 없다.
  usage?: TokenUsage;
  // failed 결과의 분류 근거다. credential 상태 변경이 읽고 보존하지 않는다.
  verdict?: FailureVerdict;
  durationMs: number | null;
  firstOutputMs: number | null;
};

export type InvokeModelCall = (
  input: ModelCallInput,
  signal: AbortSignal,
) => Promise<Result<ModelCallOutput>>;

// SDK 숨은 retry 0. 호출은 한 번이다. 재시도는 run-loop가 새 ModelCall로 한다(R20).
export const SDK_RETRIES = 0;

// parser 상한 실패는 일시가 아니라 요청 크기 문제다. over 종류를 그대로 전달한다.
export function overOutcome(over: SseOver): ModelOutcome {
  return {
    kind: "failed",
    code: "temporary",
    retry_at: null,
    finish_reason: null,
    http_status: null,
    provider_code: `sse_${over.kind}`,
  };
}

// 명시 연결 test 결과. 실제 call 참조를 result에 남긴다(R30).
export type CheckOutcome = {
  check: ProviderCheck | null;
  outcome: ModelOutcome;
};

export function checkOutcomeFrom(
  outcome: ModelOutcome,
  calls: readonly string[],
  at: string,
  credentialKey: string,
  credentialRevision: number,
  modelName: string,
  testKind: "text" | "tool_call",
  commandKey: string,
): CheckOutcome {
  const failed = outcome.kind !== "complete";
  const check: ProviderCheck = {
    at,
    credential_key: credentialKey,
    credential_revision: credentialRevision,
    model_name: modelName,
    test_kind: testKind,
    command_key: commandKey,
    calls: [...calls],
    result: failed ? "failure" : "success",
    code: failed ? outcome.code ?? "unknown" : null,
  };
  return { check, outcome };
}

// ---- 명시 연결 test(provider#R29, R30) ----

// 고정 test 재료. 세션·문서·사용자 입력은 여기 들어오지 않는다(R29). tool은 이름만
// 있는 probe라 앱 업무를 실행하지 않는다.
export const TEST_TEXT_PROMPT = "Reply with the single word: ok";
export const TEST_TOOL_PROMPT =
  'Call the tool lophn_connection_probe with the arguments {"ping":true}.';
export const TEST_TOOL_NAME = "lophn_connection_probe";
const TEST_TOOL_SCHEMA = {
  type: "object",
  properties: { ping: { type: "boolean" } },
  required: ["ping"],
} as const;
const TEST_MAX_OUTPUT = 128;

export type ConnectionTestInput = {
  provider: string;
  credential_key: string;
  model_name: string;
  test_kind: "text" | "tool_call";
  command_key: string;
};

// runtime이 ledger command·read로 채우는 자리다. 이 모듈은 상태를 직접 쓰지 않는다.
export type ConnectionTestPort = {
  readProvider(id: string): Promise<Result<ProviderRecord>>;
  // 명시 선택(provider·credential·model)을 현재 catalog로 검증해 CallModel로 만든다.
  resolveModel(
    provider: ProviderRecord,
    credential: ProviderCredential,
    modelName: string,
  ): Promise<Result<CallModel>>;
  startCall(call: ModelCallRecord): Promise<Result<void>>;
  finishCall(input: {
    call: string;
    output: string | null;
    outcome: ModelOutcome;
    usage: TokenUsage;
    cost: CallCost;
    duration_ms: number | null;
    first_output_ms: number | null;
  }): Promise<Result<void>>;
  recordAvailability(
    provider: string,
    key: string,
    change: AvailabilityChange,
  ): Promise<Result<void>>;
  recordCheck(provider: string, check: ProviderCheck): Promise<Result<void>>;
};

export type ConnectionTestDeps = {
  port: ConnectionTestPort;
  invoke: InvokeModelCall;
  nowMs: () => number;
  newCallId: () => string;
  at: (ms: number) => string;
};

export function testBody(
  model: CallModel,
  kind: "text" | "tool_call",
): Record<string, unknown> {
  const text = kind === "text" ? TEST_TEXT_PROMPT : TEST_TOOL_PROMPT;
  const tool = kind === "tool_call";
  if (model.protocol === "anthropic-messages") {
    return buildMessages({
      model: model.name,
      max_tokens: TEST_MAX_OUTPUT,
      messages: [{ role: "user", content: [{ type: "text", text }] }],
      tools: tool
        ? [{ name: TEST_TOOL_NAME, input_schema: TEST_TOOL_SCHEMA }]
        : undefined,
    });
  }
  if (model.protocol === "openai-responses") {
    return buildResponses({
      model: model.name,
      input: [{
        type: "message",
        role: "user",
        content: [{ type: "input_text", text }],
      }],
      tools: tool
        ? [{
          type: "function",
          name: TEST_TOOL_NAME,
          parameters: TEST_TOOL_SCHEMA,
        }]
        : undefined,
      max_output_tokens: TEST_MAX_OUTPUT,
    }).body;
  }
  return buildChat({
    model: model.name,
    messages: [{ role: "user", content: text }],
    tools: tool
      ? [{
        type: "function",
        function: { name: TEST_TOOL_NAME, parameters: TEST_TOOL_SCHEMA },
      }]
      : undefined,
    max_tokens: TEST_MAX_OUTPUT,
  });
}

function costFor(model: CallModel): CallCost {
  // 구독 호출은 청구액을 모른다. 확정되지 않은 청구액은 모름으로 둔다(R27).
  if (model.billing_route === "subscription") {
    return {
      kind: "subscription",
      amount: null,
      currency: null,
      basis: null,
      confirmed_at: null,
    };
  }
  return {
    kind: "unknown",
    amount: null,
    currency: null,
    basis: null,
    confirmed_at: null,
  };
}

function emptyTokenUsage(revision: string): TokenUsage {
  return {
    input: null,
    output: null,
    cache_read: null,
    cache_write: null,
    reasoning: null,
    cache_in_input: null,
    reasoning_in_output: null,
    definition_revision: revision,
  };
}

// 사람이 명시로 요청한 test 한 번. 요청이 아닌 경로(설정 조회·상태 읽기)는 이 함수를
// 부르지 않는다(R29). 한 시도 최대 30초이고 실제 보낸 시도는 usage 기록에 남는다(R30).
// 반환의 check가 null이면 보내지 않았다(사용량 대기 credential, R24·R30).
export async function runConnectionTest(
  deps: ConnectionTestDeps,
  input: ConnectionTestInput,
  signal: AbortSignal,
): Promise<Result<{ check: ProviderCheck | null }>> {
  const loaded = await deps.port.readProvider(input.provider);
  if (!loaded.ok) return loaded;
  const provider = loaded.value;
  if (!provider.enabled) {
    return err({ code: "conflict", message: "provider is disabled" });
  }
  const credential = provider.credentials.find((entry) =>
    entry.key === input.credential_key
  );
  if (credential === undefined) {
    return err({ code: "not_found", message: "credential not found" });
  }
  if (!credential.enabled || credential.state === "revoked") {
    return err({ code: "conflict", message: "credential is not usable" });
  }
  const startedMs = deps.nowMs();
  // 사용량 대기는 reset까지 test call도 보내지 않는다. 그 model만 막힌 대기도 그 model
  // test에는 같다(R24, R30).
  if (credential.state === "usage_wait") {
    const until = credential.until === null
      ? NaN
      : Date.parse(credential.until);
    if (Number.isNaN(until) || until > startedMs) return ok({ check: null });
  }
  const block = credential.model_blocks.find((entry) =>
    entry.model_name === input.model_name
  );
  if (block !== undefined) {
    const until = block.until === null ? NaN : Date.parse(block.until);
    if (Number.isNaN(until) || until > startedMs) return ok({ check: null });
  }
  const resolved = await deps.port.resolveModel(
    provider,
    credential,
    input.model_name,
  );
  if (!resolved.ok) return resolved;
  const model = resolved.value;
  const body = testBody(model, input.test_kind);
  const hash = await sha256Hex(canonicalize(body));
  const callId = deps.newCallId();
  const revision = model.price_basis?.revision ?? "unknown";
  const record: ModelCallRecord = {
    id: callId,
    run: null,
    session: null,
    model_use: null,
    agent_hash: null,
    purpose: "connection_test",
    test_request: {
      command_key: input.command_key,
      test_kind: input.test_kind,
    },
    attempt_kind: "initial",
    attempt_order: 1,
    retry_of: null,
    credential_change_of: null,
    model,
    input: hash,
    context_basis: hash,
    output: null,
    state: "started",
    started_at: deps.at(startedMs),
    finished_at: null,
    duration_ms: null,
    first_output_ms: null,
    outcome: null,
    usage: emptyTokenUsage(revision),
    cost: {
      kind: "unknown",
      amount: null,
      currency: null,
      basis: null,
      confirmed_at: null,
    },
  };
  const started = await deps.port.startCall(record);
  if (!started.ok) return started;
  const invoked = await deps.invoke({
    callId,
    run: null,
    session: null,
    purpose: "connection_test",
    model,
    endpoint: provider.endpoint,
    inputHash: hash,
    contextBasisHash: hash,
    body,
    timeoutMs: CONNECTION_TEST_TIMEOUT_MS,
    usageRevision: revision,
  }, signal);
  // 보내기 전에 막힌 경우도 시도 기록은 닫는다. 원인은 알 수 없는 실패다.
  const output: ModelCallOutput = invoked.ok ? invoked.value : {
    id: callId,
    outcome: {
      kind: "failed",
      code: "unknown",
      retry_at: null,
      finish_reason: null,
      http_status: null,
      provider_code: null,
    },
    text: "",
    toolCalls: [],
    usage: emptyTokenUsage(revision),
    durationMs: deps.nowMs() - startedMs,
    firstOutputMs: null,
  };
  const material = output.outcome.kind === "complete" &&
    (input.test_kind === "text"
      ? output.text.trim().length > 0
      : output.toolCalls.some((call) => call.name === TEST_TOOL_NAME));
  // 응답은 왔지만 test 재료의 답이 아니면 실패다. 이유를 모르므로 unknown이다.
  const outcome: ModelOutcome = output.outcome.kind === "complete" && !material
    ? { ...output.outcome, kind: "failed", code: "unknown" }
    : output.outcome;
  const finished = await deps.port.finishCall({
    call: callId,
    output: null,
    outcome,
    usage: output.usage ?? emptyTokenUsage(revision),
    cost: costFor(model),
    duration_ms: output.durationMs,
    first_output_ms: output.firstOutputMs,
  });
  if (!finished.ok) return finished;
  const verdict = outcome.kind === "failed" ? output.verdict ?? null : null;
  if (verdict !== null) {
    const change = availabilityFromVerdict(
      verdict,
      credential,
      { modelName: model.name, nowMs: deps.nowMs() },
      deps.at,
    );
    if (change !== null) {
      const recorded = await deps.port.recordAvailability(
        provider.id,
        credential.key,
        change,
      );
      if (!recorded.ok) return recorded;
    }
  } else if (outcome.kind === "complete" && credential.state !== "available") {
    // 성공은 거절·대기 상태를 풀어 준다. 폐기(revoked)는 위에서 이미 걸러졌다.
    const recorded = await deps.port.recordAvailability(
      provider.id,
      credential.key,
      {
        state: "available",
        unavailable_reason: null,
        until: null,
        model_block: null,
      },
    );
    if (!recorded.ok) return recorded;
  }
  const check = checkOutcomeFrom(
    outcome,
    [callId],
    deps.at(deps.nowMs()),
    credential.key,
    credential.revision,
    model.name,
    input.test_kind,
    input.command_key,
  ).check;
  if (check === null) return ok({ check: null });
  const recordedCheck = await deps.port.recordCheck(provider.id, check);
  if (!recordedCheck.ok) return recordedCheck;
  return ok({ check });
}
