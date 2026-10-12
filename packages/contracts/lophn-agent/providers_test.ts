import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import {
  loginBeginOutputSchema,
  loginCompleteInputSchema,
  loginCompleteOutputSchema,
  registerProviderInputSchema,
} from "./provider-inputs.ts";
import { PROVIDER_ROUTES } from "./providers.ts";
import {
  ANTHROPIC_CACHE_TTL_MS,
  OAUTH_PRODUCTS,
  oauthDefinitionSchema,
  providerCredentialSchema,
} from "./provider-values.ts";

// 한 provider에 credential 하나, Connect·Disconnect, 계정·점검 route 없음은 provider-connection_test.ts가 본다.

const suffix = "01arz3ndektsv4rrffq69g5fav";
const provider = `pvd_${suffix}`;
const at = "2026-10-05T00:00:00.000Z";
const preparation = {
  preparation: "prepared-handle",
  sealed_ref: "sealed-handle",
  purpose: "provider_credential" as const,
  owner: provider,
};
const chatgpt = {
  product: "chatgpt" as const,
  flow: "device_code_then_pkce_paste_url" as const,
  issuer: "https://auth.openai.com",
  authorization_endpoint: "https://auth.openai.com/authorize",
  token_endpoint: "https://auth.openai.com/token",
  allowed_call_origins: ["https://chatgpt.com"],
  scopes: ["openid"],
  verified_for_lophn: false,
};
const definition = {
  key: "openai",
  display_name: "OpenAI",
  protocols: ["openai-responses" as const],
  auth_kinds: ["api_key" as const],
  models_endpoint: "https://api.openai.com/v1/models",
  oauth: null,
  revision: "2026-10",
};

Deno.test("lophn-agent/harness/provider#R2: every provider route names only common error codes", () => {
  for (const route of PROVIDER_ROUTES) {
    assert(route.errors.every((code) => ERROR_CODES.includes(code)));
  }
});

Deno.test("lophn-agent/harness/provider#R1: oauth products are ChatGPT and SuperGrok only", () => {
  assertEquals([...OAUTH_PRODUCTS], ["chatgpt", "supergrok"]);
  assert(oauthDefinitionSchema.safeParse(chatgpt).success);
  assert(
    !oauthDefinitionSchema.safeParse({ ...chatgpt, product: "claude" }).success,
  );
  assert(
    oauthDefinitionSchema.safeParse({
      ...chatgpt,
      product: "supergrok",
      flow: "device_code",
    }).success,
  );
});

Deno.test("lophn-agent/harness/provider#R3: a provider names one of the three protocols", () => {
  const input = {
    id: provider,
    name: "OpenAI",
    definition,
    endpoint: "https://api.openai.com/v1",
    protocol: "openai-responses",
    credential: { kind: "api_key", preparation },
  };
  assert(registerProviderInputSchema.safeParse(input).success);
  assert(
    !registerProviderInputSchema.safeParse({
      ...input,
      protocol: "google-native",
    })
      .success,
  );
  assert(
    !registerProviderInputSchema.safeParse({ ...input, extra: 1 }).success,
  );
  assert(
    !registerProviderInputSchema.safeParse({ ...input, id: `run_${suffix}` })
      .success,
  );
});

Deno.test("lophn-agent/harness/provider#R5: http and no auth stay on loopback", () => {
  const local = {
    ...definition,
    key: "my-local",
    auth_kinds: ["none" as const],
    models_endpoint: null,
  };
  const input = {
    id: provider,
    name: "My local",
    definition: local,
    endpoint: "http://127.0.0.1:11434",
    protocol: "openai-responses",
    credential: { kind: "none", preparation: null },
  };
  assert(registerProviderInputSchema.safeParse(input).success);
  assert(
    !registerProviderInputSchema.safeParse({
      ...input,
      endpoint: "http://10.0.0.8:11434",
    }).success,
  );
});

Deno.test("lophn-agent/harness/provider#R7: a credential keeps a secret reference, never the value", () => {
  const credential = {
    kind: "api_key" as const,
    secret_ref: { name: "provider.openai", sealed_ref: "sealed", revision: 1 },
    revision: 1,
    state: "available" as const,
    unavailable_reason: null,
    until: null,
    expires_at: null,
    logged_in_at: null,
    refreshed_at: null,
    model_blocks: [],
  };
  assert(providerCredentialSchema.safeParse(credential).success);
  assert(
    !providerCredentialSchema.safeParse({ ...credential, api_key: "sk-live" })
      .success,
  );
  const input = {
    id: provider,
    name: "OpenAI",
    definition,
    endpoint: "https://api.openai.com/v1",
    protocol: "openai-responses",
    credential: { kind: "api_key", preparation },
  };
  assert(
    !registerProviderInputSchema.safeParse({
      ...input,
      credential: {
        kind: "api_key",
        preparation: { ...preparation, purpose: "app_secret" },
      },
    }).success,
  );
});

Deno.test("lophn-agent/harness/provider#R26: the Anthropic cache lasts five minutes", () => {
  assertEquals(ANTHROPIC_CACHE_TTL_MS, 300_000);
});

Deno.test("lophn-agent/harness/provider#R11: login completion is a protected submission, not a stored code", () => {
  const login = { provider, login: "login-handle", submission: "pasted" };
  assert(loginCompleteInputSchema.safeParse(login).success);
  assert(
    !loginCompleteInputSchema.safeParse({ ...login, code: "oauth-code" })
      .success,
  );
  assert(loginCompleteOutputSchema.safeParse({ completed: true }).success);
});

Deno.test("lophn-agent/harness/provider#R12: login begin may carry the official sign-in address and a device code, and still parses without them", () => {
  const begin = {
    login: "login-handle",
    flow: "device_code" as const,
    interval_ms: 5000,
    expires_at: at,
  };
  assert(loginBeginOutputSchema.safeParse(begin).success);
  assert(
    loginBeginOutputSchema.safeParse({
      ...begin,
      sign_in: { url: "https://auth.x.ai/device", user_code: "ABCD-1234" },
    }).success,
  );
  assert(
    !loginBeginOutputSchema.safeParse({ ...begin, sign_in: { url: 1 } })
      .success,
  );
});
