// Anthropic Messages adapter(provider#R3, R25, R26). 요청 번역(system·messages·tools,
// tool_use.id↔tool_result 대응, cache 표시, opaque 상태 재전송)과 SSE 응답 번역
// (frame 누적, complete/partial/refused/failed 판정, usage 정규화)을 여기 둔다.
// 오류 코드의 HTTP·본문 분류는 나중 작업이 failures.ts로 맡는다(provider#R19-R24).

import { err, ok, type Result } from "../../../../base/mod.ts";
import type { TokenUsage } from "../../../../contracts/lophn-agent/mod.ts";
import type { JsonObject } from "../../../../contracts/platform/mod.ts";
import { mergeRequestPatch } from "./request-patch.ts";
import type { SseFrame } from "./stream.ts";

// prompt-assemble이 준 경계 위치(plan T13: 최대 3곳). Anthropic breakpoint
// 상한은 4개라 3개는 상한 안이다(조사 문서, OpenCode 234–251).
export const ANTHROPIC_CACHE_BOUNDARY_MAX = 3;

export type CacheBoundaries = {
  system: boolean;
  tools: boolean;
  final_user: boolean;
};

export function boundaryCount(boundaries: CacheBoundaries): number {
  return (boundaries.system ? 1 : 0) + (boundaries.tools ? 1 : 0) +
    (boundaries.final_user ? 1 : 0);
}

// Anthropic thinking.signature와 redacted_thinking.data 원문. 사람이 읽을
// 본문(thinking text)은 상태에 두지 않는다(R25).
export type OpaqueReasoningState = {
  signature?: string;
  data?: string;
};

// 같은 run·같은 provider·같은 model 메모리에서만 재사용한다(R25). provider나
// model이 바뀌면 버리고, run 종료 시 폐기한다. blob·trace에 남지 않는다.
export type ReasoningMemory = {
  get(
    run: string,
    provider: string,
    model: string,
  ): OpaqueReasoningState | undefined;
  set(
    run: string,
    provider: string,
    model: string,
    state: OpaqueReasoningState,
  ): void;
  drop(run: string): void;
};

export function createReasoningMemory(): ReasoningMemory {
  const values = new Map<
    string,
    { provider: string; model: string; state: OpaqueReasoningState }
  >();
  return {
    get(run, provider, model) {
      const found = values.get(run);
      if (!found) return undefined;
      // provider·model이 다르면 상태가 없는 것과 같다. 전송 대상이 아니라 버림이다.
      if (found.provider !== provider || found.model !== model) {
        return undefined;
      }
      return { ...found.state };
    },
    set(run, provider, model, state) {
      values.set(run, { provider, model, state: { ...state } });
    },
    drop(run) {
      values.delete(run);
    },
  };
}

// 시그니처가 필요한데 메모리가 비어 있으면(restart·compaction) state-free 재시도를
// 하지 않고 실패한다(architecture §5.2).
export function reasoningFor(
  memory: ReasoningMemory | undefined,
  need: { run: string; provider: string; model: string; required: boolean },
): Result<OpaqueReasoningState | undefined> {
  const found = memory?.get(need.run, need.provider, need.model);
  if (found === undefined && need.required) {
    return err({
      code: "conflict",
      message: "opaque 추론 상태가 메모리에 없다",
    });
  }
  return ok(found);
}

export type AnthropicBlock = {
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

export type ToolDefinition = {
  name: string;
  description?: string;
  input_schema: unknown;
};

// cache 표시. R26: 타입은 ephemeral뿐이다. ttl 필드를 보내지 않으면 5분 기본이다.
const CACHE_CONTROL = { type: "ephemeral" } as const;

// 마지막 block에만 경계 표시를 건다(Pi 1483–1509). 배열이 아니면 원값을 돌려준다.
function markLast(value: unknown, boundary: boolean): unknown {
  if (!boundary || !Array.isArray(value) || value.length === 0) return value;
  const blocks = [...value];
  const last = blocks[blocks.length - 1];
  if (last === null || typeof last !== "object" || Array.isArray(last)) {
    return value;
  }
  blocks[blocks.length - 1] = {
    ...(last as Record<string, unknown>),
    cache_control: CACHE_CONTROL,
  };
  return blocks;
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
        block !== null && typeof block === "object" &&
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
    const content = record.content.map((block) => {
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
    }).filter((block) => block !== null);
    return { ...record, content };
  });
}

function pairedThinking(
  block: AnthropicBlock,
  reasoning: OpaqueReasoningState | undefined,
): AnthropicBlock {
  // 상태에는 원문 signature만 산다. 메모리에 상태가 없으면(다른 provider·model,
  // run 종료) 이 블록의 signature를 지워 전송 대상에서 뺀다. 메모리에 있으면
  // 블록을 원문 그대로 보낸다. 시그니처 비교·재서명은 T14가 맡는다.
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

// 요청 본문 번역. endpoint는 API base이고 path는 transport가 붙인다(§5.2).
export function buildRequest(input: {
  model: string;
  max_tokens: number;
  system?: unknown;
  messages: readonly unknown[];
  tools?: readonly ToolDefinition[];
  boundaries?: CacheBoundaries;
  reasoning?: OpaqueReasoningState | undefined;
  // option 값이 싣는 조각이다(harness/model#R22). 만든 body에 깊게 합친다.
  request_patch?: JsonObject;
}): Record<string, unknown> {
  const boundaries = input.boundaries ??
    { system: false, tools: false, final_user: false };
  const messages = pairedMessages(input.messages, input.reasoning);
  const body: Record<string, unknown> = {
    model: input.model,
    max_tokens: input.max_tokens,
    messages: markLast(messages, boundaries.final_user),
  };
  if (input.system !== undefined) {
    body.system = markLast(input.system, boundaries.system);
  }
  if (input.tools?.length) {
    body.tools = markLast(input.tools, boundaries.tools);
  }
  return mergeRequestPatch(body, input.request_patch);
}

// ── SSE 응답 번역 ─────────────────────────────────────────────────────────

export type ToolCall = { id: string; name: string; args: string };

// stream 결과. tool 인자는 content_block_stop을 본 것만 완성이다(plan T13).
export type StreamResult = {
  text: string;
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
  // error frame의 provider type·message. 오류 본문은 보존하지 않는다(R19).
  errorType?: string;
  errorMessage?: string;
  // 만난 event 종류(관측 기록). 모르는 event는 여기 세지 않는다.
  sawUnknownEvent: boolean;
};

export function createStreamResult(): StreamResult {
  return {
    text: "",
    toolCalls: [],
    completedToolIds: [],
    messageEnded: false,
    startedBlocks: [],
    lastBlock: -1,
    sawUnknownEvent: false,
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
      out.sawUnknownEvent = true;
      return;
    }
    const detail = error.error as
      | { type?: string; message?: string }
      | undefined;
    out.errorType = typeof detail?.type === "string"
      ? detail.type
      : out.errorType;
    out.errorMessage = typeof detail?.message === "string"
      ? detail.message
      : out.errorMessage;
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
    out.sawUnknownEvent = true;
    return;
  }
  const record = parsed as Record<string, unknown>;
  const type = typeof record.type === "string" ? record.type : undefined;
  if (type === undefined) {
    out.sawUnknownEvent = true;
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
    // thinking_delta는 사람이 읽을 본문이다. 제외한다(R25).
    return;
  }
  if (type === "content_block_stop") {
    const index = typeof record.index === "number" ? record.index : undefined;
    if (index === undefined) return;
    noteBlock(out, index, false);
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
  if (
    type === "ping" || type === "content_block_start_seen"
  ) {
    return;
  }
  out.sawUnknownEvent = true;
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
    definition_revision: next.definition_revision ||
      current.definition_revision,
  };
}

// usage 정규화(조사 문서 표). Anthropic input은 cache를 제외해 본다. 값 모름은 0이
// 아니라 null이다(usage#R6).
export function anthropicUsage(raw: Record<string, unknown>): TokenUsage {
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
  return typeof value === "number" && Number.isSafeInteger(value) &&
      value >= 0
    ? value
    : null;
}

// ── 종료 판정 ─────────────────────────────────────────────────────────────

export type Verdict = {
  kind: "complete" | "partial" | "refused" | "failed";
  // failed일 때만 실패 코드다(ModelOutcome과 같은 근원).
  code?: "temporary" | "refused" | "unknown";
  // refused frame이 내보낸 provider 종류.
  providerCode?: string;
};

// 조사 문서 판정 표. stop reason을 본 뒤에만 complete가 가능하다(plan T13).
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
  // refusal·sensitive는 응답 거절이다(R23).
  if (out.stopReason === "refusal" || out.stopReason === "sensitive") {
    return { kind: "refused", providerCode: out.stopReason };
  }
  // max_tokens는 잘림이다. tool이 미완이다.
  if (out.stopReason === "max_tokens") {
    return { kind: "partial" };
  }
  // end_turn·stop_sequence·pause_turn은 정상 종료다.
  if (
    out.stopReason === "end_turn" || out.stopReason === "stop_sequence" ||
    out.stopReason === "pause_turn"
  ) {
    return { kind: "complete" };
  }
  // stop reason 없이 message_stop만 온 것도 stop reason 없음이다(Pi 379–569).
  return { kind: "partial" };
}

// in-stream error frame의 종류. HTTP·본문 분류는 failures.ts가 맡는다(T15).
function streamError(out: StreamResult): Verdict {
  const type = out.errorType ?? "";
  if (type === "overloaded_error" || type === "rate_limit_error") {
    return { kind: "failed", code: "temporary", providerCode: type };
  }
  // 원인을 모르는 종류는 unknown이다. 인증 실패로 올리지 않는다(R19).
  return { kind: "failed", code: "unknown", providerCode: type || undefined };
}

function verifiedJson(text: string): boolean {
  if (text.trim().length === 0) return true;
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" &&
      !Array.isArray(parsed);
  } catch {
    return false;
  }
}
