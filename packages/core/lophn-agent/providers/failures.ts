// provider 실패 분류. 순수 함수만. IO 없다. HTTP status·
// header·응답 본문 문구를 contract의 ProviderFailure 코드로 옮긴다. 구조화 코드
// 우선·문구 후순위의 단계 분류다. 분류 근거가
// 안전하지 않으면 unknown이다. 인증 실패로 추측하지 않는다. 오류
// 본문 원문은 여기에도 어디에도 남지 않는다.

import { USAGE_WAIT_DEFAULT_MS } from "../../../protocol/lophn-agent/mod.ts";
import type { ModelOutcome } from "../../../protocol/lophn-agent/mod.ts";
import type { PROVIDER_FAILURES } from "../../../protocol/lophn-agent/mod.ts";

type ProviderFailure = (typeof PROVIDER_FAILURES)[number];

// ---- Retry-After 해석 ----

// 순서: retry-after-ms → retry-after(숫자 초 또는 HTTP-date) → reset header.
// "retry after" 문구가 "resets in"보다 우선이다.

type ResetSource = {
  headers: Record<string, string>;
  // error 종료의 사람이 읽을 message. 문구 파싱 근원이다. 원문 보존은 없다.
  message?: string;
  // 지금 시각(ms). HTTP-date와 reset 문구를 시각으로 옮길 때 쓴다.
  nowMs: number;
};

// 숫자가 아닌 reset header 값은 시각이든 무엇이든 버린다. 값이 안전하지 않으면
// 미상과 같다.
function retryAfterMs(
  source: ResetSource,
): number | null {
  const msHeader = source.headers["retry-after-ms"];
  if (msHeader !== undefined) {
    const n = numberHeaders(msHeader);
    if (n !== null && n >= 0) return n;
  }
  const seconds = source.headers["retry-after"];
  if (seconds !== undefined) {
    const parsed = retryAfterHeader(seconds, source.nowMs);
    if (parsed !== null) return parsed;
  }
  // reset header는 provider별 이름이 갈린다. 알려진 이름만 숫자로 본다.
  for (
    const name of ["x-ratelimit-reset", "anthropic-ratelimit-unified-reset"]
  ) {
    const value = source.headers[name];
    if (value === undefined) continue;
    if (name === "anthropic-ratelimit-unified-reset") {
      // epoch 초다(확인된 Anthropic 헤더).
      const n = numberHeaders(value);
      if (n !== null && n >= 0) return n * 1000;
      continue;
    }
    const parsed = resetHeaderValue(value, source.nowMs);
    if (parsed !== null) return parsed;
  }
  return messageResetMs(source.message);
}

function numberHeaders(value: string): number | null {
  const trimmed = value.trim();
  if (!/^[0-9]+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

// retry-after: 숫자 초 또는 HTTP-date다. 숫자는 ms로, date는 지금과의 차이다.
function retryAfterHeader(value: string, nowMs: number): number | null {
  const trimmed = value.trim();
  if (/^[0-9]+$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isSafeInteger(n) && n >= 0 ? n * 1000 : null;
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}

// x-ratelimit-reset: 숫자면 초·ms 중 작은 값이 아니라 RFC 초 규약으로 본다.
// 시각 문자열(HTTP-date·ISO)도 받는다. 그 외는 미상이다.
function resetHeaderValue(value: string, nowMs: number): number | null {
  const trimmed = value.trim();
  if (/^[0-9]+$/.test(trimmed)) {
    const n = Number(trimmed);
    if (!Number.isSafeInteger(n) || n < 0) return null;
    // epoch 초(10자리 이상)와 상대 초(짧은 값)를 구별한다.
    return n >= 1_000_000_000 ? Math.max(0, n * 1000 - nowMs) : n * 1000;
  }
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - nowMs);
}

// message 문구. 명시 "retry after N"이 "resets in"보다 우선이다.
function messageResetMs(message: string | undefined): number | null {
  if (message === undefined) return null;
  const retry = /retry after\s+(\d+)\s*(ms|s|seconds?|minutes?|m)/i.exec(
    message,
  );
  if (retry !== null) {
    const n = Number(retry[1]);
    const unit = retry[2].toLowerCase();
    if (unit === "ms") return n;
    if (unit.startsWith("s")) return n * 1000;
    return n * 60_000;
  }
  const resets = /resets in\s+(\d+)\s*(ms|s|seconds?|m|minutes?|h|hr|hours?)/i
    .exec(message);
  if (resets !== null) {
    const n = Number(resets[1]);
    const unit = resets[2].toLowerCase();
    if (unit === "ms") return n;
    if (unit.startsWith("h")) return n * 3_600_000;
    if (unit.startsWith("m")) return n * 60_000;
    return n * 1000;
  }
  return null;
}

// ---- 본문 문구 ----

// overflow 문구(Pi OVERFLOW_PATTERNS 기준). provider별 문구를 한 목록으로 모으되
// byte·메모리 한도 문구는 여기에 두지 않는다.
const OVERFLOW_PATTERNS: readonly RegExp[] = [
  /context length/i,
  /max_tokens/i,
  /exceeds the max_model_len/i,
  /maximum context length/i,
  /input length and\s+`max_tokens`/i,
  /tokens in request more than max tokens allowed/i,
  /request entity too large/i,
  /context window/i,
  /prompt is too long/i,
  /prompt too long/i,
  /input is too long/i,
  /expected \(?prompt|reduce the length of the input/i,
  /context_length_exceeded/i,
  /please reduce the length of the messages/i,
  /reduce the length of the messages or completion/i,
  /input length.*exceeds.*context length/i,
  /만큼 또는 더 많은 입력/i,
];

// 메모리·byte 한도 문구(Hermes 조사). 이 문구가 있으면 overflow가 아니라
// 과부하(temporary)다. "limit exceeded" 하위 문구와 billing을 구별하는 근원이다.
const MEMORY_CEILING_PATTERNS: readonly RegExp[] = [
  /memory limit exceeded/i,
  /out of memory/i,
  /request too large for this model to process/i,
];

function isOverflowMessage(message: string): boolean {
  return OVERFLOW_PATTERNS.some((pattern) => pattern.test(message));
}

function isMemoryCeilingMessage(message: string): boolean {
  return MEMORY_CEILING_PATTERNS.some((pattern) => pattern.test(message));
}

// ---- 구조화 코드 ----

const CONTEXT_EXCEEDED_CODES: readonly string[] = ["context_length_exceeded"];
const CREDENTIAL_CODES: readonly string[] = [
  "insufficient_quota",
  "credit_balance_exhausted",
  "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded",
];
const MODEL_CODES: readonly string[] = [
  "model_not_found",
  "model_not_available",
];
const INVALID_REQUEST_CODES: readonly string[] = ["invalid_prompt"];
const REFUSED_CODES: readonly string[] = [
  "content_filter",
  "cyber_policy",
  "bio_policy",
  "refusal",
];
// 서버 부하 계열 코드는 status 단계의 429 규칙과 같은 판으로 간다.
const RATE_CODES: readonly string[] = [
  "server_is_overloaded",
  "rate_limit_exceeded",
  "slow_down",
];

function codeOf(
  codes: readonly string[],
  value: string | undefined,
): string | null {
  if (value === undefined) return null;
  return codes.includes(value) ? value : null;
}

// ---- 분류 입력 ----

// 오류가 온 자리. HTTP status·header·구조화 code·사람이 읽을 message 파편만
// 받는다. 원문 본문은 받지 않고 열지도 않는다.
type FailureInput = {
  kind: "http" | "stream_error";
  status: number | null;
  headers: Record<string, string>;
  // provider가 준 구조화 code(error.code·error.type).
  code?: string;
  // 종료 message 파편. 원문이 아니라 이 파편만 문구 파싱에 쓰고 버린다.
  message?: string;
  // 사람이 요청을 멈췄는가. 취소는 항상 첫 단계다.
  cancelled?: boolean;
  // 지금 시각(ms). 429 경계와 reset default에 쓴다.
  nowMs: number;
  // 429 경계(ms). 기본은 30_000이고 이 안이면 일시 실패다.
  temporary_ms?: number;
};

// 분류 결과. ModelOutcome 중 failed 꼴이다. retry_at는 temporary에만 있다.
export type FailureVerdict = {
  code: ProviderFailure;
  retry_at_ms: number | null;
  // credential_unavailable의 usage_wait 기한(atSchema 꼴 is the caller's job).
  until_ms: number | null;
  unavailable_reason:
    | "authentication"
    | "quota"
    | "plan_access"
    | "refresh_revoked"
    | null;
  finish_reason: string | null;
  http_status: number | null;
  // provider가 준 구조화 code 중 안전한 토큰 꼴만이다. 본문 문구는 아니다.
  provider_code: string | null;
};

type CoreVerdict = Omit<FailureVerdict, "provider_code">;

const SAFE_PROVIDER_CODE = /^[A-Za-z0-9_.:-]{1,64}$/;

function failureVerdict(input: FailureInput): FailureVerdict {
  const core = coreVerdict(input);
  // 구조화 code만 안전한 토큰이면 남긴다. 본문 문구와 원문은 남기지 않는다.
  const code = input.code !== undefined && SAFE_PROVIDER_CODE.test(input.code)
    ? input.code
    : null;
  return { ...core, provider_code: code };
}

function coreVerdict(input: FailureInput): CoreVerdict {
  // 1. 사람 취소 → cancelled. 원문은 남지 않는다.
  if (input.cancelled === true) {
    return {
      code: "cancelled",
      retry_at_ms: null,
      until_ms: null,
      unavailable_reason: null,
      finish_reason: null,
      http_status: input.status,
    };
  }
  // 2. 구조화 코드.
  const structured = fromStructuredCode(input);
  if (structured !== null) return structured;
  // 3. HTTP status.
  const byStatus = fromStatus(input);
  if (byStatus !== null) return byStatus;
  // 4. 본문 문구: overflow 문구는 context_exceeded, 메모리 한도 문구는 temporary.
  const fragment = input.message ?? "";
  if (fragment.length > 0 && isOverflowMessage(fragment)) {
    return {
      code: "context_exceeded",
      retry_at_ms: null,
      until_ms: null,
      unavailable_reason: null,
      finish_reason: null,
      http_status: input.status,
    };
  }
  if (fragment.length > 0 && isMemoryCeilingMessage(fragment)) {
    return {
      code: "temporary",
      retry_at_ms: null,
      until_ms: null,
      unavailable_reason: null,
      finish_reason: null,
      http_status: input.status,
    };
  }
  // 5. 남은 것은 unknown이다. 인증 실패로 올리지 않는다.
  return {
    code: "unknown",
    retry_at_ms: null,
    until_ms: null,
    unavailable_reason: null,
    finish_reason: null,
    http_status: input.status,
  };
}

function fromStructuredCode(input: FailureInput): CoreVerdict | null {
  const code = input.code;
  if (code === undefined) return null;
  const blank = {
    retry_at_ms: null,
    until_ms: null,
    unavailable_reason: null,
    finish_reason: null,
    http_status: input.status,
  };
  if (codeOf(CONTEXT_EXCEEDED_CODES, code) !== null) {
    return { code: "context_exceeded", ...blank };
  }
  if (codeOf(CREDENTIAL_CODES, code) !== null) {
    // 사용량 제한과 인증 폐기를 구별한다.
    return {
      code: "credential_unavailable",
      ...blank,
      unavailable_reason: "quota",
    };
  }
  if (codeOf(MODEL_CODES, code) !== null) {
    return { code: "model_unavailable", ...blank };
  }
  if (codeOf(INVALID_REQUEST_CODES, code) !== null) {
    return { code: "invalid_request", ...blank };
  }
  if (code === "invalid_request_error") {
    // Anthropic은 문맥 초과도 이 type으로 알린다. 한계 문구가 있으면 문맥 초과,
    // 없으면 검증 실패다. 인증 실패로 추측하지 않는다.
    const fragment = input.message ?? "";
    if (fragment.length > 0 && isOverflowMessage(fragment)) {
      return { code: "context_exceeded", ...blank };
    }
    return { code: "invalid_request", ...blank };
  }
  if (codeOf(REFUSED_CODES, code) !== null) {
    return { code: "refused", ...blank };
  }
  if (codeOf(RATE_CODES, code) !== null) {
    // 과부하 계열 code는 아래로 내려간다. 429·과부하 status는
    // status 단계의 규칙이 판한다. 429가 아니면 reset 근거 없이 temporary다.
    return input.status === 429 ? rateVerdict(input) : null;
  }
  // 모르는 코드는 다음 단계로 내려간다. 인증 실패로 추측하지 않는다.
  return null;
}

function fromStatus(input: FailureInput): CoreVerdict | null {
  const status = input.status;
  if (status === null) return disconnectVerdict(input);
  const blank = {
    retry_at_ms: null,
    until_ms: null,
    unavailable_reason: null,
    finish_reason: null,
    http_status: status,
  };
  if (status === 429) return rateVerdict(input);
  if (status === 401 || status === 403) {
    // 403이 plan 접근 거절인지는 code가 안전하게 말해 줄 때만 믿는다.
    // 확인된 code만 plan_access, 그 외는 추측 금지).
    if (input.code === "plan_access" || input.code === "plan_access_denied") {
      return {
        code: "credential_unavailable",
        ...blank,
        unavailable_reason: "plan_access",
      };
    }
    // 인증 거절은 credential_unavailable이다. 인증 폐기(revoked)와 구별된다.
    return {
      ...blank,
      code: "credential_unavailable",
      unavailable_reason: "authentication",
    };
  }
  if (status === 402) {
    // 결제 필요는 잔액·결제 문제다. 인증 폐기가 아니라 사용량 쪽 사용 불가다.
    return {
      ...blank,
      code: "credential_unavailable",
      unavailable_reason: "quota",
    };
  }
  if (status === 404) {
    // 404는 model 없음이 확인될 때만이다. 다른 자원의 404는 원인 불명이다.
    if (
      input.code === "not_found_error" &&
      /\bmodel\b/i.test(input.message ?? "")
    ) {
      return { code: "model_unavailable", ...blank };
    }
    return null;
  }
  if (status === 413) {
    // 413를 context_exceeded로 단정하지 않는다. 본문에 한계 문구가 있을 때만이다.
    const fragment = input.message ?? "";
    if (fragment.length > 0 && isOverflowMessage(fragment)) {
      return { code: "context_exceeded", ...blank };
    }
    // 문구 없는 413는 unknown이다.
    return null;
  }
  if (status === 500 || status === 502 || status === 503 || status === 529) {
    return { code: "temporary", ...blank };
  }
  return null;
}

function disconnectVerdict(input: FailureInput): CoreVerdict {
  // 연결 실패·스트림 단절은 beyondStatus 단계에서 맡는다. status가 null이면
  // temporary다.
  const fragment = input.message ?? "";
  if (fragment.length > 0 && isOverflowMessage(fragment)) {
    return {
      code: "context_exceeded",
      retry_at_ms: null,
      until_ms: null,
      unavailable_reason: null,
      finish_reason: null,
      http_status: null,
    };
  }
  return {
    code: "temporary",
    retry_at_ms: null,
    until_ms: null,
    unavailable_reason: null,
    finish_reason: null,
    http_status: null,
  };
}

// 429와 과부하 코드 계열. retry 시각이 30초(주는 쪽이 정한 상한) 이내로 확인되면
// temporary(시각 전달), 초과·미상이면 credential_unavailable이다. 미상의
// usage_wait는 1시간이다.
function rateVerdict(input: FailureInput): CoreVerdict {
  const status = input.status;
  const boundary = input.temporary_ms ?? 30_000;
  const reset = retryAfterMs({
    headers: input.headers,
    message: input.message,
    nowMs: input.nowMs,
  });
  const base = {
    finish_reason: null,
    http_status: status,
  };
  if (reset !== null && reset <= boundary) {
    // temporary의 retry_at은 시각 전달이다.
    return {
      code: "temporary",
      retry_at_ms: input.nowMs + reset,
      until_ms: null,
      unavailable_reason: null,
      ...base,
    };
  }
  // 잔액·지출 한도 code가 이미 credential_unavailable로 갔으면 여기 오지 않는다.
  return {
    code: "credential_unavailable",
    retry_at_ms: null,
    // 서버가 준 reset 시각까지 유지하고 시각을 모르면 1시간이다.
    until_ms: input.nowMs + (reset ?? USAGE_WAIT_DEFAULT_MS),
    unavailable_reason: "quota",
    ...base,
  };
}

// ---- ModelOutcome 변환 ----

// FailureVerdict를 contract의 ModelOutcome 중 failed 꼴로 옮긴다. 시각은
// atSchema(ISO ms) 꼴로 만든다(retry_at는 temporary에만 있다).
export function outcomeFromVerdict(
  verdict: FailureVerdict,
  at: (ms: number) => string,
): ModelOutcome {
  return {
    kind: "failed",
    code: verdict.code,
    retry_at: verdict.retry_at_ms === null ? null : at(verdict.retry_at_ms),
    finish_reason: verdict.finish_reason,
    http_status: verdict.http_status,
    provider_code: verdict.provider_code,
  };
}

// ---- HTTP 응답·본문 안의 오류 ----

// 오류 본문에서 읽는 조각의 크기 상한. 이 안의 조각만 분류에 쓰고 버린다.
export const ERROR_BODY_MAX_BYTES = 65_536;
const FRAGMENT_MAX_CHARS = 2000;

type ErrorFacts = { code?: string; message?: string };

// 오류 본문 한 덩어리에서 구조화 code와 문구 조각만 뽑는다. 본문 원문은 반환하지
// 않고 호출자도 남기지 않는다. 읽을 수 없으면 빈 facts다(원인 불명으로 간다).
function errorFactsFromBody(text: string | null): ErrorFacts {
  if (text === null || text.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // JSON이 아닌 본문은 문구 조각만이다(예: proxy의 413 평문).
    return { message: text.slice(0, FRAGMENT_MAX_CHARS) };
  }
  if (Array.isArray(parsed)) parsed = parsed[0];
  if (parsed === null || typeof parsed !== "object") return {};
  const root = parsed as Record<string, unknown>;
  const error = root.error;
  if (typeof error === "string") {
    return { message: error.slice(0, FRAGMENT_MAX_CHARS) };
  }
  const holder = error !== null && typeof error === "object"
    ? error as Record<string, unknown>
    : root;
  const facts: ErrorFacts = {};
  // code가 type보다 구체적이다(OpenAI는 error.code, Anthropic은 error.type).
  if (typeof holder.code === "string" && holder.code !== "") {
    facts.code = holder.code;
  } else if (typeof holder.type === "string" && holder.type !== "") {
    facts.code = holder.type;
  }
  if (typeof holder.message === "string") {
    facts.message = holder.message.slice(0, FRAGMENT_MAX_CHARS);
  }
  return facts;
}

function headersRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, name) => {
    record[name.toLowerCase()] = value;
  });
  return record;
}

// HTTP 오류 응답 하나를 분류한다. body는 이미 크기 상한 안으로 읽은 JSON 본문이다.
export function classifyHttpFailure(input: {
  status: number;
  headers: Headers | Record<string, string>;
  body: string | null;
  nowMs: number;
}): FailureVerdict {
  const facts = errorFactsFromBody(input.body);
  return failureVerdict({
    kind: "http",
    status: input.status,
    headers: input.headers instanceof Headers
      ? headersRecord(input.headers)
      : input.headers,
    code: facts.code,
    message: facts.message,
    nowMs: input.nowMs,
  });
}

// 문서화된 stream 오류 type이 HTTP로 왔다면 갖는 status다. 이 표에 없는 type은
// status 없이 분류하며, 그 경우 원인 불명이다(연결 단절 근거가 아니다).
const STREAM_TYPE_STATUS: Readonly<Record<string, number>> = {
  overloaded_error: 529,
  api_error: 500,
  rate_limit_error: 429,
  authentication_error: 401,
  permission_error: 403,
  billing_error: 402,
  not_found_error: 404,
  request_too_large: 413,
  invalid_request_error: 400,
};

// 200 응답 stream 안의 오류 event(Anthropic error frame, Responses response.failed,
// Chat error chunk)를 분류한다. HTTP header가 없으므로 429는 reset 시각 미상이다.
export function classifyStreamFailure(input: {
  type?: string;
  message?: string;
  nowMs: number;
}): FailureVerdict {
  const status = input.type === undefined
    ? undefined
    : STREAM_TYPE_STATUS[input.type];
  const verdict = failureVerdict({
    kind: "stream_error",
    // status를 모르는 type은 status 단계를 건너뛴다. 단절로 보지도 않는다.
    status: status ?? 0,
    headers: {},
    code: input.type,
    message: input.message,
    nowMs: input.nowMs,
  });
  // 0은 HTTP status가 아니다. outcome에는 status 없음으로 남긴다.
  return { ...verdict, http_status: status ?? null };
}
