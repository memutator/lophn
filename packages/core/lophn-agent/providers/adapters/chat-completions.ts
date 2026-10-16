// OpenAI Chat Completions adapter. 요청 번역(messages·tools,
// stream=true, stream_options.include_usage)과 SSE 응답 번역(delta.tool_calls를
// index로 누적, finish_reason 판정, usage 정규화)을 여기 둔다. tool_calls[].id↔
// tool message tool_call_id 대응, DeepSeek reasoning_content 제외, Gemini OpenAI
// 호환 endpoint, Ollama·LM Studio·llama.cpp loopback 무인증과 tool call id 누락
// 처리를 여기다. 오류 코드의 HTTP·본문 분류는 failures.ts가 맡는다.

import type { TokenUsage } from "../../../../protocol/lophn-agent/mod.ts";
import type { JsonObject } from "../../../../protocol/base/mod.ts";
import type { ToolCall } from "./messages.ts";
import { quirksFor, verifiedJsonObject } from "./compat.ts";
import { mergeRequestPatch } from "./request-patch.ts";
import type { SseFrame } from "./stream.ts";

// Chat 요청 message. Anthropic 블록을 Chat messages로 바꾼다.
export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | unknown[];
  tool_calls?: {
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
};

export type ChatTool = {
  type: "function";
  function: { name: string; description?: string; parameters?: unknown };
};

// stream_options.include_usage는 고정이다(조사 문서 797–1002).
export const STREAM_OPTIONS = { include_usage: true } as const;

// 이미지는 tool message에 실을 수 없어 뒤따르는 user message의 content part로 보낸다.
export function imagePart(mediaType: string, dataBase64: string): unknown {
  return {
    type: "image_url",
    image_url: { url: `data:${mediaType};base64,${dataBase64}` },
  };
}

// 답을 기다리는 tool_call_id만 모은다. tool 메시지가 참조하는 id가 답의 근거다.
// assistant tool_calls의 id는 스스로를 답으로 세면 안 되므로 근거가 아니다.
function collectToolCallIds(messages: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const message of messages) {
    if (message === null || typeof message !== "object") continue;
    const record = message as { role?: unknown; tool_call_id?: unknown };
    if (record.role !== "tool") continue;
    if (typeof record.tool_call_id === "string") {
      ids.add(record.tool_call_id);
    }
  }
  return ids;
}

// 짝 없는 assistant tool_calls와 tool 메시지를 제거한다. 대응은 tool_calls[].id ↔
// tool message tool_call_id다. provider가 tool call id를 빼먹은 것(Ollama·
// llama.cpp)은 짝을 볼 수 없으므로 제거 대상이 아니다: id 없는 tool_calls는
// 순서 기준으로 남기고, id 없는 tool message는 앞의 tool_calls에 맞춘다.
function pairedMessages(
  messages: readonly unknown[],
  // DeepSeek은 assistant 메시지마다 reasoning_content 필수다(조사 문서 1378–1384).
  provider?: string,
): unknown[] {
  const answered = collectToolCallIds(messages);
  const output: unknown[] = [];
  for (const message of messages) {
    if (message === null || typeof message !== "object") continue;
    const record = message as ChatMessage;
    if (record.role === "tool") {
      // tool 메시지는 짝 있는 tool_call_id만 남긴다.
      if (
        typeof record.tool_call_id === "string" &&
        !answered.has(record.tool_call_id)
      ) {
        continue;
      }
      output.push(message);
      continue;
    }
    if (record.role === "assistant") {
      if (Array.isArray(record.tool_calls)) {
        const kept = record.tool_calls.filter((call) =>
          call === null || typeof call !== "object" ||
          typeof (call as { id?: unknown }).id !== "string" ||
          answered.has((call as { id: string }).id)
        );
        // 짝 없는 tool_call만 있던 턴(빈 tool_calls)은 제거다.
        if (kept.length === 0) continue;
        const next: Record<string, unknown> = { ...record, tool_calls: kept };
        applyPadding(next, provider);
        output.push(next);
        continue;
      }
      // tool_calls 없는 assistant 턴도 DeepSeek 필수 quirk 대상이다.
      const next: Record<string, unknown> = { ...record };
      applyPadding(next, provider);
      output.push(next);
      continue;
    }
    output.push(message);
  }
  return output;
}

// DeepSeek 필수 quirk: reasoning_content 없는 assistant 턴은 공백 하나로 채운다
// (빈 문자열은 거절이다). 사람이 읽을 reasoning 본문은 요청에 보내지 않는다.
function applyPadding(
  message: Record<string, unknown>,
  provider?: string,
): void {
  if (provider === undefined) return;
  if (!quirksFor(provider).reasoning_content_required) return;
  if (message.reasoning_content === undefined) {
    message.reasoning_content = " ";
  }
}

// 요청 본문 번역. endpoint는 API base이고 path는 transport가 붙인다(§5.2).
export function buildRequest(input: {
  model: string;
  messages: readonly unknown[];
  tools?: readonly ChatTool[];
  max_tokens: number;
  // provider 정의 key다. model 이름이 아니다.
  provider?: string;
  // 지시문은 system message 하나로 온다(prompt-assemble이 번역한다).
  system?: string;
  // option 값이 싣는 조각이다. 만든 body에 깊게 합친다.
  request_patch?: JsonObject;
}): Record<string, unknown> {
  const messages = pairedMessages(input.messages, input.provider);
  const body: Record<string, unknown> = {
    model: input.model,
    stream: true,
    stream_options: STREAM_OPTIONS,
    messages,
    max_tokens: input.max_tokens,
  };
  if (input.system !== undefined) {
    body.messages = [{ role: "system", content: input.system }, ...messages];
  }
  if (input.tools?.length) {
    body.tools = input.tools;
  }
  return mergeRequestPatch(body, input.request_patch);
}

// ── SSE 응답 번역 ─────────────────────────────────────────────────────────

// tool call 조각. index로 slot을 찾아 더한다(조사 문서 401–551). provider가 id를
// 빼먹은 조각(Ollama·llama.cpp)은 id가 빈 채로 남고 순서 기준 표시자로 대응한다.

// stream 결과. tool 인자는 finish_reason chunk를 본 것만 완성이다.
export type ChatStreamResult = {
  text: string;
  toolCalls: ToolCall[];
  // finish_reason을 본 뒤 확정된 tool. 못 본 call은 여기 없다.
  completedToolIds: string[];
  finishReason?: string;
  // usage는 finish chunk보다 앞설 수도 있다(vLLM이 finish chunk를 삼킨다).
  usage: TokenUsage | undefined;
  // finish_reason 없이 스트림이 끝났다. 단절이다.
  streamEndedWithoutFinish: boolean;
  // in-stream error frame의 종류·메시지. 오류 본문은 보존하지 않는다.
  errorType?: string;
  errorMessage?: string;
  // [DONE] sentinel을 봤다. sentinel 앞에 끝난 것도 단절은 아니다(연결 종료).
  sawDone: boolean;
  // 잘못된 JSON·모르는 꼴을 만났다. 관측 기록이다.
  sawUnknownEvent: boolean;
  // 범위 밖 tool call index를 만났다. 일부 call만 남은 것이라 완성이 아니다.
  sawBadToolIndex: boolean;
};

// 한 응답의 tool call slot 상한. 범위 밖 index로 거대한 희소 배열을 만들지 않는다.
export const MAX_CHAT_TOOL_CALLS = 128;

export function createChatStreamResult(): ChatStreamResult {
  return {
    text: "",
    toolCalls: [],
    completedToolIds: [],
    usage: undefined,
    streamEndedWithoutFinish: false,
    sawDone: false,
    sawUnknownEvent: false,
    sawBadToolIndex: false,
  };
}

// delta.tool_calls[].function.arguments 조각을 index로 더한다.
function applyDeltaToolCalls(
  out: ChatStreamResult,
  toolCalls: unknown[],
): void {
  for (const entry of toolCalls) {
    if (entry === null || typeof entry !== "object") continue;
    const piece = entry as {
      index?: unknown;
      id?: unknown;
      function?: { name?: unknown; arguments?: unknown };
    };
    const index = piece.index;
    if (
      typeof index !== "number" || !Number.isInteger(index) || index < 0 ||
      index >= MAX_CHAT_TOOL_CALLS
    ) {
      out.sawUnknownEvent = true;
      out.sawBadToolIndex = true;
      continue;
    }
    const slot = out.toolCalls[index] ?? { id: "", name: "", args: "" };
    out.toolCalls[index] = slot;
    if (typeof piece.id === "string" && piece.id.length > 0) {
      slot.id = piece.id;
    }
    if (typeof piece.function?.name === "string") {
      slot.name = piece.function.name;
    }
    if (typeof piece.function?.arguments === "string") {
      slot.args += piece.function.arguments;
    }
  }
}

// choice 하나를 누적한다. reasoning 본문 필드(reasoning_content 등)는 누적
// 대상이 아니다 — content만 더하므로 자연히 제외된다.
function applyChoice(
  out: ChatStreamResult,
  choice: Record<string, unknown>,
): void {
  if (typeof choice.finish_reason === "string") {
    out.finishReason = choice.finish_reason;
  }
  const delta = choice.delta;
  if (delta === null || typeof delta !== "object") return;
  const record = delta as Record<string, unknown>;
  if (typeof record.content === "string") {
    out.text += record.content;
  }
  if (Array.isArray(record.tool_calls)) {
    applyDeltaToolCalls(out, record.tool_calls);
  }
}

// frame 하나를 누적한다. choices 없는 chunk는 usage 전용이다(조사 문서 3048–3071).
function applyFrame(out: ChatStreamResult, frame: SseFrame): void {
  const data = frame.data;
  if (data === "[DONE]") {
    out.sawDone = true;
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    // 잘못된 JSON frame은 그 event만 버린다.
    return;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    out.sawUnknownEvent = true;
    return;
  }
  const record = parsed as Record<string, unknown>;
  if (record.error !== undefined) {
    const error = record.error as { code?: unknown; message?: unknown };
    out.errorType = typeof error.code === "string" ? error.code : "?";
    out.errorMessage = typeof error.message === "string"
      ? error.message
      : undefined;
    return;
  }
  const usage = record.usage;
  if (usage !== null && typeof usage === "object") {
    out.usage = chatUsage(usage as Record<string, unknown>);
  }
  const choices = record.choices;
  if (!Array.isArray(choices)) return;
  // choices 빈 배열은 usage 전용 chunk다.
  for (const choice of choices) {
    if (choice !== null && typeof choice === "object") {
      applyChoice(out, choice as Record<string, unknown>);
    }
  }
}

// push 후 호출한다.
export function applyChatFrames(
  out: ChatStreamResult,
  frames: readonly SseFrame[],
): void {
  for (const frame of frames) applyFrame(out, frame);
}

// 마친 뒤 finish_reason을 못 본 상태로 끝난 것을 표시한다. finish_reason 없는
// 종료는 partial이다(조사 문서 690–698).
export function finishChatStream(out: ChatStreamResult): void {
  if (out.finishReason === undefined) {
    out.streamEndedWithoutFinish = true;
  }
}

// usage 정규화(조사 문서 표). Chat는 prompt_tokens에 cache가 포함이다. cached는
// prompt_tokens_details.cached_tokens ?? prompt_cache_hit_tokens ?? 뒷면 필드 순으로
// 본다(조사 문서 1511–1552). 새 입력은 prompt에서 cached를 빼고 하한 0이다.
export function chatUsage(raw: Record<string, unknown>): TokenUsage {
  const promptDetails = raw.prompt_tokens_details as
    | { cached_tokens?: unknown }
    | undefined;
  const completionDetails = raw.completion_tokens_details as
    | { reasoning_tokens?: unknown }
    | undefined;
  const promptTokens = asCount(raw.prompt_tokens);
  const cached = asCount(promptDetails?.cached_tokens) ??
    asCount(raw.prompt_cache_hit_tokens) ??
    asCount(raw.cached_tokens);
  const input = promptTokens !== null && cached !== null
    ? Math.max(0, promptTokens - cached)
    : promptTokens;
  return {
    input,
    output: asCount(raw.completion_tokens),
    cache_read: cached,
    cache_write: asCount(raw.cache_write_tokens),
    reasoning: asCount(completionDetails?.reasoning_tokens) ??
      asCount(raw.reasoning_tokens),
    // Chat도 cache를 input 합계 안에 둔다(조사 문서 표).
    cache_in_input: true,
    reasoning_in_output: true,
    definition_revision: "",
  };
}

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

// ── 종료 판정 ─────────────────────────────────────────────────────────────

export type Verdict = {
  kind: "complete" | "partial" | "refused" | "failed";
  // failed일 때만 실패 코드다(ModelOutcome과 같은 근원).
  code?: "temporary" | "refused" | "unknown";
  providerCode?: string;
};

// 판정 표(조사 문서). stop·tool_calls만 complete다. length·단절은 partial이다.
// finish_reason 없는 종료는 partial이다.
export function judgeChat(out: ChatStreamResult): Verdict {
  if (out.errorType !== undefined || out.errorMessage !== undefined) {
    // 원인을 모르는 종류는 unknown이다. 인증 실패로 올리지 않는다.
    return {
      kind: "failed",
      code: "unknown",
      providerCode: out.errorType,
    };
  }
  // finish_reason 없이 끝난 스트림은 단절이다.
  if (out.finishReason === undefined || out.streamEndedWithoutFinish) {
    return { kind: "partial" };
  }
  if (out.finishReason === "tool_calls") {
    if (out.toolCalls.length === 0 || out.sawBadToolIndex) {
      return { kind: "partial" };
    }
    for (const call of out.toolCalls) {
      // toolCalls는 index로 찬 희소 배열이다. content 조각이 없는 index는 구멍이다.
      if (call === undefined) return { kind: "partial" };
      if (
        !out.completedToolIds.includes(
          call.id === "" ? `idx:${out.toolCalls.indexOf(call)}` : call.id,
        )
      ) {
        return { kind: "partial" };
      }
      // tool 인자는 JSON 검증 뒤에만 완성이다(part JSON은 성공이 아니다).
      if (!verifiedJsonObject(call.args)) return { kind: "partial" };
    }
    return { kind: "complete" };
  }
  if (out.finishReason === "length") return { kind: "partial" };
  if (out.finishReason === "content_filter") {
    return { kind: "refused", providerCode: "content_filter" };
  }
  if (out.finishReason === "stop") return { kind: "complete" };
  // 모르는 finish_reason은 partial이다. 다른 값으로 추측하지 않는다.
  return { kind: "partial" };
}

// finishReason을 본 뒤 completedToolIds를 채운다. tool call의 완성 신호는
// finish_reason chunk다. provider가 id를 빼먹은 call은 순서 기준
// 표시자로 채운다(Ollama·llama.cpp).
export function completeToolCalls(out: ChatStreamResult): void {
  if (out.finishReason === undefined) return;
  for (const call of out.toolCalls) {
    if (call === undefined) continue;
    const id = call.id === "" ? `idx:${out.toolCalls.indexOf(call)}` : call.id;
    if (!out.completedToolIds.includes(id)) out.completedToolIds.push(id);
  }
}
