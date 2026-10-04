import { assert, assertEquals } from "@std/assert";
import { ok } from "../../../packages/base/mod.ts";
import type { SecretPreparation } from "../../../packages/contracts/platform/mod.ts";
import { createKnownSecretRegistry } from "../../../packages/platform/redaction/mod.ts";
import {
  createFakeKeychain,
  createLinuxSecretServiceAdapter,
  createSecretWork,
  type PreparationStore,
  randomSealedRef,
  secretToolRunner,
} from "../../../packages/platform/secrets/mod.ts";
import { createSecretPipe } from "./secrets.ts";

function store(): PreparationStore {
  return {
    record: () => Promise.resolve(ok(undefined)),
    orphans: () => Promise.resolve(ok([])),
  };
}

const input = {
  context: {
    principal: "machine-1",
    actor: "machine" as const,
    scope: { operations: ["secret.prepare"], targets: {} },
    conditions: { process: "io", task: "secrets" },
    credential_ref: "cred",
  },
  purpose: "app_secret" as const,
  owner: "service.key",
};

Deno.test("platform/secrets#R2: 보호 입력은 secret.prepare callback으로만 받고 다른 경로는 거절한다", async () => {
  const keychain = createFakeKeychain();
  const registry = createKnownSecretRegistry();
  const pipe = createSecretPipe({
    work: createSecretWork({
      keychain,
      preparations: store(),
      registry,
      processes: { ended: () => Promise.resolve(false) },
      preparationId: () => "prep-1",
    }),
  });
  const value = "protected-input-value";
  const prepared = await pipe.handle(
    { request_id: "r1", op: "secret.prepare", payload: input },
    () => Promise.resolve(value),
  );
  assert(prepared.ok);
  const body = JSON.stringify(prepared);
  assert(!body.includes(value));
  assertEquals(registry.count, 1);
  const loaded = await keychain.load(
    (prepared.payload as SecretPreparation).sealed_ref,
  );
  assert(loaded.ok);
  assertEquals(new TextDecoder().decode(loaded.value), value);

  const foreign = await pipe.handle(
    { request_id: "r2", op: "session.message", payload: { text: value } },
    () => Promise.resolve(value),
  );
  assert(!foreign.ok);
  assertEquals(foreign.error.code, "forbidden");

  const empty = await pipe.handle(
    { request_id: "r3", op: "secret.prepare", payload: input },
    () => Promise.resolve(undefined),
  );
  assert(!empty.ok);
  assertEquals(empty.error.code, "invalid_input");
});

Deno.test("platform/secrets#R8: 실제 Linux Secret Service가 없으면 secret 기능만 unavailable이다", async () => {
  const adapter = createLinuxSecretServiceAdapter({
    runner: secretToolRunner(),
    randomRef: randomSealedRef,
  });
  if (await adapter.status() === "unavailable") {
    const stored = await adapter.store({
      name: "service.key",
      purpose: "app_secret",
      owner: "service.key",
      value: new TextEncoder().encode("value"),
    });
    assert(!stored.ok);
    assertEquals(stored.error.code, "unavailable");
    return;
  }
  // Secret Service가 있으면 값을 stdin으로 넣고 지운 뒤 부재를 확인한다.
  const value = crypto.getRandomValues(new Uint8Array(24));
  const stored = await adapter.store({
    name: "lophn-test",
    purpose: "app_secret",
    owner: "lophn-test",
    value,
  });
  assert(stored.ok);
  const loaded = await adapter.load(stored.value);
  assert(loaded.ok);
  assertEquals(loaded.value, value);
  const removed = await adapter.remove(stored.value);
  assert(removed.ok);
  const gone = await adapter.load(stored.value);
  assert(!gone.ok);
});
