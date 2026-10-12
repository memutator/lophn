import { assert, assertEquals } from "@std/assert";
import { routePath } from "../platform/mod.ts";
import {
  disconnectProviderInputSchema,
  loginBeginInputSchema,
  providerDisconnectedPayloadSchema,
  recordProviderAvailabilityInputSchema,
  refreshProviderCredentialInputSchema,
  registerProviderInputSchema,
} from "./provider-inputs.ts";
import {
  disconnectProvider,
  PROVIDER_EVENTS,
  PROVIDER_ROUTES,
  registerProvider,
} from "./providers.ts";
import {
  providerCredentialSchema,
  providerRecordSchema,
} from "./provider-values.ts";
import { resolvedModelSchema } from "./resolved-model.ts";
import {
  ATTEMPT_KINDS,
  callModelSchema,
  MODEL_PURPOSES,
} from "./model-call-values.ts";

// 사람 결정(2026-10-12): provider에는 credential이 하나다. 계정 목록·순서·끄기·중복 판정·연결 test와
// 내장 로컬 provider는 없다. Connect는 credential까지 받는 RegisterProvider 하나다.

const suffix = "01arz3ndektsv4rrffq69g5fav";
const provider = `pvd_${suffix}`;
const at = "2026-10-05T00:00:00.000Z";
const preparation = {
  preparation: "prepared-handle",
  sealed_ref: "sealed-handle",
  purpose: "provider_credential" as const,
  owner: provider,
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
const connect = {
  id: provider,
  name: "OpenAI",
  definition,
  endpoint: "https://api.openai.com/v1",
  protocol: "openai-responses" as const,
  credential: { kind: "api_key" as const, preparation },
};
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
const record = {
  id: provider,
  name: "OpenAI",
  definition,
  endpoint: "https://api.openai.com/v1",
  protocol: "openai-responses" as const,
  credential,
  revision: 1,
};

Deno.test("lophn-agent/harness/provider#R8: routes keep Connect and Disconnect and drop account change, per-credential register, the check and the test", () => {
  assertEquals(PROVIDER_ROUTES.map(routePath), [
    "/v1/providers/register",
    "/v1/providers/disconnect",
    "/v1/providers/read",
    "/v1/providers/list",
    "/v1/providers/definitions",
    "/v1/providers/login-begin",
    "/v1/providers/login-complete",
    "/v1/providers/login-cancel",
    "/v1/provider-credentials/refresh-result",
    "/v1/provider-credentials/record-availability",
  ]);
  assertEquals(
    PROVIDER_EVENTS.map((event) => event.type),
    ["ProviderRegistered", "ProviderChanged", "ProviderDisconnected"],
  );
});

Deno.test("lophn-agent/harness/provider#R6: Disconnect is a person's decision behind the protected confirmation and carries the provider revision", () => {
  assertEquals(disconnectProvider.name, "DisconnectProvider");
  assertEquals([...disconnectProvider.actors], ["user"]);
  assertEquals(disconnectProvider.confirmation, "required");
  assertEquals(disconnectProvider.confirmation_kind, "secret_input");
  assert(disconnectProvider.binding?.includes("provider"));
  assert(disconnectProviderInputSchema.safeParse({ provider }).success);
  assert(
    !disconnectProviderInputSchema.safeParse({ provider, credential: "x" })
      .success,
  );
  assert(
    !disconnectProviderInputSchema.safeParse({ provider: `run_${suffix}` })
      .success,
  );
  assert(
    providerDisconnectedPayloadSchema.safeParse({
      definition_key: "openai",
    }).success,
  );
});

Deno.test("lophn-agent/harness/provider#R6: Connect is a user command and the person's own protected input is the proof, so it has no confirmation window", () => {
  assertEquals([...registerProvider.actors], ["user"]);
  assertEquals(registerProvider.confirmation, undefined);
});

Deno.test("lophn-agent/harness/provider#R8: Connect carries the one credential and its secret preparation", () => {
  assert(registerProviderInputSchema.safeParse(connect).success);
  const { credential: _, ...withoutCredential } = connect;
  assert(!registerProviderInputSchema.safeParse(withoutCredential).success);
  // key 종류인데 secret 증거가 없으면 받지 않는다.
  assert(
    !registerProviderInputSchema.safeParse({
      ...connect,
      credential: { kind: "api_key", preparation: null },
    }).success,
  );
  // 다른 provider나 다른 목적의 증거는 받지 않는다.
  assert(
    !registerProviderInputSchema.safeParse({
      ...connect,
      credential: {
        kind: "api_key",
        preparation: { ...preparation, owner: `pvd_${"b".repeat(26)}` },
      },
    }).success,
  );
  assert(
    !registerProviderInputSchema.safeParse({
      ...connect,
      credential: {
        kind: "api_key",
        preparation: { ...preparation, purpose: "app_secret" },
      },
    }).success,
  );
  // 정의가 지원하지 않는 인증 방식은 받지 않는다.
  assert(
    !registerProviderInputSchema.safeParse({
      ...connect,
      credential: { kind: "oauth", preparation },
    }).success,
  );
  // 계정을 가리키는 옛 field는 없다.
  assert(
    !registerProviderInputSchema.safeParse({
      ...connect,
      credential: { kind: "api_key", preparation, key: "personal" },
    }).success,
  );
});

Deno.test("lophn-agent/harness/provider#R5: no auth is only a custom provider's loopback address and a remote one needs a credential", () => {
  const local = {
    ...connect,
    definition: {
      ...definition,
      key: "my-local",
      auth_kinds: ["none" as const],
      models_endpoint: null,
    },
    endpoint: "http://127.0.0.1:11434/v1",
    credential: { kind: "none" as const, preparation: null },
  };
  assert(registerProviderInputSchema.safeParse(local).success);
  // 인증 없음에는 secret 증거가 없다.
  assert(
    !registerProviderInputSchema.safeParse({
      ...local,
      credential: { kind: "none", preparation },
    }).success,
  );
  // 원격과 LAN은 인증 없음으로 받지 않는다.
  assert(
    !registerProviderInputSchema.safeParse({
      ...local,
      endpoint: "https://models.example.com/v1",
    }).success,
  );
  assert(
    !registerProviderInputSchema.safeParse({
      ...local,
      endpoint: "http://10.0.0.8:11434/v1",
    }).success,
  );
});

Deno.test("lophn-agent/harness/provider#R8: a provider record has one credential and no account list, enabled switch or last check", () => {
  const parsed = providerRecordSchema.safeParse(record);
  assert(parsed.success);
  const keys = Object.keys(parsed.data);
  for (const gone of ["credentials", "enabled", "last_check"]) {
    assert(!keys.includes(gone), gone);
  }
  assertEquals(
    Object.keys(parsed.data.credential).sort(),
    Object.keys(credential).sort(),
  );
  // credential 없는 provider는 기록이 아니다.
  const { credential: _, ...withoutCredential } = record;
  assert(!providerRecordSchema.safeParse(withoutCredential).success);
  // 원격 provider의 credential은 인증 없음일 수 없다.
  assert(
    !providerRecordSchema.safeParse({
      ...record,
      credential: { ...credential, kind: "none", secret_ref: null },
    }).success,
  );
});

Deno.test("lophn-agent/harness/provider#R8: a credential has no label, order, enabled, account, organization, plan or dedup fingerprint", () => {
  assert(providerCredentialSchema.safeParse(credential).success);
  for (
    const [field, value] of [
      ["key", "personal"],
      ["label", "personal"],
      ["order", 0],
      ["enabled", true],
      ["account", "a@example.com"],
      ["organization", "org"],
      ["plan", "plus"],
      ["dedup_fingerprint", "ab".repeat(32)],
    ] as const
  ) {
    assert(
      !providerCredentialSchema.safeParse({ ...credential, [field]: value })
        .success,
      field,
    );
  }
});

Deno.test("lophn-agent/harness/provider#R17: refresh and availability name the provider's one credential, not an account key", () => {
  const wait = {
    provider,
    state: "usage_wait" as const,
    unavailable_reason: "quota" as const,
    until: at,
    model_block: null,
  };
  assert(recordProviderAvailabilityInputSchema.safeParse(wait).success);
  assert(
    !recordProviderAvailabilityInputSchema.safeParse({ ...wait, key: "main" })
      .success,
  );
  const refresh = {
    provider,
    preparation,
    expires_at: at,
    unavailable_reason: null,
  };
  assert(refreshProviderCredentialInputSchema.safeParse(refresh).success);
  assert(
    !refreshProviderCredentialInputSchema.safeParse({ ...refresh, key: "main" })
      .success,
  );
});

Deno.test("lophn-agent/harness/provider#R12: login begin names the provider to create and its built-in definition, since no provider exists before Connect", () => {
  assert(
    loginBeginInputSchema.safeParse({ provider, definition: "openai" }).success,
  );
  assert(!loginBeginInputSchema.safeParse({ provider }).success);
});

Deno.test("lophn-agent/harness/model#R9: a resolved model fixes the provider's credential revision, null only for no auth", () => {
  const model = {
    purpose: "judgment" as const,
    credential_revision: 3,
    provider,
    model_name: "model",
    verification: "unverified" as const,
    sent_model_name: "model",
    option_values: {},
    request_patch: {},
    request_headers: {},
    context_limit: 32768,
    input_limit: 16000,
    output_limit: 8192,
    supports_tools: true,
    input_media: ["text"],
    output_media: ["text"],
    price_basis: null,
    basis: {},
  };
  assert(resolvedModelSchema.safeParse(model).success);
  assert(
    resolvedModelSchema.safeParse({ ...model, credential_revision: null })
      .success,
  );
  const { credential_revision: _, ...withoutRevision } = model;
  assert(!resolvedModelSchema.safeParse(withoutRevision).success);
  assert(
    !resolvedModelSchema.safeParse({ ...model, credentials: ["primary"] })
      .success,
  );
});

Deno.test("lophn-agent/harness/usage#R1: a call records the credential revision only, with no credential key, connection test purpose or credential-change attempt", () => {
  const call = {
    provider,
    name: "gpt",
    protocol: "openai-responses" as const,
    credential_revision: 1,
    option_values: { requested: {}, applied: {} },
    limits: {
      context_limit: 128000,
      input_limit: 120000,
      output_limit: 8000,
      supports_tools: true,
    },
    catalog_basis: {},
    price_basis: null,
    billing_route: "api" as const,
  };
  assert(callModelSchema.safeParse(call).success);
  assert(
    callModelSchema.safeParse({ ...call, credential_revision: null }).success,
  );
  assert(
    !callModelSchema.safeParse({ ...call, credential_key: "personal" })
      .success,
  );
  assert(!(MODEL_PURPOSES as readonly string[]).includes("connection_test"));
  assertEquals([...ATTEMPT_KINDS], ["initial", "retry"]);
});
