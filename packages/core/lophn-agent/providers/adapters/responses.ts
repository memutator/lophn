// OpenAI Responses adapter. 요청 번역(instructions·input items·
// function tools, store=false, stream=true)과 SSE 응답 번역(output_index 누적,
// output_item.done 확정, response.completed 판정, usage 정규화)을 여기 둔다.
// function_call.call_id↔function_call_output.call_id 대응과 encrypted reasoning
// item의 turn 메모리 재전송도 여기다. 오류 코드의 HTTP·본문 분류는 failures.ts가
// 맡는다. 실제 OpenAI API는 부르지 않는다.

import type { TokenUsage } from "../../../../protocol/lophn-agent/mod.ts";
import type { JsonObject } from "../../../../protocol/base/mod.ts";
import type { ToolCall } from "./messages.ts";
import { mergeRequestPatch } from "./request-patch.ts";
import type { SseFrame } from "./stream.ts";

// 요청 item. prompt-assemble이 준 Anthropic 블록을 Responses item으로 바꾼다.
type ResponsesItem = {
  type: string;
  role?: string;
  content?: unknown;
  id?: string;
  call_id?: string;
  name?: string;
  arguments?: string;
  output?: string | unknown[];
  summary?: unknown;
  encrypted_content?: string;
};

type ResponsesTool = {
  type: "function";
  name: string;
  description?: string;
  strict?: boolean;
  parameters?: unknown;
};

// Responses 요청값. store=false와 stream=true는 고정이다.
const RESPONSES_REQUEST_FIELDS = {
  store: false,
  stream: true,
} as const;

// function_call_output.output 배열에 싣는 이미지 item이다.
export function imageItem(mediaType: string, dataBase64: string): unknown {
  return {
    type: "input_image",
    image_url: `data:${mediaType};base64,${dataBase64}`,
  };
}

// function_call_output의 call_id만 모은다. function_call 자체의 call_id는 짝
// 근거가 아니다(짝 없는 call이 스스로를 답으로 세면 안 된다).
function collectCallIds(items: readonly unknown[]): Set<string> {
  const ids = new Set<string>();
  for (const item of items) {
    if (item === null || typeof item !== "object") continue;
    const typed = item as ResponsesItem;
    if (typed.type !== "function_call_output") continue;
    if (typeof typed.call_id === "string") ids.add(typed.call_id);
  }
  return ids;
}

// reasoning item. encrypted_content가 있는 것만 메모리 대상이다(store=false로
// 보내는 동안 item id 재참조가 없으므로 원문을 다시 보낸다).
function reasoningItemOf(item: ResponsesItem): string | undefined {
  return typeof item.encrypted_content === "string" &&
      item.encrypted_content.length > 0
    ? item.encrypted_content
    : undefined;
}

// 입력 item을 짝에 맞게 정리한다. 짝 없는 function_call은 제거하고, 제거 뒤
// reasoning item은 그 턴의 대응이 깨졌으므로 빼서 보내지 않는다(Codex 조사:
// id만 replay하면 "provided without its required reasoning item" 400).
function pairedItems(
  items: readonly unknown[],
): { items: unknown[]; reasoning: string[] } {
  const answered = collectCallIds(items);
  const output: unknown[] = [];
  const reasoning: string[] = [];
  for (const item of items) {
    if (item === null || typeof item !== "object") continue;
    const typed = item as ResponsesItem;
    if (typed.type === "function_call") {
      // 짝 없는 function_call은 제거한다.
      if (typed.call_id === undefined || !answered.has(typed.call_id)) continue;
      output.push(item);
      continue;
    }
    if (typed.type === "reasoning") {
      const encrypted = reasoningItemOf(typed);
      if (encrypted !== undefined) reasoning.push(encrypted);
      // reasoning item은 요청에 재전송 대상에서 뺀다. turn 메모리로만 산다.
      continue;
    }
    output.push(item);
  }
  return { items: output, reasoning };
}

// 요청 본문 번역. endpoint는 API base이고 path는 transport가 붙인다.
export function buildRequest(input: {
  model: string;
  instructions?: unknown;
  input: readonly unknown[];
  tools?: readonly ResponsesTool[];
  max_output_tokens: number;
  // 재전송 대상 encrypted reasoning 원문들. reasoningFor가 준 값이다.
  reasoning?: readonly string[];
  // 상태 없이 계속 가능한지 검증 뒤의 결과다.
  stateFree?: { protocol: "openai-responses"; reasoningRequired: boolean };
  // option 값이 싣는 조각이다. 만든 body에 깊게 합친다.
  request_patch?: JsonObject;
}): { body: Record<string, unknown> } {
  const paired = pairedItems(input.input);
  const body: Record<string, unknown> = {
    model: input.model,
    ...RESPONSES_REQUEST_FIELDS,
    input: paired.items,
    max_output_tokens: input.max_output_tokens,
  };
  if (input.instructions !== undefined) {
    body.instructions = input.instructions;
  }
  if (input.tools?.length) {
    body.tools = input.tools;
  }
  // reasoning 재전송 대상이 있으면 state-free 계속을 검증한다(검증의 실제
  // 호출 자리는 invoke.ts다). 메모리 상태가
  // 없을 때(restart·compaction)도 Responses는 계속 가능하다 — reasoning item을
  // 빼도 function_call·call_id 대응이 남는다. 통과하지 못하는
  // protocol(서명 필수 Anthropic)은 messages.ts의 reasoningFor가 실패를 낸다.
  if (input.reasoning?.length) {
    body.reasoning = { include: ["reasoning.encrypted_content"] };
  }
  return { body: mergeRequestPatch(body, input.request_patch) };
}

// ── SSE 응답 번역 ────────���────────────────────────────────────────────────

// stream 결과. tool 인자는 response.output_item.done을 본 것만 완성이다.
type ResponsesStreamResult = {
  text: string;
  // 사람이 읽을 reasoning 요약. null은 reasoning이 없었다. ""는 있었지만 요약이 없다.
  reasoning: string | null;
  // 마지막으로 요약 글을 더한 자리. 자리가 바뀌면 "\n\n"으로 잇는다.
  lastSummary: { itemId: string; summaryIndex: number } | null;
  // 마지막 reasoning item이 끝났다. delta 시각을 재는 쪽이 그 끝을 안다.
  reasoningEnded: boolean;
  toolCalls: ToolCall[];
  // 인자가 완성된 function call. done을 보지 못한 call은 여기 없다.
  completedCallIds: string[];
  responseStatus?: "completed" | "incomplete" | "failed";
  incompleteReason?: string;
  responseEnded: boolean;
  usage?: TokenUsage;
  // response.failed의 provider code·message. 오류 본문은 보존하지 않는다.
  errorType?: string;
  errorMessage?: string;
  // encrypted reasoning 원문들. turn 메모리로만 산다.
  reasoningItems: string[];
  // 만나지 않은 event는 여기 세지 않는다.
  sawUnknownEvent: boolean;
};

export function createResponsesStreamResult(): ResponsesStreamResult {
  return {
    text: "",
    reasoning: null,
    lastSummary: null,
    reasoningEnded: false,
    toolCalls: [],
    completedCallIds: [],
    responseEnded: false,
    reasoningItems: [],
    sawUnknownEvent: false,
  };
}

// reasoning item의 encrypted_content와 끝을 결과로 모은다. 사람이 읽을 요약 글은
// applyFrame이 `reasoning`으로 따로 모은다.
function collectReasoning(
  out: ResponsesStreamResult,
  item: Record<string, unknown>,
): void {
  if (item.type !== "reasoning") return;
  out.reasoning ??= "";
  out.reasoningEnded = true;
  const encrypted = item.encrypted_content;
  if (typeof encrypted === "string" && encrypted.length > 0) {
    out.reasoningItems.push(encrypted);
  }
}

// output_item.done 하나를 누적한다. Codex는 function_call_arguments.delta를
// 무시하고 done의 전체 arguments만 쓴다.
function applyItemDone(
  out: ResponsesStreamResult,
  item: Record<string, unknown>,
): void {
  collectReasoning(out, item);
  if (item.type !== "function_call") return;
  const callId = typeof item.call_id === "string" ? item.call_id : undefined;
  const name = typeof item.name === "string" ? item.name : undefined;
  const args = typeof item.arguments === "string" ? item.arguments : "";
  if (callId === undefined || name === undefined) return;
  if (!out.toolCalls.some((call) => call.id === callId)) {
    out.toolCalls.push({ id: callId, name, args });
  }
  if (!out.completedCallIds.includes(callId)) {
    out.completedCallIds.push(callId);
  }
}

// frame 하나를 누적한다. message·function_call item은 output_index로 slot을 찾는다.
function applyFrame(out: ResponsesStreamResult, frame: SseFrame): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame.data);
  } catch {
    // 잘못된 JSON frame은 그 event만 버린다.
    return;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    out.sawUnknownEvent = true;
    return;
  }
  const record = parsed as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : undefined;
  if (type === undefined) {
    out.sawUnknownEvent = true;
    return;
  }
  if (type === "response.output_item.done") {
    const item = record.item;
    if (item !== null && typeof item === "object" && !Array.isArray(item)) {
      applyItemDone(out, item as Record<string, unknown>);
    }
    return;
  }
  if (type === "response.output_text.delta") {
    const delta = record.delta;
    if (typeof delta === "string") out.text += delta;
    return;
  }
  if (type === "response.output_item.added") {
    // delta 누적은 output_item.done이 확정 신호다. added는 관측만 한다.
    const item = record.item;
    if (
      item !== null && typeof item === "object" && !Array.isArray(item) &&
      (item as Record<string, unknown>).type === "reasoning"
    ) {
      out.reasoning ??= "";
      out.reasoningEnded = false;
    }
    return;
  }
  if (type === "response.reasoning_summary_text.delta") {
    const delta = record.delta;
    if (typeof delta !== "string" || delta === "") return;
    out.reasoning ??= "";
    const itemId = typeof record.item_id === "string" ? record.item_id : "";
    const summaryIndex = typeof record.summary_index === "number"
      ? record.summary_index
      : -1;
    const samePlace = out.lastSummary?.itemId === itemId &&
      out.lastSummary?.summaryIndex === summaryIndex;
    if (out.reasoning !== "" && !samePlace) out.reasoning += "\n\n";
    out.reasoning += delta;
    out.lastSummary = { itemId, summaryIndex };
    return;
  }
  if (type === "response.completed" || type === "response.incomplete") {
    const response = record.response;
    if (response !== null && typeof response === "object") {
      const inner = response as Record<string, unknown>;
      const usage = inner.usage;
      if (usage !== null && typeof usage === "object") {
        out.usage = responsesUsage(usage as Record<string, unknown>);
      }
      const reason = (inner.incomplete_details as
        | { reason?: unknown }
        | undefined)?.reason;
      if (typeof reason === "string") out.incompleteReason = reason;
    }
    out.responseStatus = type === "response.completed"
      ? "completed"
      : "incomplete";
    out.responseEnded = true;
    return;
  }
  if (type === "response.failed") {
    const response = record.response;
    const error = (response as Record<string, unknown> | undefined)?.error as
      | { code?: unknown; message?: unknown }
      | undefined;
    out.errorType = typeof error?.code === "string" ? error.code : "?";
    out.errorMessage = typeof error?.message === "string"
      ? error.message
      : undefined;
    out.responseStatus = "failed";
    out.responseEnded = true;
    return;
  }
  // function_call_arguments.delta와 reasoning 요약의 part·done event는 무시한다.
  // 요약 글(delta)은 위에서 받는다.
  if (
    type.startsWith("response.reasoning_summary") ||
    type.startsWith("response.reasoning_text") ||
    type.startsWith("response.output_text.annotation") ||
    type === "response.created" || type === "response.in_progress" ||
    type === "response.queued" ||
    type === "response.content_part.added" ||
    type === "response.content_part.done" ||
    type === "response.output_text.done" ||
    type === "response.refusal.delta" ||
    type === "response.refusal.done" ||
    type === "ping"
  ) {
    return;
  }
  out.sawUnknownEvent = true;
}

// push 후 호출한다.
export function applyResponsesFrames(
  out: ResponsesStreamResult,
  frames: readonly SseFrame[],
): void {
  for (const frame of frames) applyFrame(out, frame);
}

// usage 정규화. OpenAI는 cache를 input 합계 안에 둔다. 새 입력은
// input에서 cached를 빼고 하한 0이다. 값 모름은 0이 아니라 null이다.
function responsesUsage(raw: Record<string, unknown>): TokenUsage {
  const inputDetails = raw.input_tokens_details as
    | { cached_tokens?: unknown }
    | undefined;
  const outputDetails = raw.output_tokens_details as
    | { reasoning_tokens?: unknown }
    | undefined;
  const inputTokens = asCount(raw.input_tokens);
  const cached = asCount(inputDetails?.cached_tokens);
  const input = inputTokens !== null && cached !== null
    ? Math.max(0, inputTokens - cached)
    : inputTokens;
  return {
    input,
    output: asCount(raw.output_tokens),
    cache_read: cached,
    cache_write: asCount(raw.cache_write_tokens),
    reasoning: asCount(outputDetails?.reasoning_tokens),
    // OpenAI는 cache를 input 합계 안에 둔다.
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

// ── 종료 판정 ─────────���───────────────────────────────────────────────────

type Verdict = {
  kind: "complete" | "partial" | "refused" | "failed";
  // failed일 때만 실패 코드다(ModelOutcome과 같은 근원).
  code?: "temporary" | "refused" | "unknown";
  providerCode?: string;
};

// 판정 표. response.completed만 complete다. tool 인자는
// output_item.done을 본 것만 완성이다. incomplete(max_output_tokens
// 포함)·response.failed는 partial/failed이고 tool은 미실행이다.
export function judgeResponses(out: ResponsesStreamResult): Verdict {
  if (out.responseStatus === "failed") {
    // 원인을 모르는 종류는 unknown이다. 인증 실패로 올리지 않는다.
    return {
      kind: "failed",
      code: "unknown",
      providerCode: out.errorType,
    };
  }
  // response.completed·response.incomplete를 보지 못하고 끝난 스트림은 단절이다.
  if (!out.responseEnded) return { kind: "partial" };
  if (out.responseStatus === "incomplete") {
    // content_filter 거절은 refused다.
    if (out.incompleteReason === "content_filter") {
      return { kind: "refused", providerCode: "content_filter" };
    }
    // max_output_tokens 포함 나머지 incomplete는 잘림이다. tool은 미실행이다.
    return { kind: "partial" };
  }
  // completed여도 tool 인자가 output_item.done으로 확정되지 않았으면 partial이다.
  for (const call of out.toolCalls) {
    if (!out.completedCallIds.includes(call.id)) return { kind: "partial" };
    // tool 인자는 JSON 검증 뒤에만 완성이다(부분 JSON을 성공으로 내지 않는다).
    if (!verifiedJsonObject(call.args)) return { kind: "partial" };
  }
  return { kind: "complete" };
}

function verifiedJsonObject(text: string): boolean {
  if (text.trim().length === 0) return true;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed === null || typeof parsed === "object" &&
        !Array.isArray(parsed);
  } catch {
    return false;
  }
}
