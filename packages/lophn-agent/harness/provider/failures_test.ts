// lophn-agent/harness/provider#R19–R24 실패 분류 테스트. 순수 함수만 본다.
// 실제 provider를 부르지 않고 오류 본문 원문을 어디에도 남기지 않는다(R19).
import { assert, assertEquals } from "@std/assert";
import {
  type FailureInput,
  failureVerdict,
  isMemoryCeilingMessage,
  isOverflowMessage,
  outcomeFromVerdict,
  type ResetSource,
  retryAfterMs,
} from "./failures.ts";

const NOW = Date.UTC(2026, 0, 1);

function http(input: Partial<FailureInput>): FailureInput {
  return {
    kind: "http",
    status: null,
    headers: {},
    nowMs: NOW,
    ...input,
  };
}

function base(input: Partial<FailureInput> = {}): FailureInput {
  return http(input);
}

// ── R19: 구별 전달, unknown 인증 추측 금지, 본문 보존 없음 ────────────────

Deno.test("lophn-agent/harness/provider#R19: 원인 불명 오류는 unknown이고 인증 실패로 추측하지 않는다", () => {
  // 구조화 code도 한계 문구도 없는 400·500대 밖 판은 unknown이다.
  const verdict = failureVerdict(
    base({ status: 400, message: "something happened" }),
  );
  assertEquals(verdict.code, "unknown");
  assertEquals(verdict.unavailable_reason, null);
  // 모르는 구조화 code도 다음 단계로 내려가 최종 unknown이다.
  const unknownCode = failureVerdict(
    base({ status: 418, code: "some_new_code" }),
  );
  assertEquals(unknownCode.code, "unknown");
  assertEquals(unknownCode.unavailable_reason, null);
  // 500대 밖·문구 없는 stream_error 단절은 temporary다(R20).
  const streamUnknown = failureVerdict(
    base({ kind: "stream_error", status: null }),
  );
  assertEquals(streamUnknown.code, "temporary");
  assertEquals(streamUnknown.unavailable_reason, null);
});

Deno.test("lophn-agent/harness/provider#R19: 분류 결과에 오류 본문 원문이 남지 않는다", () => {
  const secret = "raw body with credential sk-example-value";
  const verdict = failureVerdict(base({ status: 400, message: secret }));
  const outcome = outcomeFromVerdict(
    verdict,
    (ms) => new Date(ms).toISOString(),
  );
  // ModelOutcome 필드만 있다. message 파편은 결과로 옮기지 않는다.
  assertEquals(JSON.stringify(outcome).includes(secret), false);
  assertEquals(Object.keys(outcome).sort(), [
    "code",
    "finish_reason",
    "http_status",
    "kind",
    "provider_code",
    "retry_at",
  ]);
});

// ── R20: 일시 실패(연결·단절·500·502·503·529·짧은 429), retry-after 순서 ──

Deno.test("lophn-agent/harness/provider#R20: 연결 실패·스트림 단절은 temporary다", () => {
  // status 없는 연결 실패다.
  assertEquals(failureVerdict(base({ status: null })).code, "temporary");
  // transport 예외와 같은 단절 파편이 있어도 temporary다.
  assertEquals(
    failureVerdict(base({ status: null, message: "connection refused" })).code,
    "temporary",
  );
});

Deno.test("lophn-agent/harness/provider#R20: HTTP 500·502·503·529는 temporary다", () => {
  for (const status of [500, 502, 503, 529]) {
    assertEquals(
      failureVerdict(base({ status })).code,
      "temporary",
      `${status}`,
    );
  }
});

Deno.test("lophn-agent/harness/provider#R20: retry 시각이 30초 이내로 확인된 429는 temporary이고 시각을 전달한다", () => {
  const verdict = failureVerdict(base({
    status: 429,
    headers: { "retry-after": "10" },
  }));
  assertEquals(verdict.code, "temporary");
  assertEquals(verdict.retry_at_ms, NOW + 10_000);
  assertEquals(verdict.until_ms, null);
  // 경게 값: 정확히 30초도 temporary다.
  const edge = failureVerdict(base({
    status: 429,
    headers: { "retry-after-ms": "30000" },
  }));
  assertEquals(edge.code, "temporary");
  assertEquals(edge.retry_at_ms, NOW + 30_000);
  // 과부하 계열 구조화 code도 같은 판을 지난다.
  const overloaded = failureVerdict(base({
    status: 529,
    code: "server_is_overloaded",
  }));
  assertEquals(overloaded.code, "temporary");
});

Deno.test("lophn-agent/harness/provider#R20: retry-after-ms → retry-after(숫자·HTTP-date) → reset header 순서로 해석한다", () => {
  // retry-after-ms가 최우선이다.
  assertEquals(
    retryAfterMs({
      headers: { "retry-after-ms": "15000", "retry-after": "120" },
      nowMs: NOW,
    }),
    15_000,
  );
  // retry-after 숫자 초(ms 변환).
  assertEquals(
    retryAfterMs({ headers: { "retry-after": "120" }, nowMs: NOW }),
    120_000,
  );
  // retry-after HTTP-date(지금과의 차이).
  const date = new Date(NOW + 45_000).toUTCString();
  assertEquals(
    retryAfterMs({ headers: { "retry-after": date }, nowMs: NOW }),
    45_000,
  );
  // reset header는 그 다음이다. x-ratelimit-reset 상대 초.
  assertEquals(
    retryAfterMs({ headers: { "x-ratelimit-reset": "60" }, nowMs: NOW }),
    60_000,
  );
  // 숫자·date 헤더가 없으면 message 문구다. retry가 resets보다 우선이다.
  assertEquals(
    retryAfterMs({
      headers: {},
      message: "quota exceeded. retry after 30 s. resets in 4hr.",
      nowMs: NOW,
    }),
    30_000,
  );
  // message 문구: resets in.
  assertEquals(
    retryAfterMs({ headers: {}, message: "resets in 2hr", nowMs: NOW }),
    7_200_000,
  );
  // 아무 근거도 없으면 미상이다.
  assertEquals(retryAfterMs({ headers: {}, nowMs: NOW }), null);
  assertEquals(
    retryAfterMs({ headers: {}, message: undefined, nowMs: NOW }),
    null,
  );
});

Deno.test("lophn-agent/harness/provider#R20: SDK 숨은 retry 상수는 0이다", async () => {
  // 숨은 retry는 없다. 호출은 한 번이다(provider#R20).
  const work = await import("./work.ts");
  assertEquals(work.SDK_RETRIES, 0);
});

// ── R21: credential 사용 불가(인증 거절·잔액·지출 한도·긴·미상 429) ───────

Deno.test("lophn-agent/harness/provider#R21: 인증 거절 401·403은 credential_unavailable이다", () => {
  for (const status of [401, 403]) {
    const verdict = failureVerdict(base({ status }));
    assertEquals(verdict.code, "credential_unavailable", `${status}`);
    assertEquals(verdict.unavailable_reason, "authentication");
    assertEquals(verdict.until_ms, null);
  }
});

Deno.test("lophn-agent/harness/provider#R21: 잔액·지출 한도 구조화 code는 credential_unavailable이고 인증 폐기와 구별된다", () => {
  for (
    const code of [
      "insufficient_quota",
      "credit_balance_exhausted",
      "organization_spend_limit_exceeded",
      "project_spend_limit_exceeded",
    ]
  ) {
    const verdict = failureVerdict(base({ status: 400, code }));
    assertEquals(verdict.code, "credential_unavailable", code);
    // 사용량 제한이다. 인증 폐기(refresh_revoked)가 아니다(R21).
    assertEquals(verdict.unavailable_reason, "quota");
  }
});

Deno.test("lophn-agent/harness/provider#R21: 30초 초과 429는 credential_unavailable이다", () => {
  const verdict = failureVerdict(base({
    status: 429,
    headers: { "retry-after": "120" },
  }));
  assertEquals(verdict.code, "credential_unavailable");
  assertEquals(verdict.retry_at_ms, null);
  assertEquals(verdict.unavailable_reason, "quota");
});

Deno.test("lophn-agent/harness/provider#R21: 시각 미상 429는 credential_unavailable이고 usage_wait는 1시간이다", () => {
  const verdict = failureVerdict(base({ status: 429 }));
  assertEquals(verdict.code, "credential_unavailable");
  assertEquals(verdict.retry_at_ms, null);
  assertEquals(verdict.until_ms, NOW + 3_600_000);
  assertEquals(verdict.unavailable_reason, "quota");
});

Deno.test("lophn-agent/harness/provider#R21: 확인된 plan 접근 거절 403은 인증 폐기와 구별된다", () => {
  const verdict = failureVerdict(base({ status: 403, code: "plan_access" }));
  assertEquals(verdict.code, "credential_unavailable");
  // plan_access다. authentication 폐기가 아니다(R21).
  assertEquals(verdict.unavailable_reason, "plan_access");
});

// ── R22: model 사용 불가는 그 credential+model만 막는다 ──────────────────

Deno.test("lophn-agent/harness/provider#R22: model 없음·불가 code는 model_unavailable 분류다", () => {
  for (const code of ["model_not_found", "model_not_available"]) {
    const verdict = failureVerdict(base({ status: 404, code }));
    assertEquals(verdict.code, "model_unavailable", code);
    // model_unavailable은 credential 상태를 바꾸는 unavailable_reason이 없다.
    assertEquals(verdict.unavailable_reason, null);
  }
});

// ── R23: 문맥 초과·사람 취소·응답 거절 구별 ────────���───────────────────

Deno.test("lophn-agent/harness/provider#R23: 문맥 초과 code와 한계 문구는 context_exceeded다", () => {
  // 구조화 code 우선이다.
  assertEquals(
    failureVerdict(base({ status: 400, code: "context_length_exceeded" })).code,
    "context_exceeded",
  );
  // code 없이 문구만 있는 본문도 context_exceeded다.
  assertEquals(
    failureVerdict(
      base({ status: 400, message: "maximum context length is 200000 tokens" }),
    ).code,
    "context_exceeded",
  );
  assert(isOverflowMessage("prompt is too long: 300000 tokens > 200000"));
  // 413은 문구가 있을 때만 context_exceeded다.
  assertEquals(
    failureVerdict(base({ status: 413, message: "request entity too large" }))
      .code,
    "context_exceeded",
  );
});

Deno.test("lophn-agent/harness/provider#R23: 문구 없는 413는 context_exceeded로 단정하지 않는다", () => {
  assertEquals(failureVerdict(base({ status: 413 })).code, "unknown");
});

Deno.test("lophn-agent/harness/provider#R23: 사람 취소는 cancelled다", () => {
  const verdict = failureVerdict(base({ cancelled: true, status: 499 }));
  assertEquals(verdict.code, "cancelled");
  assertEquals(verdict.retry_at_ms, null);
  assertEquals(verdict.unavailable_reason, null);
});

Deno.test("lophn-agent/harness/provider#R23: 응답 거절은 refused다", () => {
  for (
    const code of ["content_filter", "cyber_policy", "bio_policy", "refusal"]
  ) {
    const verdict = failureVerdict(base({ status: 400, code }));
    assertEquals(verdict.code, "refused", code);
  }
});

Deno.test("lophn-agent/harness/provider#R23: 잘못된 요청은 invalid_request다", () => {
  assertEquals(
    failureVerdict(base({ status: 400, code: "invalid_prompt" })).code,
    "invalid_request",
  );
});

Deno.test("lophn-agent/harness/provider#R23: 메모리·byte 한도 문구는 overflow가 아니라 temporary다", () => {
  // Hermes 조사: memory ceiling을 overflow와 분리해 과부하로 보낸다.
  assert(isMemoryCeilingMessage("memory limit exceeded"));
  const verdict = failureVerdict(base({
    status: 400,
    message: "memory limit exceeded while loading model",
  }));
  assertEquals(verdict.code, "temporary");
  // 메모리 문구는 overflow로 세지 않는다.
  assertEquals(isOverflowMessage("memory limit exceeded"), false);
});

Deno.test("lophn-agent/harness/provider#R23: 알리지 않는 provider의 초과는 원인 불명이다(질문 Q5)", () => {
  // z.ai·Ollama처럼 overflow를 알리지 않는 provider의 판은 문구 근거가 없다.
  // 조용한 truncation 잡아내기는 본문 파편이 없어 여기 오지 않는다.
  const verdict = failureVerdict(base({ status: 400, message: "" }));
  assertEquals(verdict.code, "unknown");
});

// ── R24: usage_wait는 reset까지 또는 1시간이다 ──────────────────────────

Deno.test("lophn-agent/harness/provider#R24: 확인된 reset 시각은 retry_at 교재로 전달되고 until은 임의가 아니다", () => {
  // reset이 확인된 temporary에는 usage_wait until이 없다.
  const temporary = failureVerdict(base({
    status: 429,
    headers: { "retry-after": "5" },
  }));
  assertEquals(temporary.retry_at_ms, NOW + 5_000);
  assertEquals(temporary.until_ms, null);
  // reset이 확인된 긴 429의 until은 시각 전달이 아니라 default다. reset 시각을
  // 서버가 주지 않으면(미상) 1시간이다(R24).
  const waiting = failureVerdict(base({
    status: 429,
    headers: { "x-ratelimit-reset": "7200" },
  }));
  assertEquals(waiting.code, "credential_unavailable");
  assertEquals(waiting.until_ms, NOW + 3_600_000);
});
