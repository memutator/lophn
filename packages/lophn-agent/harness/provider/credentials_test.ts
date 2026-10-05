// lophn-agent/harness/provider#R10, R27 credential 선택·과금 테스트. 순수 함수만
// 본다. 실제 provider를 부르지 않는다.
import { assert, assertEquals } from "@std/assert";
import {
  availabilityFromVerdict,
  billingRouteOf,
  credentialUsable,
  nextCredential,
  type RunAffinity,
  type SelectionEntry,
} from "./credentials.ts";
import type { ProviderCredential } from "../../../contracts/lophn-agent/mod.ts";
import { failureVerdict } from "./failures.ts";
const NOW = Date.UTC(2026, 0, 1);
const MODEL = "gpt";

const at = (ms: number) => new Date(ms).toISOString();

// 등록된 credential 기본 꼴. state·until·model_blocks는 테스트가 바꿔 쓴다.
function credential(
  key: string,
  over: Partial<ProviderCredential> = {},
): ProviderCredential {
  return {
    key,
    kind: "api_key",
    label: `label-${key}`,
    secret_ref: {
      name: "provider.openai",
      sealed_ref: `seal-${key}`,
      revision: 1,
    },
    revision: 1,
    order: 0,
    enabled: true,
    account: "acct-1",
    organization: "org-1",
    plan: "plus",
    dedup_fingerprint: `fingerprint-${key}`.padEnd(64, "0").slice(0, 64),
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

// 선택 판. preset 목록의 표기 순서 그대로다(R10).
function list(
  ...credentials: (ProviderCredential | null)[]
): SelectionEntry[] {
  return credentials.map((credential, index) => ({
    key: credential?.key ?? `key-${index}`,
    credential,
  }));
}

const facts = {
  credentials: list(
    credential("key-a"),
    credential("key-b"),
    credential("key-c"),
  ),
  modelName: MODEL,
  nowMs: NOW,
};

const noAffinity: RunAffinity = { key: null };

// ── R10: 첫 usable affinity와 고정 목록 이동 ────────────────────────────

Deno.test("lophn-agent/harness/provider#R10: affinity가 없으면 목록의 첫 usable credential이다", () => {
  assertEquals(nextCredential(facts, noAffinity, null), {
    key: "key-a",
    stop: false,
  });
});

Deno.test("lophn-agent/harness/provider#R10: affinity 계정이 usable이면 유지한다", () => {
  const held = nextCredential(
    facts,
    { key: "key-b" },
    { kind: "failed", code: "temporary" },
  );
  assertEquals(held, { key: "key-b", stop: false });
});

Deno.test("lophn-agent/harness/provider#R10: 거절·사용량 대기·model 불가 뒤 고정 목록의 뒤 계정만 허용한다", () => {
  // key-a가 막혔을 때 뒤 계정 key-b만 본다.
  const blanked = {
    ...facts,
    credentials: list(
      credential("key-a", {
        state: "rejected",
        unavailable_reason: "authentication",
      }),
      credential("key-b"),
      credential("key-c"),
    ),
  };
  assertEquals(
    nextCredential(blanked, { key: "key-a" }, {
      kind: "failed",
      code: "credential_unavailable",
    }),
    { key: "key-b", stop: false },
  );
});

Deno.test("lophn-agent/harness/provider#R10: 목록이 하나이거나 뒤 계정이 모두 불가면 멈춘다", () => {
  // 하나뿐인 목록이다.
  const single = {
    ...facts,
    credentials: list(
      credential("key-a", {
        state: "rejected",
        unavailable_reason: "authentication",
      }),
    ),
  };
  assertEquals(
    nextCredential(single, { key: "key-a" }, {
      kind: "failed",
      code: "credential_unavailable",
    }),
    { key: null, stop: true },
  );
  // 뒤 계정이 모두 막혔다.
  const blocked = {
    ...facts,
    credentials: list(
      credential("key-a", {
        state: "rejected",
        unavailable_reason: "authentication",
      }),
      credential("key-b", { enabled: false }),
      credential("key-c", {
        state: "revoked",
        unavailable_reason: "refresh_revoked",
      }),
    ),
  };
  assertEquals(
    nextCredential(blocked, { key: "key-a" }, {
      kind: "failed",
      code: "credential_unavailable",
    }),
    { key: null, stop: true },
  );
});

Deno.test("lophn-agent/harness/provider#R10: 앞 계정 회복에 돌아가지 않는다", () => {
  // key-a rejected 뒤 key-b로 이동했고, key-a가 available로 회복해도 affinity는
  // 유지된다. 이동은 뒤 계정만 본다.
  const recovered = {
    ...facts,
    credentials: list(credential("key-a"), credential("key-b")),
  };
  const held = nextCredential(
    recovered,
    { key: "key-b" },
    { kind: "failed", code: "temporary" },
  );
  assertEquals(held, { key: "key-b", stop: false });
});

Deno.test("lophn-agent/harness/provider#R10: 다른 provider·model·목록 밖 계정으로 자동 이동하지 않는다", () => {
  // 목록 밖 등록 계정은 후보가 아니다.
  const outside = nextCredential(
    {
      ...facts,
      credentials: list(
        credential("key-a", {
          state: "rejected",
          unavailable_reason: "authentication",
        }),
      ),
    },
    { key: "key-a" },
    { kind: "failed", code: "credential_unavailable" },
  );
  assertEquals(outside, { key: null, stop: true });
});

Deno.test("lophn-agent/harness/provider#R10: usage_wait는 until 도달까지 막고 도달하면 풀린다", () => {
  const waiting = {
    ...facts,
    credentials: list(
      credential("key-a", {
        state: "usage_wait",
        unavailable_reason: "quota",
        until: at(NOW + 60_000),
      }),
    ),
  };
  // until 전이다. 유일한 계정도 후보가 아니다(R24).
  assertEquals(
    credentialUsable(waiting.credentials[0].credential, waiting),
    false,
  );
  assertEquals(nextCredential(waiting, noAffinity, null), {
    key: null,
    stop: true,
  });
  // until 도달 뒤다. until 경계를 지나면 usable이다.
  const passed = credentialUsable(
    waiting.credentials[0].credential,
    { modelName: MODEL, nowMs: NOW + 61_000 },
  );
  assertEquals(passed, true);
});

Deno.test("lophn-agent/harness/provider#R10: model 전용 대기는 그 model에만 적용된다", () => {
  const pair = {
    ...facts,
    credentials: list(
      credential("key-a", {
        model_blocks: [{
          model_name: MODEL,
          reason: "not_found",
          until: at(NOW + 60_000),
        }],
      }),
    ),
    nowMs: NOW,
  };
  // 이 model은 막혔다(R22).
  assertEquals(credentialUsable(pair.credentials[0].credential, pair), false);
  // 다른 model은 막히지 않았다. 같은 credential의 다른 model 사용 가능 상태는
  // 바뀌지 않는다(R22).
  assertEquals(
    credentialUsable(pair.credentials[0].credential, {
      ...pair,
      modelName: "other-model",
    }),
    true,
  );
});

Deno.test("lophn-agent/harness/provider#R10: revoked·disabled 계정은 후보가 아니다", () => {
  assertEquals(
    credentialUsable(
      credential("key-a", {
        state: "revoked",
        unavailable_reason: "refresh_revoked",
      }),
      facts,
    ),
    false,
  );
  assertEquals(
    credentialUsable(credential("key-a", { enabled: false }), facts),
    false,
  );
});

// ── R27: 과금 경로 구별 ─────────────────────────────────────────────────

Deno.test("lophn-agent/harness/provider#R27: API key는 API 과금이다", () => {
  assertEquals(billingRouteOf(credential("key-a", { kind: "api_key" })), "api");
});

Deno.test("lophn-agent/harness/provider#R27: ChatGPT·SuperGrok OAuth는 구독이다", () => {
  // ChatGPT·SuperGrok OAuth credential은 모두 구독 과금 경로다(R27).
  assertEquals(
    billingRouteOf(
      credential("key-a", {
        kind: "oauth",
        account: "swiggle",
        plan: "chatgpt",
      }),
    ),
    "subscription",
  );
  assertEquals(
    billingRouteOf(
      credential("key-a", {
        kind: "oauth",
        account: "grok",
        plan: "supergrok",
      }),
    ),
    "subscription",
  );
});

Deno.test("lophn-agent/harness/provider#R27: 과금 근거가 없으면 모름이다", () => {
  // credential이 없거나 인증 없음(loopback)이면 모름이다(R27).
  assertEquals(billingRouteOf(null), "unknown");
  assertEquals(
    billingRouteOf(credential("key-a", { kind: "none", secret_ref: null })),
    "unknown",
  );
});

// ── R21, R22, R24: 실패 분류가 credential 상태로 옮겨지는 규칙 ───────────

const verdictAt = (status: number, headers: Record<string, string> = {}) =>
  failureVerdict({ kind: "http", status, headers, nowMs: NOW });

Deno.test("lophn-agent/harness/provider#R21: 인증 거절은 rejected, 사용량 429는 reset 또는 1시간 usage_wait이고 revoked는 만들지 않는다", () => {
  const current = credential("key-a");
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
  const waiting = credential("key-a", {
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
  const current = credential("key-a");
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
