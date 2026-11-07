// Google Cloud Code Assist adapter다(`v1internal:streamGenerateContent?alt=sse`). Antigravity 구독 계정만 쓴다.
// - 요청: packer가 lophn의 이력을 Google contents/parts로 옮기고, 보내기 직전에 shape가 계정 project·requestId·
//   conversation label·sessionId를 담은 envelope로 감싼다. Claude model도 이 Google wire로 보낸다(Anthropic profile 없음).
// - 응답: `{"response": GenerateContentResponse}` frame을 누적해 text·thinking·tool call·usage를 낸다. HTTP 200이어도
//   root error·prompt 차단·finishReason 없는 끝은 성공이 아니다.
// header와 label 값은 2026-10 조사 snapshot의 Antigravity client profile이고 Google이 공개 보장한 API가 아니다.
// Gemini의 thought signature는 받은 functionCall에 붙여 다음 요청에 그대로 돌려보낸다(turn 이력에 함께 남아 뒤
// turn에도 간다). 서명이 없는 functionCall(이력을 남기지 않은 옛 turn)에는 서명 검사를 건너뛰는 표시를 대신 싣는다.

import type { TokenUsage } from "../../../../protocol/lophn-agent/mod.ts";
import { joinEndpoint, type ShapedCall } from "./compat.ts";
import type { ToolCall } from "./messages.ts";
import { stableNegativeDecimal, stableUuid } from "./stable-id.ts";
import type { SseFrame } from "./stream.ts";

export const ANTIGRAVITY_VERSION = "2.26.0";
const ANTIGRAVITY_CHANGELIST = "1005016104";
const STREAM_PATH = "/v1internal:streamGenerateContent?alt=sse";
const SKIP_SIGNATURE = "skip_thought_signature_validator";
const IMAGE_OMITTED = "(image omitted: this model does not accept image input)";

// native build를 따라 잡은 profile 값이라 실제 CPU와 다를 수 있다.
export function antigravityUserAgent(platform: string): string {
  const [os, arch] =
    platform === "darwin"
      ? ["darwin", "arm64"]
      : platform === "win32"
        ? ["windows", "amd64"]
        : ["linux", "amd64"];
  return `antigravity/hub/${ANTIGRAVITY_VERSION} (aidev_client; os_type=${os}; arch=${arch}; cl=${ANTIGRAVITY_CHANGELIST})`;
}

type Part = Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// label과 서명 처리가 model 종류를 본다. 같은 Google wire 안의 Claude·GPT는 Gemini가 아니다.
export function modelClassOf(model: string): "gemini" | "claude" | "other" {
  const name = model.toLowerCase();
  if (name.includes("claude")) return "claude";
  return name.startsWith("gemini") ? "gemini" : "other";
}

// ── 요청 번역 ─────────────────────────────────────────────────────────────

type HistoryMessage = {
  role: "user" | "assistant";
  parts: readonly (
    | { kind: "text"; text: string }
    | {
        kind: "tool_use";
        id: string;
        name: string;
        input: unknown;
        signature?: string;
      }
    | { kind: "tool_result"; id: string; text: string }
    | { kind: "image"; media_type: string; data_base64: string }
    | {
        kind: "tool_result_image";
        id: string;
        media_type: string;
        data_base64: string;
      }
  )[];
};

// tool 결과는 call ID로 잇고 그 assistant turn의 call 순서대로 user turn 하나에 모은다. 결과 이미지는 모든
// functionResponse 뒤에 붙인다.
export function cloudCodeContents(
  messages: readonly HistoryMessage[],
  options: { images: boolean; gemini: boolean },
): unknown[] {
  const names = new Map<string, string>();
  const order = new Map<string, number>();
  const contents: unknown[] = [];
  for (const message of messages) {
    if (message.role === "assistant") {
      const parts: Part[] = [];
      let first = true;
      for (const part of message.parts) {
        if (part.kind === "text") {
          if (part.text.trim() !== "") parts.push({ text: part.text });
        } else if (part.kind === "tool_use") {
          names.set(part.id, part.name);
          order.set(part.id, order.size);
          // 받은 서명이 있으면 그것을, 없으면 call마다 첫 functionCall에만 건너뛰는 표시를 단다.
          const signature =
            options.gemini && part.signature !== undefined
              ? part.signature
              : options.gemini && first
                ? SKIP_SIGNATURE
                : undefined;
          parts.push({
            functionCall: {
              name: part.name,
              args: isRecord(part.input) ? part.input : {},
              id: part.id,
            },
            ...(signature === undefined ? {} : { thoughtSignature: signature }),
          });
          first = false;
        }
      }
      if (parts.length > 0) contents.push({ role: "model", parts });
      continue;
    }
    const responses = new Map<string, { output: string }>();
    // 글과 user가 보낸 이미지는 들어온 순서대로 간다.
    const inline: Part[] = [];
    const pictures: Part[] = [];
    for (const part of message.parts) {
      if (part.kind === "text") {
        if (part.text.trim() !== "") inline.push({ text: part.text });
      } else if (part.kind === "image") {
        inline.push(
          options.images
            ? {
                inlineData: {
                  mimeType: part.media_type,
                  data: part.data_base64,
                },
              }
            : { text: IMAGE_OMITTED },
        );
      } else if (part.kind === "tool_result") {
        if (names.has(part.id)) responses.set(part.id, { output: part.text });
        else inline.push({ text: part.text });
      } else if (part.kind === "tool_result_image") {
        if (options.images) {
          pictures.push({
            inlineData: { mimeType: part.media_type, data: part.data_base64 },
          });
        } else inline.push({ text: IMAGE_OMITTED });
      }
    }
    const parts: Part[] = [...responses.entries()]
      .sort(([a], [b]) => (order.get(a) ?? 0) - (order.get(b) ?? 0))
      .map(([id, response]) => ({
        functionResponse: { name: names.get(id)!, response, id },
      }));
    parts.push(...inline);
    if (pictures.length > 0) {
      parts.push({ text: "Images from the tool results:" }, ...pictures);
    }
    if (parts.length > 0) contents.push({ role: "user", parts });
  }
  return contents;
}

// Cloud Code가 받는 schema 부분집합으로 줄인다. 실행할 때의 인자 검사는 원래 schema가 그대로 한다.
// anyOf·oneOf는 null이 아닌 첫 갈래, allOf는 properties를 합친다. 모르는 keyword는 뺀다.
const SCALAR_TYPES = new Set([
  "string",
  "number",
  "integer",
  "boolean",
  "array",
  "object",
]);

export function wireSchema(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return { type: "object" };
  for (const key of ["anyOf", "oneOf"] as const) {
    const options = value[key];
    if (!Array.isArray(options)) continue;
    const picked = options.find(
      (option) => !(isRecord(option) && option.type === "null"),
    );
    const inner = wireSchema(picked);
    return typeof value.description === "string"
      ? { ...inner, description: value.description }
      : inner;
  }
  if (Array.isArray(value.allOf)) {
    const merged: Record<string, unknown> = { type: "object", properties: {} };
    const required: string[] = [];
    for (const part of value.allOf) {
      const inner = wireSchema(part);
      Object.assign(merged.properties as object, inner.properties ?? {});
      if (Array.isArray(inner.required)) required.push(...inner.required);
    }
    if (required.length > 0) merged.required = [...new Set(required)];
    return merged;
  }
  const out: Record<string, unknown> = {};
  const declared = Array.isArray(value.type)
    ? value.type.find((type) => type !== "null")
    : value.type;
  const type =
    typeof declared === "string" && SCALAR_TYPES.has(declared)
      ? declared
      : isRecord(value.properties)
        ? "object"
        : value.items !== undefined
          ? "array"
          : value.const !== undefined || Array.isArray(value.enum)
            ? "string"
            : "object";
  out.type = type;
  if (typeof value.description === "string") {
    out.description = value.description;
  }
  const choices =
    value.const !== undefined
      ? [value.const]
      : Array.isArray(value.enum)
        ? value.enum
        : null;
  if (
    choices !== null &&
    type === "string" &&
    choices.every((choice) => typeof choice === "string")
  ) {
    out.enum = choices;
  }
  if (type === "object" && isRecord(value.properties)) {
    const properties: Record<string, unknown> = {};
    for (const [name, inner] of Object.entries(value.properties)) {
      properties[name] = wireSchema(inner);
    }
    out.properties = properties;
    if (Array.isArray(value.required)) {
      const required = value.required.filter(
        (name): name is string =>
          typeof name === "string" && Object.hasOwn(properties, name),
      );
      if (required.length > 0) out.required = required;
    }
  }
  if (type === "array") out.items = wireSchema(value.items);
  return out;
}

export function buildCloudCodeRequest(input: {
  model: string;
  system: string;
  messages: readonly HistoryMessage[];
  tools: readonly {
    name: string;
    description: string;
    input_schema: unknown;
  }[];
  images: boolean;
  // option 값이 싣는 조각이다(thinkingConfig 같은 generationConfig).
  request_patch?: Record<string, unknown>;
}): Record<string, unknown> {
  const modelClass = modelClassOf(input.model);
  const body: Record<string, unknown> = {
    contents: cloudCodeContents(input.messages, {
      images: input.images,
      gemini: modelClass === "gemini",
    }),
  };
  if (input.system.trim() !== "") {
    body.systemInstruction = { role: "user", parts: [{ text: input.system }] };
  }
  if (input.tools.length > 0) {
    body.tools = [
      {
        functionDeclarations: input.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: wireSchema(tool.input_schema),
        })),
      },
    ];
  }
  // Claude profile은 tool이 없어도 VALIDATED를 싣는다.
  if (input.tools.length > 0 || modelClass === "claude") {
    body.toolConfig = { functionCallingConfig: { mode: "VALIDATED" } };
  }
  const generation = input.request_patch?.generationConfig;
  if (isRecord(generation)) body.generationConfig = generation;
  return body;
}

// 보내기 직전의 envelope다. conversation 값(cascade·trajectory·sessionId)은 session에서 만들어 요청마다 같다.
// step과 요청 수는 이력에서 세어 retry가 같은 값을 낸다.
export function cloudCodeShape(options: {
  project: string;
  model: string;
  userAgent: string;
  nowMs(): number;
}): (input: {
  endpoint: string;
  session: string | null;
  body: Record<string, unknown>;
}) => ShapedCall {
  const modelClass = modelClassOf(options.model);
  return (input) => {
    const key = input.session ?? options.project;
    const agent = stableUuid("lophn.antigravity.agent", key);
    const trajectory = stableUuid("lophn.antigravity.trajectory", key);
    const contents = Array.isArray(input.body.contents)
      ? input.body.contents
      : [];
    const step = Math.max(contents.length, 1);
    const answered = contents.filter(
      (content) => isRecord(content) && content.role === "model",
    ).length;
    const { contents: _, generationConfig, ...rest } = input.body;
    const request: Record<string, unknown> = {
      contents,
      ...rest,
      labels: {
        cascade_id: agent,
        last_step_index: String(step - 1),
        request_id: `${trajectory}-${answered}`,
        root_cascade_id: agent,
        trajectory_id: trajectory,
        used_claude: String(modelClass === "claude"),
        used_claude_conservative: String(modelClass === "claude"),
        used_non_gemini_model: String(modelClass !== "gemini"),
      },
      ...(generationConfig === undefined ? {} : { generationConfig }),
      sessionId: stableNegativeDecimal("lophn.antigravity.session", key),
    };
    return {
      url: joinEndpoint(input.endpoint, STREAM_PATH),
      headers: {
        "content-type": "application/json",
        "user-agent": options.userAgent,
      },
      body: JSON.stringify({
        project: options.project,
        requestId: `agent/${agent}/${options.nowMs()}/${trajectory}/${step}`,
        request,
        model: options.model,
        userAgent: "antigravity",
      }),
      toolName: (name) => name,
    };
  };
}

// ── SSE 응답 번역 ─────────────────────────────────────────────────────────

type CloudCodeStream = {
  text: string;
  reasoning: string | null;
  // thinking 뒤에 다른 조각이 왔다. delta 시각을 재는 쪽이 끝을 안다.
  reasoningEnded: boolean;
  toolCalls: ToolCall[];
  // functionCall 없이 먼저 온 서명이다. 다음 functionCall에 붙인다.
  pendingSignature?: string;
  finishReason?: string;
  responseId?: string;
  usage?: TokenUsage;
  blockReason?: string;
  errorType?: string;
  errorMessage?: string;
};

export function createCloudCodeStreamResult(): CloudCodeStream {
  return { text: "", reasoning: null, reasoningEnded: false, toolCalls: [] };
}

function count(value: unknown): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? value
    : 0;
}

// cache 읽기는 prompt 안에 있다. input은 cache를 뺀 값이고 output은 답과 thinking의 합이다.
export function cloudCodeUsage(raw: Record<string, unknown>): TokenUsage {
  const candidate = count(raw.candidatesTokenCount);
  const thinking = count(raw.thoughtsTokenCount);
  const total = count(raw.totalTokenCount);
  const prompt =
    count(raw.promptTokenCount) || Math.max(0, total - candidate - thinking);
  const cacheRead = Math.min(count(raw.cachedContentTokenCount), prompt);
  return {
    input: prompt - cacheRead,
    output: candidate + thinking,
    cache_read: cacheRead,
    cache_write: null,
    reasoning: thinking,
    cache_in_input: false,
    reasoning_in_output: true,
    definition_revision: "",
  };
}

function applyFrame(out: CloudCodeStream, frame: SseFrame): void {
  let parsed: unknown;
  try {
    parsed = JSON.parse(frame.data);
  } catch {
    return;
  }
  if (!isRecord(parsed)) return;
  if (isRecord(parsed.error)) {
    const error = parsed.error;
    out.errorType =
      typeof error.status === "string"
        ? error.status
        : typeof error.code === "number"
          ? String(error.code)
          : "error";
    if (typeof error.message === "string") out.errorMessage = error.message;
    return;
  }
  const response = isRecord(parsed.response) ? parsed.response : parsed;
  if (typeof response.responseId === "string") {
    out.responseId = response.responseId;
  }
  const feedback = response.promptFeedback;
  if (isRecord(feedback) && typeof feedback.blockReason === "string") {
    out.blockReason = feedback.blockReason;
  }
  if (isRecord(response.usageMetadata)) {
    out.usage = cloudCodeUsage(response.usageMetadata);
  }
  const candidate = Array.isArray(response.candidates)
    ? response.candidates[0]
    : undefined;
  if (!isRecord(candidate)) return;
  const content = candidate.content;
  const parts =
    isRecord(content) && Array.isArray(content.parts) ? content.parts : [];
  for (const part of parts) {
    if (!isRecord(part)) continue;
    if (isRecord(part.functionCall)) {
      const call = part.functionCall;
      const given =
        typeof call.id === "string" && call.id !== "" ? call.id : null;
      const taken = new Set(out.toolCalls.map((existing) => existing.id));
      const id =
        given !== null && !taken.has(given)
          ? given
          : `cca_${out.toolCalls.length + 1}`;
      const signature =
        typeof part.thoughtSignature === "string" &&
        part.thoughtSignature !== ""
          ? part.thoughtSignature
          : out.pendingSignature;
      out.pendingSignature = undefined;
      out.toolCalls.push({
        id,
        name: typeof call.name === "string" ? call.name : "",
        args: JSON.stringify(isRecord(call.args) ? call.args : {}),
        ...(signature === undefined ? {} : { signature }),
      });
      if (out.reasoning !== null) out.reasoningEnded = true;
      continue;
    }
    if (
      typeof part.thoughtSignature === "string" &&
      part.thoughtSignature !== ""
    ) {
      out.pendingSignature = part.thoughtSignature;
    }
    if (typeof part.text !== "string" || part.text === "") continue;
    if (part.thought === true) {
      out.reasoning = (out.reasoning ?? "") + part.text;
      out.reasoningEnded = false;
    } else {
      out.text += part.text;
      if (out.reasoning !== null) out.reasoningEnded = true;
    }
  }
  if (typeof candidate.finishReason === "string") {
    out.finishReason = candidate.finishReason;
  }
}

export function applyCloudCodeFrames(
  out: CloudCodeStream,
  frames: readonly SseFrame[],
): void {
  for (const frame of frames) applyFrame(out, frame);
}

const REFUSED_REASONS = new Set([
  "SAFETY",
  "RECITATION",
  "BLOCKLIST",
  "PROHIBITED_CONTENT",
  "SPII",
  "IMAGE_SAFETY",
]);

export function judgeCloudCode(out: CloudCodeStream): {
  kind: "complete" | "partial" | "refused" | "failed";
  providerCode?: string;
} {
  if (out.errorType !== undefined) {
    return { kind: "failed", providerCode: out.errorType };
  }
  if (out.blockReason !== undefined) {
    return { kind: "refused", providerCode: out.blockReason };
  }
  const reason = out.finishReason;
  // finishReason 없이 끝난 stream은 잘린 것이다.
  if (reason === undefined) return { kind: "partial" };
  if (reason === "STOP") return { kind: "complete" };
  if (REFUSED_REASONS.has(reason)) {
    return { kind: "refused", providerCode: reason };
  }
  // MAX_TOKENS, MALFORMED_FUNCTION_CALL과 모르는 이유는 완성이 아니다. 이유는 finishReason에 남는다.
  return { kind: "partial" };
}

// streaming이 아닌 성공 본문(응답 하나 또는 배열)을 frame으로 옮긴다.
export function cloudCodeFrames(root: unknown): SseFrame[] | null {
  const items = Array.isArray(root) ? root : [root];
  if (!items.every(isRecord)) return null;
  return items.map((item) => ({
    event: "message",
    data: JSON.stringify(item),
  }));
}
