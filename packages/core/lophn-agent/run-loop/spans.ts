import type { Attributes, Span, Tracer } from "../../../base/telemetry/mod.ts";
import type {
  ModelOutcome,
  TokenUsage,
} from "../../../protocol/lophn-agent/mod.ts";

// agent loop의 span(`agent.turn` > `agent.model_call`, `agent.tool_call`)이 싣는 값을 만든다. 싣는 것은 lophn id, 이름,
// 종류, 숫자뿐이다. 대화 글·prompt·reasoning·tool 입력과 결과·오류 message·URL은 어떤 attribute에도 싣지 않는다
// (span 줄은 trace 설정이 켜지면 log file에 남는다). 사람이 쓴 글이나 model이 낸 글이 들어갈 자리(tool 이름, provider 오류
// 글)는 목록에서 고른 값이나 고정 모양일 때만 싣는다. id로 ledger의 model_calls·tool call 행과 이어 읽는다.

export function turnSpanAttributes(input: {
  session: string;
  turn: string;
  provider: string;
}): Attributes {
  return {
    "lophn.session": input.session,
    "lophn.turn": input.turn,
    "model.provider": input.provider,
  };
}

export function turnEndAttributes(end: {
  kind: "finished" | "stopped" | "finish_failed";
  outcome?: { kind: string; reason?: string };
  reason?: string;
}): Attributes {
  return {
    "lophn.end": end.kind,
    ...(end.outcome === undefined ? {} : { "lophn.outcome": end.outcome.kind }),
    ...(end.outcome?.reason === undefined
      ? {}
      : { "lophn.reason": codeOf(end.outcome.reason) }),
    ...(end.reason === undefined ? {} : { "lophn.reason": codeOf(end.reason) }),
  };
}

export function modelCallStartAttributes(input: {
  session: string;
  turn: string;
  provider: string;
  model: string;
  purpose: string;
  kind: string;
  order: number;
}): Attributes {
  return {
    "lophn.session": input.session,
    "lophn.turn": input.turn,
    "lophn.purpose": input.purpose,
    "lophn.attempt_kind": input.kind,
    "lophn.attempt_order": input.order,
    "model.provider": input.provider,
    "model.name": input.model,
  };
}

// 끝난 시도의 결과. provider 오류 글(provider_code)과 finish_reason은 provider가 정한 글이라 싣지 않는다.
export function modelCallEndAttributes(
  outcome: Pick<ModelOutcome, "kind" | "code" | "http_status">,
  usage: Pick<
    TokenUsage,
    "input" | "output" | "cache_read" | "cache_write" | "reasoning"
  >,
): Attributes {
  const attributes: Attributes = { "lophn.outcome": outcome.kind };
  if (outcome.code !== null) attributes["lophn.code"] = codeOf(outcome.code);
  if (outcome.http_status !== null) {
    attributes["http.status_code"] = outcome.http_status;
  }
  for (const [name, value] of [
    ["input", usage.input],
    ["output", usage.output],
    ["cache_read", usage.cache_read],
    ["cache_write", usage.cache_write],
    ["reasoning", usage.reasoning],
  ] as const) {
    if (value !== null) attributes[`lophn.tokens.${name}`] = value;
  }
  return attributes;
}

export function toolCallStartAttributes(input: {
  session: string;
  turn: string;
  modelCall: string;
  // 이번 turn이 제공한 tool의 이름이다. model이 지어낸 이름은 여기 오지 않는다.
  tool: string | undefined;
  attempt: number;
}): Attributes {
  return {
    "lophn.session": input.session,
    "lophn.turn": input.turn,
    "lophn.model_call": input.modelCall,
    "lophn.tool": input.tool ?? "unknown",
    "lophn.tool_attempt": input.attempt,
  };
}

export function toolCallEndAttributes(done: {
  tool_call: string;
  status: string;
  code: string;
}): Attributes {
  return {
    "lophn.tool_call": done.tool_call,
    "lophn.outcome": done.status,
    "lophn.code": codeOf(done.code),
  };
}

// 기계가 정한 code(`rate_limited`, `denied` …)만 싣는다. 다른 모양이면 글이 섞였을 수 있어 other로 둔다.
function codeOf(code: string): string {
  return /^[a-z][a-z0-9_.-]{0,47}$/.test(code) ? code : "other";
}

// tracer가 없으면 span 없이 그대로 돌린다. span은 fn 안(과 그 아래 비동기 호출)의 부모가 된다.
export function inAgentSpan<T>(
  tracer: Tracer | undefined,
  name: string,
  attributes: Attributes,
  fn: (span: Span | undefined) => Promise<T>,
): Promise<T> {
  if (tracer === undefined) return fn(undefined);
  return tracer.inSpan(name, { attributes }, fn);
}

export function setAttributes(span: Span | undefined, attributes: Attributes) {
  if (span === undefined) return;
  for (const [key, value] of Object.entries(attributes)) {
    span.setAttribute(key, value);
  }
}
