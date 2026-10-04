// script·fixture JSON을 실행 전에 검사한다. 잘못된 값은 응답으로 넘기지 않는다.
import type {
  Expectation,
  Protocol,
  ResponseChunk,
  Script,
  SemanticReply,
  Step,
  StepResponse,
} from "./types.ts";

const PROTOCOLS = new Set<Protocol>([
  "messages",
  "responses",
  "chat_completions",
]);

export class ScriptError extends Error {
  constructor(detail: string) {
    super(detail);
    this.name = "ScriptError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function fields(
  value: Record<string, unknown>,
  allowed: string[],
  where: string,
) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) {
    throw new ScriptError(`${where}에 unknown field가 있음`);
  }
}

function headers(
  value: unknown,
  where: string,
  response = false,
): Record<string, string> {
  const out = stringMap(value, where);
  const forbidden = new Set([
    "content-length",
    "transfer-encoding",
    "connection",
    "trailer",
    "upgrade",
    "keep-alive",
    "proxy-connection",
    "te",
  ]);
  try {
    const seen = new Set<string>();
    for (const [name, child] of Object.entries(out)) {
      const lower = name.toLowerCase();
      if (
        seen.has(lower) || (response && forbidden.has(lower)) ||
        !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n\0]/.test(child)
      ) {
        throw new Error();
      }
      seen.add(lower);
      new Headers({ [name]: child });
    }
  } catch {
    throw new ScriptError(`${where}가 잘못됨`);
  }
  return out;
}

function stringMap(value: unknown, where: string): Record<string, string> {
  if (!isRecord(value)) throw new ScriptError(`${where}가 object가 아님`);
  const out: Record<string, string> = {};
  for (const [key, child] of Object.entries(value)) {
    if (typeof child !== "string") {
      throw new ScriptError(`${where}.${key}가 문자열이 아님`);
    }
    out[key] = child;
  }
  return out;
}

function expectation(value: unknown, where: string): Expectation {
  if (!isRecord(value)) throw new ScriptError(`${where}가 object가 아님`);
  fields(value, ["method", "path", "headers", "body"], where);
  const out: Expectation = {};
  if (value.method !== undefined) {
    if (typeof value.method !== "string") {
      throw new ScriptError(`${where}.method가 문자열이 아님`);
    }
    out.method = value.method;
  }
  if (value.path !== undefined) {
    if (typeof value.path !== "string") {
      throw new ScriptError(`${where}.path가 문자열이 아님`);
    }
    out.path = value.path;
  }
  if (value.headers !== undefined) {
    out.headers = headers(value.headers, `${where}.headers`);
  }
  if ("body" in value) out.body = value.body;
  return out;
}

function chunk(value: unknown, where: string): ResponseChunk {
  if (!isRecord(value) || typeof value.bytes !== "string") {
    throw new ScriptError(`${where}.bytes가 없음`);
  }
  fields(value, ["bytes", "encoding", "delayMs", "gate"], where);
  const out: ResponseChunk = { bytes: value.bytes };
  if (value.encoding !== undefined) {
    if (value.encoding !== "utf8" && value.encoding !== "base64") {
      throw new ScriptError(`${where}.encoding이 잘못됨`);
    }
    out.encoding = value.encoding;
    if (value.encoding === "base64" && !validBase64(value.bytes)) {
      throw new ScriptError(`${where}.bytes가 base64가 아님`);
    }
  }
  if (value.delayMs !== undefined) {
    if (
      typeof value.delayMs !== "number" || !Number.isFinite(value.delayMs) ||
      value.delayMs < 0
    ) {
      throw new ScriptError(`${where}.delayMs가 잘못됨`);
    }
    out.delayMs = value.delayMs;
  }
  if (value.gate !== undefined) {
    if (typeof value.gate !== "string" || !value.gate) {
      throw new ScriptError(`${where}.gate가 잘못됨`);
    }
    out.gate = value.gate;
  }
  return out;
}

function validBase64(value: string): boolean {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) return false;
  try {
    return btoa(atob(value)) === value;
  } catch {
    return false;
  }
}

function response(value: unknown, where: string): StepResponse {
  if (!isRecord(value) || typeof value.status !== "number") {
    throw new ScriptError(`${where}.status가 없음`);
  }
  fields(value, ["status", "headers", "body", "chunks", "end"], where);
  if (
    !Number.isInteger(value.status) || value.status < 200 ||
    value.status > 599
  ) {
    throw new ScriptError(`${where}.status가 잘못됨`);
  }
  if (
    (value.body !== undefined && value.chunks !== undefined) ||
    (value.end !== undefined && value.chunks === undefined)
  ) {
    throw new ScriptError(`${where}에 conflicting field가 있음`);
  }
  if (
    [204, 205, 304].includes(value.status) &&
    (value.body !== undefined || value.chunks !== undefined ||
      value.end !== undefined)
  ) {
    throw new ScriptError(`${where}.status에는 body가 금지됨`);
  }
  const out: StepResponse = { status: value.status };
  if (value.headers !== undefined) {
    out.headers = headers(value.headers, `${where}.headers`, true);
  }
  if (value.body !== undefined) {
    if (typeof value.body !== "string") {
      throw new ScriptError(`${where}.body가 문자열이 아님`);
    }
    out.body = value.body;
  }
  if (value.chunks !== undefined) {
    if (!Array.isArray(value.chunks)) {
      throw new ScriptError(`${where}.chunks가 배열이 아님`);
    }
    out.chunks = value.chunks.map((item, index) =>
      chunk(item, `${where}.chunks[${index}]`)
    );
  }
  if (value.end !== undefined) {
    if (
      value.end !== "close" && value.end !== "reset" && value.end !== "hold"
    ) {
      throw new ScriptError(`${where}.end가 잘못됨`);
    }
    out.end = value.end;
  }
  return out;
}

function reply(value: unknown, where: string): SemanticReply {
  if (!isRecord(value)) throw new ScriptError(`${where}가 object가 아님`);
  fields(value, ["text", "toolCalls", "usage", "stop"], where);
  const out: SemanticReply = {};
  if (value.text !== undefined) {
    if (typeof value.text !== "string") {
      throw new ScriptError(`${where}.text가 문자열이 아님`);
    }
    out.text = value.text;
  }
  if (value.toolCalls !== undefined) {
    if (!Array.isArray(value.toolCalls)) {
      throw new ScriptError(`${where}.toolCalls가 배열이 아님`);
    }
    out.toolCalls = value.toolCalls.map((call, index) => {
      if (
        !isRecord(call) || typeof call.id !== "string" ||
        typeof call.name !== "string" || typeof call.arguments !== "string"
      ) {
        throw new ScriptError(`${where}.toolCalls[${index}]가 잘못됨`);
      }
      try {
        if (!isRecord(JSON.parse(call.arguments))) throw new Error();
      } catch {
        throw new ScriptError(
          `${where}.toolCalls[${index}].arguments가 JSON object가 아님`,
        );
      }
      fields(call, ["id", "name", "arguments"], `${where}.toolCalls[${index}]`);
      return { id: call.id, name: call.name, arguments: call.arguments };
    });
  }
  if (value.usage !== undefined) {
    if (!isRecord(value.usage)) {
      throw new ScriptError(`${where}.usage가 잘못됨`);
    }
    fields(value.usage, [
      "input",
      "cacheRead",
      "cacheWrite",
      "output",
      "reasoning",
    ], `${where}.usage`);
    const usage: NonNullable<SemanticReply["usage"]> = {};
    for (
      const key of ["input", "cacheRead", "cacheWrite", "output", "reasoning"]
    ) {
      const count = value.usage[key];
      if (count === undefined) continue;
      if (
        typeof count !== "number" || !Number.isSafeInteger(count) || count < 0
      ) {
        throw new ScriptError(`${where}.usage.${key}가 잘못됨`);
      }
      usage[key as keyof typeof usage] = count;
    }
    out.usage = usage;
  }
  if (value.stop !== undefined) {
    const stops = new Set([
      "end",
      "tool_calls",
      "max_tokens",
      "length",
      "incomplete",
    ]);
    if (typeof value.stop !== "string" || !stops.has(value.stop)) {
      throw new ScriptError(`${where}.stop이 잘못됨`);
    }
    out.stop = value.stop as SemanticReply["stop"];
  }
  return out;
}

export function parseScript(value: unknown): Script {
  if (!isRecord(value) || !Array.isArray(value.steps)) {
    throw new ScriptError("steps가 없음");
  }
  fields(value, ["steps"], "script");
  const ids = new Set<string>();
  const steps = value.steps.map((step, index) => parseStep(step, index, ids));
  return { steps };
}

function parseStep(value: unknown, index: number, ids: Set<string>): Step {
  const where = `steps[${index}]`;
  if (!isRecord(value) || typeof value.id !== "string" || !value.id) {
    throw new ScriptError(`${where}.id가 없음`);
  }
  fields(value, ["id", "protocol", "match", "response", "reply"], where);
  if (ids.has(value.id)) throw new ScriptError(`step id 중복: ${value.id}`);
  ids.add(value.id);
  if (
    typeof value.protocol !== "string" ||
    !PROTOCOLS.has(value.protocol as Protocol)
  ) {
    throw new ScriptError(`${where}.protocol이 잘못됨`);
  }
  if (value.response !== undefined && value.reply !== undefined) {
    throw new ScriptError(`${where}에 response와 reply가 같이 있음`);
  }
  if (value.response === undefined && value.reply === undefined) {
    throw new ScriptError(`${where}에 response와 reply가 없음`);
  }
  const semantic = value.reply === undefined
    ? undefined
    : reply(value.reply, `${where}.reply`);
  const stops: Record<string, string[]> = {
    messages: ["end", "tool_calls", "max_tokens"],
    responses: ["end", "tool_calls", "max_tokens", "incomplete"],
    chat_completions: ["end", "tool_calls", "length"],
  };
  if (semantic?.stop && !stops[value.protocol].includes(semantic.stop)) {
    throw new ScriptError(`${where}.reply.stop이 protocol과 다름`);
  }
  return {
    id: value.id,
    protocol: value.protocol as Protocol,
    match: value.match === undefined
      ? undefined
      : expectation(value.match, `${where}.match`),
    response: value.response === undefined
      ? undefined
      : response(value.response, `${where}.response`),
    reply: semantic,
  };
}
