// lophn-agent/harness/provider#R4, R10, R27 credential 사용 가능·과금 테스트. 순수 함수만
// 본다. 실제 provider를 부르지 않는다. provider에는 credential이 하나라 고르거나 뒤 계정으로 넘기는
// 규칙은 없다(R8, R10).
import { assert, assertEquals } from "@std/assert";
import {
  availabilityFromVerdict,
  billingRouteOf,
  credentialUsable,
} from "./credentials.ts";
import type { ProviderCredential } from "../../../protocol/lophn-agent/mod.ts";
import { failureVerdict } from "./failures.ts";
import * as credentials from "./credentials.ts";
const NOW = Date.UTC(2026, 0, 1);
const MODEL = "gpt";

const at = (ms: number) => new Date(ms).toISOString();

// provider의 credential 기본 꼴. state·until·model_blocks는 테스트가 바꿔 쓴다.
function credential(
  over: Partial<ProviderCredential> = {},
): ProviderCredential {
  return {
    kind: "api_key",
    secret_ref: {
      name: "provider.openai",
      sealed_ref: "seal-main",
      revision: 1,
    },
    revision: 1,
    state: "available",
    unavailable_reason: null,
    until: null,
    expires_at: null,
    logged_in_at: null,
    refreshed_at: null,
    model_blocks: [],
    ...over,
  };
}

const facts = { modelName: MODEL, nowMs: NOW };

// ── R4·R10: 하나뿐인 credential을 쓸 수 있는가 ───────────────────────────

Deno.test("lophn-agent/harness/provider#R10: 고르거나 뒤 credential로 넘기는 함수는 없다", () => {
  for (
    const gone of [
      "nextCredential",
      "sameSelection",
      "credentialMatchesModel",
    ]
  ) {
    assertEquals(gone in credentials, false, gone);
  }
});

Deno.test("lophn-agent/harness/provider#R10: usage_wait는 until 도달까지 막고 도달하면 풀린다", () => {
  const waiting = credential({
    state: "usage_wait",
    unavailable_reason: "quota",
    until: at(NOW + 60_000),
  });
  // until 전이다. 하나뿐인 credential이라 대신 쓸 것도 없다(R24).
  assertEquals(credentialUsable(waiting, facts), false);
  // until 도달 뒤다. until 경계를 지나면 usable이다.
  assertEquals(
    credentialUsable(waiting, { modelName: MODEL, nowMs: NOW + 61_000 }),
    true,
  );
});

Deno.test("lophn-agent/harness/provider#R10: model 전용 대기는 그 model에만 적용된다", () => {
  const blocked = credential({
    model_blocks: [{
      model_name: MODEL,
      reason: "not_found",
      until: at(NOW + 60_000),
    }],
  });
  // 이 model은 막혔다(R22).
  assertEquals(credentialUsable(blocked, facts), false);
  // 다른 model은 막히지 않았다. 같은 credential의 다른 model 사용 가능 상태는
  // 바뀌지 않는다(R22).
  assertEquals(
    credentialUsable(blocked, { ...facts, modelName: "other-model" }),
    true,
  );
});

Deno.test("lophn-agent/harness/provider#R4: rejected·revoked credential은 쓰지 않고 연결이 없으면 쓸 것이 없다", () => {
  assertEquals(credentialUsable(credential(), facts), true);
  assertEquals(
    credentialUsable(
      credential({
        state: "revoked",
        unavailable_reason: "refresh_revoked",
      }),
      facts,
    ),
    false,
  );
  assertEquals(
    credentialUsable(
      credential({ state: "rejected", unavailable_reason: "authentication" }),
      facts,
    ),
    false,
  );
  assertEquals(credentialUsable(null, facts), false);
});

// ── R27: 과금 경로 구별 ─────────────────────────────────────────────────

Deno.test("lophn-agent/harness/provider#R27: API key는 API 과금이다", () => {
  assertEquals(billingRouteOf(credential({ kind: "api_key" })), "api");
});

Deno.test("lophn-agent/harness/provider#R27: ChatGPT·SuperGrok OAuth는 구독이다", () => {
  // ChatGPT·SuperGrok OAuth credential은 모두 구독 과금 경로다(R27).
  assertEquals(
    billingRouteOf(
      credential({ kind: "oauth" }),
    ),
    "subscription",
  );
  assertEquals(
    billingRouteOf(
      credential({ kind: "oauth", refreshed_at: at(NOW) }),
    ),
    "subscription",
  );
});

Deno.test("lophn-agent/harness/provider#R27: 과금 근거가 없으면 모름이다", () => {
  // credential이 없거나 인증 없음(loopback)이면 모름이다(R27).
  assertEquals(billingRouteOf(null), "unknown");
  assertEquals(
    billingRouteOf(credential({ kind: "none", secret_ref: null })),
    "unknown",
  );
});

// ── R21, R22, R24: 실패 분류가 credential 상태로 옮겨지는 규칙 ───────────

const verdictAt = (status: number, headers: Record<string, string> = {}) =>
  failureVerdict({ kind: "http", status, headers, nowMs: NOW });

Deno.test("lophn-agent/harness/provider#R21: 인증 거절은 rejected, 사용량 429는 reset 또는 1시간 usage_wait이고 revoked는 만들지 않는다", () => {
  const current = credential();
  const auth = availabilityFromVerdict(
    verdictAt(401),
    current,
    { modelName: MODEL, nowMs: NOW },
    at,
  );
  assertEquals(auth?.state, "rejected");
  assertEquals(auth?.unavailable_reason, "authentication");
  assertEquals(auth?.until, null);
  const unknownReset = availabilityFromVerdict(
    verdictAt(429),
    current,
    { modelName: MODEL, nowMs: NOW },
    at,
  );
  assertEquals(unknownReset?.state, "usage_wait");
  assertEquals(unknownReset?.until, at(NOW + 3_600_000));
  const known = availabilityFromVerdict(
    verdictAt(429, { "retry-after": "120" }),
    current,
    { modelName: MODEL, nowMs: NOW },
    at,
  );
  assertEquals(known?.until, at(NOW + 120_000));
  const plan = availabilityFromVerdict(
    failureVerdict({
      kind: "http",
      status: 403,
      headers: {},
      code: "plan_access",
      nowMs: NOW,
    }),
    current,
    { modelName: MODEL, nowMs: NOW },
    at,
  );
  assertEquals(plan?.unavailable_reason, "plan_access");
  assert(
    [auth, unknownReset, known, plan].every((change) =>
      change?.state !== "revoked"
    ),
  );
});

Deno.test("lophn-agent/harness/provider#R22: model 사용 불가는 그 model block만 더하고 credential 상태는 그대로다", () => {
  const waiting = credential({
    state: "usage_wait",
    unavailable_reason: "quota",
    until: at(NOW + 1000),
  });
  const change = availabilityFromVerdict(
    failureVerdict({
      kind: "http",
      status: 404,
      headers: {},
      code: "model_not_found",
      nowMs: NOW,
    }),
    waiting,
    { modelName: MODEL, nowMs: NOW },
    at,
  );
  assertEquals(change?.state, "usage_wait");
  assertEquals(change?.until, waiting.until);
  assertEquals(change?.model_block, {
    model_name: MODEL,
    reason: "not_found",
    until: null,
  });
});

Deno.test("lophn-agent/harness/provider#R19: 일시·문맥 초과·원인 불명은 credential 상태를 바꾸지 않는다", () => {
  const current = credential();
  for (const status of [503, 418]) {
    assertEquals(
      availabilityFromVerdict(
        verdictAt(status),
        current,
        { modelName: MODEL, nowMs: NOW },
        at,
      ),
      null,
    );
  }
});
