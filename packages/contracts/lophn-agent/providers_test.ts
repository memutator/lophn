import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath } from "../platform/mod.ts";
import {
  changeProviderCredentialsInputSchema,
  connectionTestInputSchema,
  loginBeginOutputSchema,
  loginCompleteInputSchema,
  recordProviderAvailabilityInputSchema,
  refreshProviderCredentialInputSchema,
  registerProviderCredentialInputSchema,
  registerProviderInputSchema,
} from "./provider-inputs.ts";
import { PROVIDER_EVENTS, PROVIDER_ROUTES } from "./providers.ts";
import {
  ANTHROPIC_CACHE_TTL_MS,
  CONNECTION_TEST_TIMEOUT_MS,
  OAUTH_PRODUCTS,
  oauthDefinitionSchema,
  providerCredentialSchema,
  providerRecordSchema,
} from "./provider-values.ts";

const suffix = "01arz3ndektsv4rrffq69g5fav";
const provider = `pvd_${suffix}`;
const hash = "ab".repeat(32);
const at = "2026-10-05T00:00:00.000Z";
const preparation = {
  preparation: "prepared-handle",
  sealed_ref: "sealed-handle",
  purpose: "provider_credential" as const,
  owner: "provider",
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
const credential = {
  key: "personal",
  kind: "api_key" as const,
  label: "personal",
  secret_ref: { name: "provider.openai", sealed_ref: "sealed", revision: 1 },
  revision: 1,
  order: 0,
  enabled: true,
  account: null,
  organization: null,
  plan: null,
  dedup_fingerprint: hash,
  state: "available" as const,
  unavailable_reason: null,
  until: null,
  expires_at: null,
  logged_in_at: null,
  refreshed_at: null,
  model_blocks: [],
};

Deno.test("lophn-agent/harness/provider#R2: provider routes and the three provider events", () => {
  assertEquals(PROVIDER_ROUTES.map(routePath), [
    "/v1/providers/register",
    "/v1/providers/change",
    "/v1/providers/record-check",
    "/v1/providers/read",
    "/v1/providers/list",
    "/v1/providers/definitions",
    "/v1/providers/login-begin",
    "/v1/providers/login-complete",
    "/v1/providers/login-cancel",
    "/v1/providers/test",
    "/v1/provider-credentials/register",
    "/v1/provider-credentials/change",
    "/v1/provider-credentials/refresh-result",
    "/v1/provider-credentials/record-availability",
    "/v1/provider-credentials/list",
  ]);
  assertEquals(
    PROVIDER_EVENTS.map((event) => event.type),
    ["ProviderRegistered", "ProviderChanged", "ProviderChecked"],
  );
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
    auth_kinds: ["none" as const],
    models_endpoint: null,
  };
  const input = {
    id: provider,
    name: "Ollama",
    definition: local,
    endpoint: "http://127.0.0.1:11434",
    protocol: "openai-responses",
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
  assert(providerCredentialSchema.safeParse(credential).success);
  assert(
    !providerCredentialSchema.safeParse({ ...credential, api_key: "sk-live" })
      .success,
  );
  const registration = {
    provider,
    key: "personal",
    kind: "api_key" as const,
    label: "personal",
    preparation,
    account: null,
    organization: null,
    plan: null,
    dedup_fingerprint: hash,
  };
  assert(registerProviderCredentialInputSchema.safeParse(registration).success);
  assert(
    !registerProviderCredentialInputSchema.safeParse({
      ...registration,
      preparation: { ...preparation, purpose: "app_secret" },
    }).success,
  );
});

Deno.test("lophn-agent/harness/provider#R9: duplicate credential fingerprints are not a provider record", () => {
  const record = {
    id: provider,
    name: "OpenAI",
    definition,
    endpoint: "https://api.openai.com/v1",
    protocol: "openai-responses" as const,
    enabled: true,
    credentials: [credential, { ...credential, key: "work", order: 1 }],
    last_check: null,
    revision: 1,
  };
  assert(!providerRecordSchema.safeParse(record).success);
  assert(
    providerRecordSchema.safeParse({
      ...record,
      credentials: [credential, {
        ...credential,
        key: "work",
        order: 1,
        dedup_fingerprint: "cd".repeat(32),
      }],
    }).success,
  );
});

Deno.test("lophn-agent/harness/provider#R19: availability separates quota wait from revoked auth", () => {
  const wait = {
    provider,
    key: "personal",
    state: "usage_wait" as const,
    unavailable_reason: "quota" as const,
    until: at,
    model_block: null,
  };
  assert(recordProviderAvailabilityInputSchema.safeParse(wait).success);
  assert(
    !recordProviderAvailabilityInputSchema.safeParse({ ...wait, until: null })
      .success,
  );
});

Deno.test("lophn-agent/harness/provider#R17: refresh stores a new reference or a safe failure", () => {
  assert(
    refreshProviderCredentialInputSchema.safeParse({
      provider,
      key: "personal",
      preparation,
      expires_at: at,
      unavailable_reason: null,
    }).success,
  );
  assert(
    !refreshProviderCredentialInputSchema.safeParse({
      provider,
      key: "personal",
      preparation,
      expires_at: at,
      unavailable_reason: "refresh_revoked",
      access_token: "raw",
    }).success,
  );
});

Deno.test("lophn-agent/harness/provider#R30: an explicit connection test has a 30 second bound", () => {
  assertEquals(CONNECTION_TEST_TIMEOUT_MS, 30_000);
  assertEquals(ANTHROPIC_CACHE_TTL_MS, 300_000);
  const test = {
    provider,
    credential_key: "personal",
    model_name: "gpt",
    test_kind: "text" as const,
    command_key: "test-1",
  };
  assert(connectionTestInputSchema.safeParse(test).success);
  assert(
    !connectionTestInputSchema.safeParse({ ...test, provider: `run_${suffix}` })
      .success,
  );
});

Deno.test("lophn-agent/harness/provider#R11: login completion is a protected submission, not a stored code", () => {
  const login = { provider, login: "login-handle", submission: "pasted" };
  assert(loginCompleteInputSchema.safeParse(login).success);
  assert(
    !loginCompleteInputSchema.safeParse({ ...login, code: "oauth-code" })
      .success,
  );
  assert(
    changeProviderCredentialsInputSchema.safeParse({
      provider,
      credentials: [{
        key: "personal",
        revision: 1,
        replacement: null,
        order: 0,
        revoke: true,
      }],
    }).success,
  );
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
