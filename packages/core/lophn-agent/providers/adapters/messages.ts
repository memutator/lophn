// Anthropic Messages adapter. 요청 번역(system·messages·tools,
// tool_use.id↔tool_result 대응, cache 표시, opaque 상태 재전송)과 SSE 응답 번역
// (frame 누적, complete/partial/refused/failed 판정, usage 정규화)을 여기 둔다.
// 오류 코드의 HTTP·본문 분류는 failures.ts가 맡는다.

import type { TokenUsage } from "../../../../protocol/lophn-agent/mod.ts";
import type { JsonObject } from "../../../../protocol/base/mod.ts";
import { recordOf } from "../issuer-http.ts";
import { mergeRequestPatch } from "./request-patch.ts";
import { noteUnknownEvent, type SseFrame } from "./stream.ts";

// Anthropic thinking.signature와 redacted_thinking.data 원문. 사람이 읽을
// 본문(thinking text)은 상태에 두지 않고, 응답 결과의 `reasoning`으로 따로 모은다.
type OpaqueReasoningState = {
  signature?: string;
  data?: string;
};

// 같은 turn·같은 provider·같은 model 메모리에서만 재사용한다. provider나
// model이 바뀌면 버리고, turn 종료 시 폐기한다. blob·trace에 남지 않는다.

// 시그니처가 필요한데 메모리가 비어 있으면(restart·compaction) state-free 재시도를
// 하지 않고 실패한다.

type AnthropicBlock = {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | unknown[];
  signature?: string;
  data?: string;
};

type ToolDefinition = {
  name: string;
  description?: string;
  input_schema: unknown;
};

// cache 표시. 타입은 ephemeral뿐이다. ttl 필드를 보내지 않으면 5분 기본이다(구독은 claude-code.ts가 1시간으로 바꾼다).
// 표시는 system 층 둘(turn-prompt.ts의 CACHED)과 대화 쪽 둘이라 Anthropic 상한 4개 안이다.
// tools는 system 앞이라 workspace 종류 층 표시가 함께 덮는다.
const CACHE_CONTROL = { type: "ephemeral" } as const;

function withMark(message: unknown): unknown {
  const record = recordOf(message);
  if (record === null || !Array.isArray(record.content)) return message;
  const blocks = [...record.content];
  const end = recordOf(blocks[blocks.length - 1]);
  if (end === null) return message;
  blocks[blocks.length - 1] = { ...end, cache_control: CACHE_CONTROL };
  return { ...record, content: blocks };
}

// Anthropic이 한 요청에 받는 표시 수다. 넘으면 요청 전체를 거절한다.
const CACHE_MARKS_MAX = 4;

function marksIn(value: unknown): number {
  if (Array.isArray(value)) {
    return value.reduce((sum: number, item) => sum + marksIn(item), 0);
  }
  const record = recordOf(value);
  if (record === null) return 0;
  return record.cache_control === undefined ? 0 : 1;
}

// 대화 쪽 표시. 마지막 message와 그 앞 user message의 마지막 block에 달고 원본은 고치지 않는다.
// 끝 block은 새로 생긴 tool 결과나 사람 글이라 다음 call이 이 call이 쓴 prefix를 읽는다. Anthropic은 표시마다
// 앞쪽 20 block까지만 찾아서, 한 call에 tool 결과가 많이 늘면 끝 표시 하나로는 앞 call의 entry에 닿지 못한다.
// 그 앞 user message 표시가 두 번째 찾기의 출발점이다. system·tools가 쓴 표시를 뺀 남은 자리만 쓴다.
function markConversation(
  messages: readonly unknown[],
  room: number,
): unknown[] {
  const out = [...messages];
  const last = out.length - 1;
  if (last < 0 || room <= 0) return out;
  out[last] = withMark(out[last]);
  if (room < 2) return out;
  for (let at = last - 2; at >= 0; at--) {
    if (recordOf(out[at])?.role === "user") {
      out[at] = withMark(out[at]);
      break;
    }
  }
  return out;
}

// tool 결과 안의 이미지 block이다.
export function imageBlock(mediaType: string, dataBase64: string): unknown {
  return {
    type: "image",
    source: { type: "base64", media_type: mediaType, data: dataBase64 },
  };
}

// tool_use.id와 tool_result.tool_use_id 대응. 짝 없는 조각은 제거하고, 제거로
// 시그니처가 깨진 턴은 그 시그니처를 재전송하지 않는다(Hermes 487–524).
function pairedMessages(
  messages: readonly unknown[],
  reasoning: OpaqueReasoningState | undefined,
): unknown[] {
  const used = new Set<string>();
  for (const message of messages) {
    if (message === null || typeof message !== "object") continue;
    const content = (message as { content?: unknown }).content;
    if (!Array.isArray(content)) continue;
    for (const block of content) {
      if (
        block !== null &&
        typeof block === "object" &&
        (block as AnthropicBlock).type === "tool_result" &&
        typeof (block as AnthropicBlock).tool_use_id === "string"
      ) {
        used.add((block as AnthropicBlock).tool_use_id!);
      }
    }
  }
  return messages.map((message) => {
    if (message === null || typeof message !== "object") return message;
    const record = message as { role?: string; content?: unknown };
    if (!Array.isArray(record.content)) return message;
    const content = record.content
      .map((block) => {
        if (block === null || typeof block !== "object") return block;
        const typed = block as AnthropicBlock;
        if (typed.type === "tool_use") {
          // 짝이 없는 tool_use는 제거한다.
          return used.has(typed.id ?? "") ? block : null;
        }
        if (typed.type === "thinking") {
          return pairedThinking(typed, reasoning);
        }
        if (typed.type === "redacted_thinking") {
          return pairedRedacted(typed, reasoning);
        }
        return block;
      })
      .filter((block) => block !== null);
    return { ...record, content };
  });
}

function pairedThinking(
  block: AnthropicBlock,
  reasoning: OpaqueReasoningState | undefined,
): AnthropicBlock {
  // 상태에는 원문 signature만 산다. 메모리에 상태가 없으면(다른 provider·model,
  // turn 종료) 이 블록의 signature를 지워 전송 대상에서 뺀다. 메모리에 있으면
  // 블록을 원문 그대로 보낸다. 시그니처 비교는 compat.ts가 맡는다.
  if (block.signature === undefined) return block;
  if (reasoning?.signature === undefined) {
    return { ...block, signature: undefined };
  }
  return block;
}

function pairedRedacted(
  block: AnthropicBlock,
  reasoning: OpaqueReasoningState | undefined,
): AnthropicBlock {
  if (block.data === undefined) return block;
  if (reasoning?.data === undefined) {
    return { ...block, data: undefined };
  }
  return block;
}

// 요청 본문 번역. endpoint는 API base이고 path는 transport가 붙인다.
export function buildRequest(input: {
  model: string;
  max_tokens: number;
  system?: unknown;
  messages: readonly unknown[];
  tools?: readonly ToolDefinition[];
  reasoning?: OpaqueReasoningState | undefined;
  // option 값이 싣는 조각이다. 만든 body에 깊게 합친다.
  request_patch?: JsonObject;
}): Record<string, unknown> {
  const head = marksIn(input.system) + marksIn(input.tools);
  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: input.max_tokens,
    messages: markConversation(
      pairedMessages(input.messages, input.reasoning),
      CACHE_MARKS_MAX - head,
    ),
  };
  if (input.system !== undefined) {
    body.system = input.system;
  }
  if (input.tools?.length) {
    body.tools = input.tools;
  }
  return mergeRequestPatch(body, input.request_patch);
}

// ── SSE 응답 번역 ─────────────────────────────────────────────────────────

// signature는 Gemini functionCall의 thoughtSignature다. 같은 turn의 다음 요청에 그대로 돌려보낸다.
export type ToolCall = {
  id: string;
  name: string;
  args: string;
  signature?: string;
};

// stream 결과. tool 인자는 content_block_stop을 본 것만 완성이다.
type StreamResult = {
  text: string;
  // 사람이 읽을 reasoning 글. null은 reasoning이 없었다. ""는 있었지만 읽을 글이
  // 없다(redacted_thinking, 빈 thinking block).
  reasoning: string | null;
  // 마지막으로 reasoning 글을 더한 thinking block index. block이 바뀌면 "\n\n"으로 잇는다.
  lastReasoningBlock: number | null;
  // thinking·redacted_thinking block의 index. content_block_stop으로 그 block의 끝을 안다.
  reasoningBlocks: number[];
  // 마지막 reasoning block이 끝났다. delta 시각을 재는 쪽이 그 끝을 안다.
  reasoningEnded: boolean;
  toolCalls: ToolCall[];
  // 인자가 완성된 tool. stop을 보지 못한 tool은 여기 없다.
  completedToolIds: string[];
  stopReason?: string;
  messageEnded: boolean;
  // content_block_start를 본 index(text·thinking·tool_use 모두). tool이 아닌 block도 index를
  // 차지하므로 toolCalls의 빈 자리와 start가 빠진 구멍은 이 집합으로만 구별한다.
  startedBlocks: number[];
  // content_block 계열 frame이 가리킨 가장 큰 index. 없으면 -1이다.
  lastBlock: number;
  usage?: TokenUsage;
  // error frame의 provider type·message. 오류 본문은 보존하지 않는다.
  errorType?: string;
  errorMessage?: string;
  // 처음 본 모르는 event type 몇 개. 기록의 증거다.
  unknownEvents: string[];
};

export function createStreamResult(): StreamResult {
  return {
    text: "",
    reasoning: null,
    lastReasoningBlock: null,
    reasoningBlocks: [],
    reasoningEnded: false,
    toolCalls: [],
    completedToolIds: [],
    messageEnded: false,
    startedBlocks: [],
    lastBlock: -1,
    unknownEvents: [],
  };
}

function noteBlock(out: StreamResult, index: number, started: boolean): void {
  if (index > out.lastBlock) out.lastBlock = index;
  if (started && !out.startedBlocks.includes(index)) {
    out.startedBlocks.push(index);
  }
}

// frame 하나를 누적한다. tool 인자 조각은 index로 slot을 찾아 더한다.
function applyFrame(out: StreamResult, frame: SseFrame): void {
  if (frame.event === "error") {
    let error: Record<string, unknown>;
    try {
      error = JSON.parse(frame.data);
    } catch {
      noteUnknownEvent(out.unknownEvents, "bad_error_frame");
      return;
    }
    const detail = error.error as
      | { type?: string; message?: string }
      | undefined;
    out.errorType =
      typeof detail?.type === "string" ? detail.type : out.errorType;
    out.errorMessage =
      typeof detail?.message === "string" ? detail.message : out.errorMessage;
    return;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame.data);
  } catch {
    // 잘못된 JSON frame은 그 event만 버린다. 전체 스트림을 실패로 세지 않는다.
    return;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    noteUnknownEvent(out.unknownEvents, "non_object_frame");
    return;
  }
  const record = parsed as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : undefined;
  if (type === undefined) {
    noteUnknownEvent(out.unknownEvents, "missing_type");
    return;
  }
  if (type === "message_start") {
    const message = record.message as Record<string, unknown> | undefined;
    const usage = message?.usage;
    if (usage !== null && typeof usage === "object") {
      out.usage = mergeUsage(out.usage, usage as Record<string, unknown>);
    }
    return;
  }
  if (type === "content_block_start") {
    const index = typeof record.index === "number" ? record.index : undefined;
    const block = record.content_block as Record<string, unknown> | undefined;
    if (index === undefined || block === undefined) return;
    noteBlock(out, index, true);
    if (block.type === "thinking" || block.type === "redacted_thinking") {
      out.reasoning ??= "";
      out.reasoningEnded = false;
      if (!out.reasoningBlocks.includes(index)) {
        out.reasoningBlocks.push(index);
      }
    }
    if (block.type === "tool_use") {
      out.toolCalls[index] = {
        id: typeof block.id === "string" ? block.id : "",
        name: typeof block.name === "string" ? block.name : "",
        args: "",
      };
    }
    return;
  }
  if (type === "content_block_delta") {
    const index = typeof record.index === "number" ? record.index : undefined;
    const delta = record.delta as Record<string, unknown> | undefined;
    if (index === undefined || delta === undefined) return;
    noteBlock(out, index, false);
    if (delta.type === "text_delta" && typeof delta.text === "string") {
      out.text += delta.text;
      return;
    }
    if (
      delta.type === "input_json_delta" &&
      typeof delta.partial_json === "string"
    ) {
      const slot = out.toolCalls[index];
      if (slot !== undefined) slot.args += delta.partial_json;
      return;
    }
    if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
      out.reasoning ??= "";
      // 빈 block의 글은 아무것도 더하지 않는다.
      if (delta.thinking !== "") {
        if (out.reasoning !== "" && out.lastReasoningBlock !== index) {
          out.reasoning += "\n\n";
        }
        out.reasoning += delta.thinking;
        out.lastReasoningBlock = index;
      }
      return;
    }
    return;
  }
  if (type === "content_block_stop") {
    const index = typeof record.index === "number" ? record.index : undefined;
    if (index === undefined) return;
    noteBlock(out, index, false);
    if (out.reasoningBlocks.includes(index)) out.reasoningEnded = true;
    const slot = out.toolCalls[index];
    if (slot !== undefined && !out.completedToolIds.includes(slot.id)) {
      out.completedToolIds.push(slot.id);
    }
    return;
  }
  if (type === "message_delta") {
    const delta = record.delta as Record<string, unknown> | undefined;
    if (delta !== undefined && typeof delta.stop_reason === "string") {
      out.stopReason = delta.stop_reason;
    }
    const usage = record.usage;
    if (usage !== null && typeof usage === "object") {
      out.usage = mergeUsage(out.usage, usage as Record<string, unknown>);
    }
    return;
  }
  if (type === "message_stop") {
    out.messageEnded = true;
    return;
  }
  if (type === "ping" || type === "content_block_start_seen") {
    return;
  }
  noteUnknownEvent(out.unknownEvents, type);
}

// 알려진 event만 누적하고 모르는 event는 버린다. push 후 호출한다.
export function applyFrames(
  out: StreamResult,
  frames: readonly SseFrame[],
): void {
  for (const frame of frames) applyFrame(out, frame);
}

// message_delta usage는 누적 출력이다. 오른쪽 우선으로 합친다(OpenCode 595–617).
function mergeUsage(
  current: TokenUsage | undefined,
  raw: Record<string, unknown>,
): TokenUsage {
  const next = anthropicUsage(raw);
  if (current === undefined) return next;
  return {
    input: next.input ?? current.input,
    output: next.output ?? current.output,
    cache_read: next.cache_read ?? current.cache_read,
    cache_write: next.cache_write ?? current.cache_write,
    reasoning: next.reasoning ?? current.reasoning,
    cache_in_input: false,
    reasoning_in_output: true,
    definition_revision:
      next.definition_revision || current.definition_revision,
  };
}

// usage 정규화. Anthropic input은 cache를 제외해 본다. 값 모름은 0이
// 아니라 null이다.
function anthropicUsage(raw: Record<string, unknown>): TokenUsage {
  const details = raw.output_tokens_details as
    | { thinking_tokens?: unknown }
    | undefined;
  return {
    input: asCount(raw.input_tokens),
    output: asCount(raw.output_tokens),
    cache_read: asCount(raw.cache_read_input_tokens),
    cache_write: asCount(raw.cache_creation_input_tokens),
    reasoning: asCount(details?.thinking_tokens ?? raw.thinking_tokens),
    cache_in_input: false,
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

type Verdict = {
  kind: "complete" | "partial" | "refused" | "failed";
  // failed일 때만 실패 코드다(ModelOutcome과 같은 근원).
  code?: "temporary" | "refused" | "unknown";
  // refused frame이 내보낸 provider 종류.
  providerCode?: string;
};

// 조사 문서 판정 표. stop reason을 본 뒤에만 complete가 가능하다.
// tool 인자는 content_block_stop과 JSON 검증 뒤에만 완성이다.
export function judge(out: StreamResult): Verdict {
  if (out.errorType !== undefined) return streamError(out);
  // message_stop을 보지 못하고 끝난 스트림은 단절이다. stop reason이 있어도 partial이다.
  if (!out.messageEnded) {
    return { kind: "partial" };
  }
  // tool_use는 인자 완성(JSON 검증) 뒤에만 complete다.
  if (out.stopReason === "tool_use") {
    if (out.toolCalls.every((call) => call === undefined)) {
      return { kind: "partial" };
    }
    // block은 text·thinking·tool_use가 index를 함께 쓴다. 앞선 text·thinking block 때문에
    // toolCalls에 빈 자리가 있는 것은 정상이다. content_block_start를 본 적 없는 index만
    // 구멍이다(잘린 stream). 구멍이 있으면 complete가 아니고, 던지지 않고 partial로 세운다.
    for (let index = 0; index <= out.lastBlock; index++) {
      if (!out.startedBlocks.includes(index)) return { kind: "partial" };
    }
    for (const call of out.toolCalls) {
      // 빈 자리는 tool이 아닌 block이다.
      if (call === undefined) continue;
      if (!out.completedToolIds.includes(call.id)) return { kind: "partial" };
      if (!verifiedJson(call.args)) return { kind: "partial" };
    }
    return { kind: "complete" };
  }
  // refusal·sensitive는 응답 거절이다.
  if (out.stopReason === "refusal" || out.stopReason === "sensitive") {
    return { kind: "refused", providerCode: out.stopReason };
  }
  // max_tokens는 잘림이다. tool이 미완이다.
  if (out.stopReason === "max_tokens") {
    return { kind: "partial" };
  }
  // end_turn·stop_sequence·pause_turn은 정상 종료다.
  if (
    out.stopReason === "end_turn" ||
    out.stopReason === "stop_sequence" ||
    out.stopReason === "pause_turn"
  ) {
    return { kind: "complete" };
  }
  // stop reason 없이 message_stop만 온 것도 stop reason 없음이다(Pi 379–569).
  return { kind: "partial" };
}

// in-stream error frame의 종류. HTTP·본문 분류는 failures.ts가 맡는다.
function streamError(out: StreamResult): Verdict {
  const type = out.errorType ?? "";
  if (type === "overloaded_error" || type === "rate_limit_error") {
    return { kind: "failed", code: "temporary", providerCode: type };
  }
  // 원인을 모르는 종류는 unknown이다. 인증 실패로 올리지 않는다.
  return { kind: "failed", code: "unknown", providerCode: type || undefined };
}

// 빈 글과 `null`은 인자 없는 호출이다.
function verifiedJson(text: string): boolean {
  if (text.trim().length === 0) return true;
  try {
    const parsed: unknown = JSON.parse(text);
    return (
      parsed === null || (typeof parsed === "object" && !Array.isArray(parsed))
    );
  } catch {
    return false;
  }
}
