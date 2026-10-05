// provider 실패 분류(provider#R19–R24). 순수 함수만. IO 없다. HTTP status·
// header·응답 본문 문구를 contract의 ProviderFailure 코드로 옮긴다. 구조화 코드
// 우선·문구 후순위의 단계 분류다(조사 문서 "오류 분류 순서"). 분류 근거가
// 안전하지 않으면 unknown이다. 인증 실패로 추측하지 않는다(provider#R19). 오류
// 본문 원문은 여기에도 어디에도 남지 않는다.

import { USAGE_WAIT_DEFAULT_MS } from "../../../contracts/lophn-agent/mod.ts";
import type { ModelOutcome } from "../../../contracts/lophn-agent/mod.ts";
import type { PROVIDER_FAILURES } from "../../../contracts/lophn-agent/mod.ts";

type ProviderFailure = (typeof PROVIDER_FAILURES)[number];

// ---- Retry-After 해석(provider#R20) ----

// 순서: retry-after-ms → retry-after(숫자 초 또는 HTTP-date) → reset header.
// "retry after" 문구가 "resets in"보다 우선이다(Hermes 조사 93–101).

export type ResetSource = {
  headers: Record<string, string>;
  // error 종료의 사람이 읽을 message. 문구 파싱 근원이다. 원문 보존은 없다.
  message?: string;
  // 지금 시각(ms). HTTP-date와 reset 문구를 시각으로 옮길 때 쓴다.
  nowMs: number;
};

// 숫자가 아닌 reset header 값은 시각이든 무엇이든 버린다. 값이 안전하지 않으면
// 미상과 같다.
export function retryAfterMs(
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

// message 문구. 명시 "retry after N"이 "resets in"보다 우선이다(조사 문서).
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

// ---- 본문 문구(provider#R23) ----

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

export function isOverflowMessage(message: string): boolean {
  return OVERFLOW_PATTERNS.some((pattern) => pattern.test(message));
}

export function isMemoryCeilingMessage(message: string): boolean {
  return MEMORY_CEILING_PATTERNS.some((pattern) => pattern.test(message));
}

// ---- 구조화 코드(provider#R20, R21, R22, R23) ----

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
// 받는다. 원문 본문은 받지 않고 열지도 않는다(R19).
export type FailureInput = {
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
  // 429 경계(ms). 연결 test 상한과 같은 30_000이 안이다.
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
};

export function failureVerdict(input: FailureInput): FailureVerdict {
  // 1. 사람 취소 → cancelled(R23). 원문은 남지 않는다.
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
  // 2. 구조화 코드(조사 문서 순서).
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
  // 5. 남은 것은 unknown이다. 인증 실패로 올리지 않는다(provider#R19).
  return {
    code: "unknown",
    retry_at_ms: null,
    until_ms: null,
    unavailable_reason: null,
    finish_reason: null,
    http_status: input.status,
  };
}

function fromStructuredCode(input: FailureInput): FailureVerdict | null {
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
    // 사용량 제한과 인증 폐기를 구별한다(provider#R21).
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
  if (codeOf(REFUSED_CODES, code) !== null) {
    return { code: "refused", ...blank };
  }
  if (codeOf(RATE_CODES, code) !== null) {
    return rateVerdict(input);
  }
  // 모르는 코드는 다음 단계로 내려간다. 인증 실패로 추측하지 않는다(R19).
  return null;
}

function fromStatus(input: FailureInput): FailureVerdict | null {
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
    // 403이 plan 접근 거절인지는 code가 안전하게 말해 줄 때만 믿는다(provider#R21,
    // R19/R21은 확인된 code만 plan_access, 그 외는 추측 금지).
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
  if (status === 413) {
    // 413를 context_exceeded로 단정하지 않는다. 본문에 한계 문구가 있을 때만이다.
    const fragment = input.message ?? "";
    if (fragment.length > 0 && isOverflowMessage(fragment)) {
      return { code: "context_exceeded", ...blank };
    }
    // 문구 없는 413는 unknown이다(조사 문서 순서 4).
    return null;
  }
  if (status === 500 || status === 502 || status === 503 || status === 529) {
    return { code: "temporary", ...blank };
  }
  return null;
}

function disconnectVerdict(input: FailureInput): FailureVerdict {
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
// usage_wait는 1시간이다(provider#R24).
function rateVerdict(input: FailureInput): FailureVerdict {
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
    // temporary의 retry_at은 시각 전달이다(provider#R20).
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
    until_ms: input.nowMs + USAGE_WAIT_DEFAULT_MS,
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
    provider_code: null,
  };
}
