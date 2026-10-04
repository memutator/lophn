import { assert, assertEquals } from "@std/assert";
import { ok } from "../../base/mod.ts";
import {
  childMessageSchema,
  coreToMainMessageSchema,
  mainToCoreMessageSchema,
  parentMessageSchema,
  workerRequestSchema,
  workerResponseSchema,
} from "./supervision.ts";
import {
  SECRET_PREPARE_OP,
  SECRET_ROUTES,
  SECRET_SEND_OP,
  SECRET_STORE_REFRESH_OP,
  secretComparisonRequestSchema,
  secretComparisonResponseSchema,
  secretPrepare,
  type SecretPrepareValueCallback,
  secretSend,
  type SecretSendValueCallback,
  secretStoreRefresh,
  type SecretStoreRefreshValueCallback,
} from "./secrets.ts";

const preparation = {
  preparation: "prepared-a",
  sealed_ref: "sealed-a",
  purpose: "app_secret",
  owner: "service.key",
} as const;
const context = {
  principal: "provider-adapter",
  actor: "machine",
  scope: { operations: ["secret.send"], targets: {} },
  conditions: { process: "process-a", task: "task-a" },
  credential_ref: "credential-a",
};
const use = {
  sealed_ref: "sealed-a",
  revision: 1,
  purpose: "provider_credential",
  destination: { kind: "https", origin: "https://provider.example" },
};

Deno.test("platform/secrets#R1, platform/secrets#R5, platform/secrets#R11: 원값은 pipe payload가 아니라 callback 메모리 인자에만 있다", async () => {
  const prepareRequest = workerRequestSchema(secretPrepare.input).parse({
    type: "worker_request",
    request_id: "prepare-1",
    op: SECRET_PREPARE_OP,
    payload: { context, purpose: "app_secret", owner: "service.key" },
  });
  const prepareResponse = workerResponseSchema(secretPrepare.output).parse({
    type: "worker_response",
    request_id: prepareRequest.request_id,
    ok: true,
    payload: preparation,
  });
  assertEquals(prepareResponse.ok && prepareResponse.payload, preparation);
  const sendPayload = {
    context,
    use,
    operation: "model.call",
    body: { prompt: "safe" },
  };
  const sendRequest = workerRequestSchema(secretSend.input).parse({
    type: "worker_request",
    request_id: "send-1",
    op: SECRET_SEND_OP,
    payload: sendPayload,
  });
  assert(
    workerResponseSchema(secretSend.output).safeParse({
      type: "worker_response",
      request_id: sendRequest.request_id,
      ok: true,
      payload: { sent: true },
    }).success,
  );
  const refreshPayload = { context, owner: "provider-a", ...use };
  const refreshRequest = workerRequestSchema(secretStoreRefresh.input).parse({
    type: "worker_request",
    request_id: "refresh-1",
    op: SECRET_STORE_REFRESH_OP,
    payload: refreshPayload,
  });
  const refreshResponse = workerResponseSchema(secretStoreRefresh.output).parse(
    {
      type: "worker_response",
      request_id: refreshRequest.request_id,
      ok: true,
      payload: {
        sealed_ref: "sealed-b",
        revision: 2,
        configured: true,
        value: "x",
      },
    },
  );
  assert(refreshResponse.ok);
  assertEquals(refreshResponse.payload, {
    sealed_ref: "sealed-b",
    revision: 2,
    configured: true,
  });
  assert(
    !workerRequestSchema(secretPrepare.input).safeParse({
      ...prepareRequest,
      payload: { ...prepareRequest.payload, value: "x" },
    }).success,
  );
  assert(
    !workerRequestSchema(secretSend.input).safeParse({
      ...sendRequest,
      payload: { ...sendPayload, value: new Uint8Array([1]) },
    }).success,
  );
  assert(
    !workerRequestSchema(secretStoreRefresh.input).safeParse({
      ...refreshRequest,
      payload: { ...refreshPayload, value: "x" },
    }).success,
  );
  const prepare: SecretPrepareValueCallback = (_value) =>
    Promise.resolve(ok(preparation));
  const send: SecretSendValueCallback = (_value) =>
    Promise.resolve(ok({ sent: true }));
  const refresh: SecretStoreRefreshValueCallback = (_value) =>
    Promise.resolve(ok({
      sealed_ref: "sealed-b",
      revision: 2,
      configured: true,
    }));
  for (const value of ["synthetic-value", new Uint8Array([1, 2, 3])]) {
    assert((await prepare(value)).ok);
    assert((await send(value)).ok);
    assert((await refresh(value)).ok);
  }
});

Deno.test("platform/secrets#R4, platform/secrets#R6: 비교 read는 main↔core만 받고 parent·child와 HTTP에는 없다", () => {
  const request = {
    type: "secret_comparison_request",
    request_id: "compare-1",
    name: "service.key",
    expected_revision: 1,
  };
  const response = {
    type: "secret_comparison_response",
    request_id: "compare-1",
    name: "service.key",
    ok: true,
    compare: { sealed_ref: "sealed-a", revision: 1 },
  };
  const absent = {
    type: "secret_comparison_request",
    request_id: "compare-0",
    name: "service.key",
    expected_revision: null,
  } as const;
  const absentResponse = {
    type: "secret_comparison_response",
    request_id: "compare-0",
    name: "service.key",
    ok: true,
    compare: { sealed_ref: null, revision: null },
  } as const;
  const failure = {
    type: "secret_comparison_response",
    request_id: "compare-1",
    name: "service.key",
    ok: false,
    error: { code: "conflict", message: "revision changed" },
  } as const;
  assert(secretComparisonRequestSchema.safeParse(request).success);
  assert(mainToCoreMessageSchema.safeParse(request).success);
  assert(!parentMessageSchema.safeParse(request).success);
  assert(!childMessageSchema.safeParse(request).success);
  assert(!coreToMainMessageSchema.safeParse(request).success);
  assert(secretComparisonResponseSchema.safeParse(response).success);
  assert(coreToMainMessageSchema.safeParse(response).success);
  assert(!parentMessageSchema.safeParse(response).success);
  assert(!childMessageSchema.safeParse(response).success);
  assert(!mainToCoreMessageSchema.safeParse(response).success);
  assertEquals(secretComparisonRequestSchema.parse(absent), absent);
  assertEquals(
    secretComparisonResponseSchema.parse(absentResponse),
    absentResponse,
  );
  assertEquals(secretComparisonResponseSchema.parse(failure), failure);
  for (
    const invalid of [
      { ...request, value: "x" },
      { ...request, sealed_ref: "sealed-a" },
      { ...request, expected_revision: "1" },
      { ...response, value: "x" },
      { ...failure, error: { code: "nope", message: "revision changed" } },
    ]
  ) {
    assert(!secretComparisonRequestSchema.safeParse(invalid).success);
    assert(!secretComparisonResponseSchema.safeParse(invalid).success);
    assert(!mainToCoreMessageSchema.safeParse(invalid).success);
    assert(!coreToMainMessageSchema.safeParse(invalid).success);
  }
  assert(
    !SECRET_ROUTES.some((route) =>
      route.method === "compare" || route.name.includes("Comparison")
    ),
  );
});
