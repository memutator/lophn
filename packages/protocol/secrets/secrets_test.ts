import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { commandRequestSchema } from "../server/envelope.ts";
import { eventEnvelopeSchema } from "../events/events.ts";
import { routePath } from "../server/route.ts";
import { EVENTS, ROUTES } from "../server/registry.ts";
import {
  listSecretsInputSchema,
  listSecretsOutputSchema,
  removeSecret,
  removeSecretInputSchema,
  SECRET_EVENTS,
  SECRET_EXCHANGE_FORMAT,
  SECRET_INPUT_MAX_BYTES,
  SECRET_PURPOSES,
  SECRET_ROUTES,
  secretAdapterContextSchema,
  secretCleanupInputSchema,
  secretCleanupResultSchema,
  secretDestinationSchema,
  secretInput,
  secretPreparationSchema,
  secretPrepareInputSchema,
  secretSendInputSchema,
  secretSendOutputSchema,
  secretSet,
  secretStatusSchema,
  secretStoreRefreshInputSchema,
  secretStoreRefreshOutputSchema,
  setSecret,
  setSecretCompareSchema,
  setSecretInputSchema,
} from "./secrets.ts";
import { SECRET_PIPE_OPS } from "./exchange.ts";

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
const request = {
  input: { name: "service.key", preparation },
  idempotency_key: "set-a",
  compare: { sealed_ref: null, revision: null },
  prepared: ["prepared-a"],
  confirmation: "a".repeat(43),
};

Deno.test("platform/secrets#R4, platform/secrets#R6, platform/secrets#R7: route와 event 이름은 architecture 표와 같다", () => {
  assertEquals(SECRET_ROUTES.map((route) => [route.kind, routePath(route)]), [
    ["read", "/v1/secrets/list"],
    ["command", "/v1/secrets/set"],
    ["command", "/v1/secrets/remove"],
    ["read", "/v1/secrets/cleanup"],
    ["upload", "/v1/secrets/input"],
  ]);
  assertEquals([setSecret.name, removeSecret.name], [
    "SetSecret",
    "RemoveSecret",
  ]);
  assertEquals(SECRET_EVENTS.map((event) => event.type), [
    "SecretSet",
    "SecretRemoved",
  ]);
  assertEquals(SECRET_PIPE_OPS.map((op) => op.name), [
    "secret.prepare",
    "secret.send",
    "secret.store-refresh",
    "secret.export",
    "secret.import",
  ]);
  for (const event of SECRET_EVENTS) {
    assert(event.subject.safeParse("secret:service.key").success);
    assert(!event.subject.safeParse("app:service.key").success);
    assert(!event.subject.safeParse(null).success);
  }
  for (const route of SECRET_ROUTES) assert(ROUTES.includes(route));
  for (const event of SECRET_EVENTS) assert(EVENTS.includes(event));
  for (const op of SECRET_PIPE_OPS) {
    assertEquals(op.kind, "worker");
    assertEquals(op.actors, ["machine"]);
    assert(!SECRET_ROUTES.some((route) => route.name === op.name));
    assert(!ROUTES.some((route) => routePath(route) === routePath(op)));
  }
  for (const route of [...SECRET_ROUTES, ...SECRET_PIPE_OPS]) {
    for (const code of route.errors) assert(ERROR_CODES.includes(code));
  }
});

Deno.test("platform/secrets#R1, platform/secrets#R3, platform/secrets#R4: 일반 결과와 event에는 이름·설정 여부만 있고 값·참조가 없다", () => {
  const status = { name: "service.key", configured: true, revision: 1 };
  const leaked = {
    ...status,
    value: "example",
    sealed_ref: "sealed-a",
    length: 7,
  };
  assertEquals(secretStatusSchema.parse(leaked), status);
  assert(!secretStatusSchema.safeParse({ ...status, revision: null }).success);
  assert(!secretStatusSchema.safeParse({ ...status, revision: 0 }).success);
  assert(!secretStatusSchema.safeParse({ ...status, revision: "1" }).success);
  assertEquals(
    listSecretsOutputSchema.parse({
      secrets: [leaked],
      as_of_seq: "1",
      next_cursor: null,
    }).secrets,
    [status],
  );
  for (const event of SECRET_EVENTS) {
    assertEquals(event.payload.parse(leaked), {
      name: status.name,
    });
  }
  assert(
    eventEnvelopeSchema(secretSet).safeParse({
      seq: "1",
      type: "SecretSet",
      subject: "secret:service.key",
      actor: "user",
      run: null,
      payload: { name: "service.key" },
      at: "2026-10-04T00:00:00.000Z",
    }).success,
  );
  assert(!listSecretsInputSchema.safeParse({ names: [""] }).success);
  assert(
    !listSecretsInputSchema.safeParse({ names: ["service.key"], value: "x" })
      .success,
  );
});

Deno.test("platform/secrets#R2, platform/secrets#R6: 사람 command는 보호 handle과 참조 CAS만 받는다", () => {
  for (const route of [setSecret, removeSecret]) {
    assertEquals(route.actors, ["user"]);
    assertEquals(route.confirmation, "required");
    assertEquals(route.confirmation_kind, "secret_input");
    assertEquals(route.display_read, "/v1/secrets/list");
    assert(route.binding?.includes("name"));
  }
  assert(commandRequestSchema(setSecret).safeParse(request).success);
  const { confirmation: _confirmation, ...withoutHandle } = request;
  assert(!commandRequestSchema(setSecret).safeParse(withoutHandle).success);
  assert(
    !commandRequestSchema(setSecret).safeParse({ ...request, compare: {} })
      .success,
  );
  assert(
    commandRequestSchema(removeSecret).safeParse({
      ...request,
      input: { name: "service.key" },
      compare: { sealed_ref: "sealed-a", revision: 1 },
    }).success,
  );
  assert(
    !commandRequestSchema(removeSecret).safeParse({
      ...request,
      input: { name: "service.key" },
    }).success,
  );
  assertEquals(secretPreparationSchema.parse(preparation), preparation);
  assert(setSecretInputSchema.safeParse(request.input).success);
  for (
    const invalid of [
      { ...request.input, value: "x" },
      { ...request.input, preparation: { ...preparation, value: "x" } },
      { ...request.input, preparation: { ...preparation, owner: "other" } },
      {
        ...request.input,
        preparation: { ...preparation, purpose: "provider_credential" },
      },
      { ...request.input, preparation: { ...preparation, sealed_ref: "" } },
    ]
  ) assert(!setSecretInputSchema.safeParse(invalid).success);
  assert(
    !removeSecretInputSchema.safeParse({ name: "service.key", value: "x" })
      .success,
  );
  for (
    const compare of [
      { sealed_ref: null, revision: 1 },
      { sealed_ref: "sealed-a", revision: null },
      { sealed_ref: "sealed-a", revision: -1 },
      { sealed_ref: "sealed-a", revision: "1" },
      { sealed_ref: "sealed-a", revision: 1, value: "x" },
    ]
  ) assert(!setSecretCompareSchema.safeParse(compare).success);
});

Deno.test("platform/secrets#R7, platform/secrets#R8: 차단·OS 삭제·프로세스 종료는 독립된 안전한 사실이다", () => {
  const pending = {
    reference_blocked: true,
    os_deleted: false,
    processes_ended: false,
  };
  assertEquals(secretCleanupResultSchema.parse(pending), pending);
  assertEquals(
    secretCleanupResultSchema.parse({ ...pending, os_deleted: true }),
    {
      ...pending,
      os_deleted: true,
    },
  );
  assert(
    secretCleanupInputSchema.safeParse({ name: "service.key", revision: 1 })
      .success,
  );
  assert(
    !secretCleanupInputSchema.safeParse({ name: "service.key", revision: 0 })
      .success,
  );
  assert(
    !secretCleanupInputSchema.safeParse({
      name: "service.key",
      revision: 1,
      sealed_ref: "sealed-a",
    }).success,
  );
  for (const route of SECRET_PIPE_OPS) {
    assert(route.errors.includes("unavailable"));
  }
});

Deno.test("platform/secrets#R5, platform/secrets#R11: 전송은 machine process/task·고정 목적지·현재 참조를 받는다", () => {
  const input = {
    context,
    use,
    operation: "model.call",
    body: { prompt: "safe" },
  };
  assert(secretSendInputSchema.safeParse(input).success);
  assertEquals(secretSendOutputSchema.parse({ sent: true, value: "x" }), {
    sent: true,
  });
  for (
    const invalid of [
      { ...input, value: "x" },
      { ...input, use: { ...use, revision: 0 } },
      {
        ...input,
        context: { ...context, actor: "agent:asg_01arz3ndektsv4rrffq69g5fav" },
      },
      {
        ...input,
        context: { ...context, conditions: { process: "process-a" } },
      },
      {
        ...input,
        context: {
          ...context,
          conditions: {
            ...context.conditions,
            run: "app_01arz3ndektsv4rrffq69g5fav",
          },
        },
      },
    ]
  ) assert(!secretSendInputSchema.safeParse(invalid).success);
  assert(
    secretAdapterContextSchema.safeParse({
      ...context,
      conditions: {
        ...context.conditions,
        run: "run_01arz3ndektsv4rrffq69g5fav",
      },
    }).success,
  );
  for (
    const origin of [
      "http://provider.example",
      "https://provider.example/path",
      "https://user:password@provider.example",
      "https://provider.example/",
    ]
  ) {
    assert(
      !secretDestinationSchema.safeParse({ kind: "https", origin }).success,
    );
  }
  assert(
    secretDestinationSchema.safeParse({
      kind: "mcp",
      server_connection: "server-a",
      transport: "https",
    }).success,
  );
  assert(
    !secretDestinationSchema.safeParse({
      kind: "mcp",
      server_connection: "server-a",
      transport: "stdio",
    }).success,
  );
});

Deno.test("platform/secrets#R11: 갱신 결과 저장은 소유 key와 이전 CAS를 받고 안전 새 참조만 반환한다", () => {
  const input = { context, owner: "provider-a", ...use };
  assert(secretStoreRefreshInputSchema.safeParse(input).success);
  assert(
    secretStoreRefreshInputSchema.safeParse({
      ...input,
      purpose: "external_mcp_credential",
    }).success,
  );
  for (
    const invalid of [
      { ...input, purpose: "app_secret" },
      { ...input, purpose: "coding_connection_credential" },
      { ...input, value: "x" },
      { ...input, owner: "" },
      { ...input, revision: "1" },
    ]
  ) assert(!secretStoreRefreshInputSchema.safeParse(invalid).success);
  assertEquals(
    secretStoreRefreshOutputSchema.parse({
      sealed_ref: "sealed-b",
      revision: 2,
      configured: true,
      value: "x",
    }),
    { sealed_ref: "sealed-b", revision: 2, configured: true },
  );
});

Deno.test("platform/secrets#R12: coding connection 준비는 별도 용도이며 일반 전송과 refresh에 쓰이지 않는다", () => {
  assertEquals(SECRET_PURPOSES.length, 4);
  for (const purpose of SECRET_PURPOSES) {
    assert(
      secretPrepareInputSchema.safeParse({ context, purpose, owner: "owner-a" })
        .success,
    );
  }
  assert(
    !secretPrepareInputSchema.safeParse({
      context,
      purpose: "token",
      owner: "owner-a",
    }).success,
  );
  assert(
    !secretPrepareInputSchema.safeParse({
      context,
      purpose: "app_secret",
      owner: "owner-a",
      value: "x",
    }).success,
  );
  assert(
    !secretSendInputSchema.safeParse({
      context,
      use: { ...use, purpose: "coding_connection_credential" },
      operation: "send",
      body: null,
    }).success,
  );
});

Deno.test("platform/secrets#R9: 머신 이전 암호 format과 parameter는 고정이다", () => {
  assertEquals(SECRET_EXCHANGE_FORMAT, {
    format: 1,
    kdf: "Argon2id",
    memory_bytes: 67_108_864,
    iterations: 3,
    parallelism: 1,
    salt_bytes: 16,
    cipher: "AES-256-GCM",
    nonce_bytes: 12,
  });
});

Deno.test("platform/secrets#R2: 보호 입력 route는 사람만 쓰는 upload이고 입력에 값이 없다", () => {
  assertEquals([secretInput.kind, routePath(secretInput)], [
    "upload",
    "/v1/secrets/input",
  ]);
  assertEquals(secretInput.actors, ["user"]);
  assertEquals(secretInput.max_bytes, SECRET_INPUT_MAX_BYTES);
  const input = { purpose: "app_secret", owner: "service.key", bytes: 12 };
  assert(secretInput.input.safeParse(input).success);
  // 값·길이 밖의 field와 상한을 넘는 크기, 빈 값은 받지 않는다.
  assert(!secretInput.input.safeParse({ ...input, value: "x" }).success);
  assert(!secretInput.input.safeParse({ ...input, bytes: 0 }).success);
  assert(
    !secretInput.input.safeParse({
      ...input,
      bytes: SECRET_INPUT_MAX_BYTES + 1,
    }).success,
  );
  assert(!secretInput.input.safeParse({ ...input, purpose: "other" }).success);
  // 출력은 값 없는 준비 증거다.
  assert(
    secretInput.output.safeParse({
      preparation: "prep-1",
      sealed_ref: "sealed-1",
      purpose: "app_secret",
      owner: "service.key",
    }).success,
  );
});
