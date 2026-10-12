import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import { providerRead } from "../../packages/contracts/lophn-agent/mod.ts";
import { routePath } from "../../packages/contracts/platform/mod.ts";
import { CATALOG_OPTIONS } from "../../packages/contracts/lophn-agent/testing/mod.ts";
import { createModelResolver } from "./resolve-model.ts";

// lophn-agent/harness/provider#R4, R8, R28: provider에는 credential이 하나다. 연결이 없거나(Disconnect 포함)
// 그 credential을 쓸 수 없으면 run은 시작하지 않고, 쓸 수 있으면 그 credential의 판을 고정한다.
// 다른 credential·provider로 넘어가지 않는다. core 호출과 전송은 fake다.

const OPENAI = "pvd_01arz3ndektsv4rrffq69g5fav";
const NOW = Date.UTC(2026, 9, 12);

type Credential = {
  kind: "none" | "api_key" | "oauth";
  secret_ref: { name: string; sealed_ref: string; revision: number } | null;
  revision: number;
  state: "available" | "rejected" | "usage_wait" | "revoked";
  unavailable_reason: string | null;
  until: string | null;
  expires_at: null;
  logged_in_at: null;
  refreshed_at: null;
  model_blocks: { model_name: string; reason: string; until: null }[];
};

function credential(patch: Partial<Credential> = {}): Credential {
  return {
    kind: "none",
    secret_ref: null,
    revision: 4,
    state: "available",
    unavailable_reason: null,
    until: null,
    expires_at: null,
    logged_in_at: null,
    refreshed_at: null,
    model_blocks: [],
    ...patch,
  };
}

function recordOf(current: Credential) {
  return {
    id: OPENAI,
    name: "OpenAI local",
    definition: {
      key: "openai",
      display_name: "OpenAI",
      protocols: ["openai-responses", "openai-chat-completions"],
      auth_kinds: ["none", "api_key"],
      models_endpoint: null,
      oauth: null,
      revision: "1",
    },
    endpoint: "http://127.0.0.1:9/v1",
    protocol: "openai-responses",
    credential: current,
    revision: 7,
  };
}

function resolverOf(read: () => Credential | null) {
  const machine = (path: string): Promise<Result<unknown>> => {
    if (path !== routePath(providerRead)) {
      return Promise.resolve(err({ code: "not_found", message: path }));
    }
    const current = read();
    return Promise.resolve(
      current === null
        ? err({ code: "not_found", message: "provider not found" })
        : ok({
          provider: recordOf(current),
          as_of_seq: "3",
          next_cursor: null,
        }),
    );
  };
  return createModelResolver({
    machine,
    catalog: () => Promise.resolve(ok(CATALOG_OPTIONS)),
    nowMs: () => NOW,
  });
}

const CHOICE = {
  provider: OPENAI,
  model_name: "gpt-4-1",
  option_values: {},
};

Deno.test("lophn-agent/harness/provider#R28: an agent that chose a disconnected provider does not start", async () => {
  const resolved = await resolverOf(() => null)({ model: CHOICE });
  assert(!resolved.ok);
  assertEquals(resolved.error.code, "unavailable");
});

Deno.test("lophn-agent/harness/model#R9: the call fixes the provider's credential revision and records no credential key", async () => {
  const resolved = await resolverOf(() => credential())({ model: CHOICE });
  assert(resolved.ok, JSON.stringify(resolved));
  const call = resolved.value.call as unknown as Record<string, unknown>;
  // 무인증 loopback은 판이 없다.
  assertEquals(call["credential_revision"], null);
  assert(!("credential_key" in call));
  assertEquals(call["billing_route"], "unknown");
});

Deno.test("lophn-agent/harness/provider#R4: a rejected, waiting or revoked credential stops the call and nothing moves to another credential", async () => {
  const later = new Date(NOW + 3_600_000).toISOString();
  for (
    const patch of [
      { state: "rejected", unavailable_reason: "authentication" },
      { state: "usage_wait", unavailable_reason: "quota", until: later },
      { state: "revoked", unavailable_reason: "refresh_revoked" },
    ] as const
  ) {
    const resolved = await resolverOf(() => credential(patch))({
      model: CHOICE,
    });
    assert(!resolved.ok, patch.state);
    assertEquals(resolved.error.code, "unavailable", patch.state);
  }
  // 사용량 대기가 끝난 시각 이후에는 다시 쓸 수 있다.
  const over = new Date(NOW - 1000).toISOString();
  const waited = await resolverOf(() =>
    credential({
      state: "usage_wait",
      unavailable_reason: "quota",
      until: over,
    })
  )({ model: CHOICE });
  assert(waited.ok);
});

Deno.test("lophn-agent/harness/provider#R22: a model block stops that model only", async () => {
  const blocked = credential({
    model_blocks: [{ model_name: "gpt-4-1", reason: "not_found", until: null }],
  });
  const stopped = await resolverOf(() => blocked)({ model: CHOICE });
  assert(!stopped.ok);
  assertEquals(stopped.error.code, "unavailable");
  const other = await resolverOf(() => blocked)({
    model: { ...CHOICE, model_name: "gpt-5-5" },
  });
  assert(other.ok, JSON.stringify(other));
});

Deno.test("lophn-agent/harness/provider#R4: just before sending, a disconnected provider or a replaced credential is not sent", async () => {
  let current: Credential | null = credential({
    kind: "api_key",
    secret_ref: { name: "provider.openai", sealed_ref: "seal", revision: 1 },
  });
  const resolver = createModelResolver({
    machine: (path) =>
      Promise.resolve(
        path === routePath(providerRead)
          ? current === null
            ? err({ code: "not_found", message: "provider not found" })
            : ok({
              provider: recordOf(current),
              as_of_seq: "3",
              next_cursor: null,
            })
          : err({ code: "not_found", message: path }),
      ),
    attach: {
      send: () => Promise.resolve(ok({ sent: false })),
    },
    catalog: () => Promise.resolve(ok(CATALOG_OPTIONS)),
    nowMs: () => NOW,
  });
  const resolved = await resolver({ model: CHOICE });
  assert(resolved.ok, JSON.stringify(resolved));
  assertEquals(resolved.value.call.credential_revision, 4);
  assertEquals(resolved.value.call.billing_route, "api");
  assertEquals(await resolved.value.available(), true);
  // 같은 ID로 다시 Connect해 secret 판이 바뀌었다.
  current = credential({
    kind: "api_key",
    secret_ref: { name: "provider.openai", sealed_ref: "seal2", revision: 2 },
  });
  assertEquals(await resolved.value.available(), false);
  current = null;
  assertEquals(await resolved.value.available(), false);
});
