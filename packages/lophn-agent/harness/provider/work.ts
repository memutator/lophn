// model 호출 공통 interface(architecture §5.2). runtime 내부 interface는
// `invokeModelCall(input, signal)`이다. 세 adapter(anthropic-messages·
// openai-responses·openai-chat-completions)가 같은 입력·출력을 갖는다. SDK의
// 숨은 retry는 0이다: retry 횟수·간격·총 시도 수의 주인은 run-loop다(provider#R20).

import { err, type Result } from "../../../base/mod.ts";
import type {
  CallModel,
  ModelOutcome,
  ProviderCheck,
  TokenUsage,
} from "../../../contracts/lophn-agent/mod.ts";
import type { ToolCall } from "./adapters/messages.ts";
import type { SseOver } from "./adapters/stream.ts";

// 호출 입력. resolve가 준 판과 run 근거다(§5.2).
export type ModelCallInput = {
  run: string;
  session: string;
  purpose: "judgment" | "organizing";
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
};

// 호출 출력. 순서·대응을 보존한 text·tool requests다(§5.2).
export type ModelCallOutput = {
  id: string;
  outcome: ModelOutcome;
  text: string;
  toolCalls: ToolCall[];
  // 완성 확인 뒤 tool만 실행 대상이다. partial·failed의 tool은 없다.
  usage?: TokenUsage;
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

// 호출 한 번. check 연결 test와 run 판단이 같은 interface를 쓴다(R29).
export async function invokeOnce(
  options: {
    transport: (request: {
      url: string;
      method: string;
      headers: Record<string, string>;
      body: string;
    }) => Promise<Result<Response>>;
    url: string;
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
    // 연결 실패도 일시 분류다(R20).
  },
): Promise<Result<Response>> {
  try {
    return await options.transport({
      url: options.url,
      method: "POST",
      headers: options.headers,
      body: options.body,
    });
  } catch (error) {
    // transport가 던진 예외는 연결 실패다. 일시 분류는 failures.ts가 맡는다(T15).
    void error;
    return err({ code: "unavailable", message: "전송에 실패했다" });
  }
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
