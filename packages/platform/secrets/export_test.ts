import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../base/mod.ts";
import {
  SECRET_EXCHANGE_FORMAT,
  type SecretPreparation,
} from "../../protocol/platform/mod.ts";
import { createKnownSecretRegistry } from "../redaction/mod.ts";
import { createFakeKeychain } from "./adapters/fake-keychain.ts";
import { openExchange, sealExchange } from "./exchange.ts";
import { createSecretTransfer } from "./export.ts";
import type { SecretRecord } from "./model.ts";
import { createSecretWork, type PreparationStore } from "./work.ts";

const PASSPHRASE = "correct horse battery";
const VALUE = "machine-move-secret-value";

function context() {
  return {
    principal: "machine-1",
    actor: "machine" as const,
    scope: { operations: ["secret.prepare"], targets: {} },
    conditions: { process: "io", task: "secrets" },
    credential_ref: "cred",
  };
}

function preparations(): PreparationStore & { rows: SecretPreparation[] } {
  const rows: SecretPreparation[] = [];
  return {
    rows,
    record: (preparation) => {
      rows.push(preparation);
      return Promise.resolve(ok(undefined));
    },
    orphans: () => Promise.resolve(ok([])),
  };
}

Deno.test("platform/secrets#R9: format 1 metadata를 인증하고 salt 16·nonce 12로 봉인한다", async () => {
  const draws = [
    crypto.getRandomValues(new Uint8Array(SECRET_EXCHANGE_FORMAT.salt_bytes)),
    crypto.getRandomValues(new Uint8Array(SECRET_EXCHANGE_FORMAT.nonce_bytes)),
  ];
  let draw = 0;
  const sealed = await sealExchange({
    items: [{
      name: "service.key",
      purpose: "app_secret",
      owner: "service.key",
      value: new TextEncoder().encode(VALUE),
    }],
    passphrase: PASSPHRASE,
    random: () => draws[draw++]!,
  });
  assert(sealed.ok);
  const bytes = sealed.value.bytes;
  assertEquals(bytes[0], SECRET_EXCHANGE_FORMAT.format);
  assertEquals(
    bytes.slice(1, 1 + SECRET_EXCHANGE_FORMAT.salt_bytes),
    draws[0],
  );
  assertEquals(
    bytes.slice(
      1 + SECRET_EXCHANGE_FORMAT.salt_bytes,
      1 + SECRET_EXCHANGE_FORMAT.salt_bytes +
        SECRET_EXCHANGE_FORMAT.nonce_bytes,
    ),
    draws[1],
  );
  assertEquals(SECRET_EXCHANGE_FORMAT.kdf, "Argon2id");
  assertEquals(SECRET_EXCHANGE_FORMAT.memory_bytes, 64 * 1024 * 1024);
  assertEquals(SECRET_EXCHANGE_FORMAT.iterations, 3);
  assertEquals(SECRET_EXCHANGE_FORMAT.parallelism, 1);
  assertEquals(SECRET_EXCHANGE_FORMAT.cipher, "AES-256-GCM");

  const opened = await openExchange({
    file: sealed.value,
    passphrase: PASSPHRASE,
  });
  assert(opened.ok);
  assertEquals(new TextDecoder().decode(opened.value[0]!.value), VALUE);

  // metadata(format byte)를 고치면 암호가 맞아도 전체가 거절된다.
  const tampered = bytes.slice();
  tampered[0] = 2;
  const rejected = await openExchange({
    file: { bytes: tampered },
    passphrase: PASSPHRASE,
  });
  assert(!rejected.ok);
  assertEquals(rejected.error.code, "invalid_input");
});

Deno.test("platform/secrets#R9: 수정과 틀린 암호는 전체를 거절하고 평문은 파일에 없다", async () => {
  const sealed = await sealExchange({
    items: [{
      name: "service.key",
      purpose: "app_secret",
      owner: "service.key",
      value: new TextEncoder().encode(VALUE),
    }],
    passphrase: PASSPHRASE,
  });
  assert(sealed.ok);
  const text = new TextDecoder().decode(sealed.value.bytes);
  assert(!text.includes(VALUE));
  assert(!text.includes("service.key"));

  const wrong = await openExchange({
    file: sealed.value,
    passphrase: "wrong passphrase",
  });
  assert(!wrong.ok);
  assertEquals(wrong.error.code, "invalid_input");
  assert(!wrong.error.message.includes(VALUE));

  const body = sealed.value.bytes.slice();
  body[body.length - 1] ^= 0xff;
  const edited = await openExchange({
    file: { bytes: body },
    passphrase: PASSPHRASE,
  });
  assert(!edited.ok);
  assertEquals(edited.error.code, "invalid_input");
});

Deno.test("platform/secrets#R9: import 실패는 기존 참조를 유지하고 평문 중간 파일을 만들지 않는다", async () => {
  const source = createFakeKeychain();
  const stored = await source.store({
    name: "service.key",
    purpose: "app_secret",
    owner: "service.key",
    value: new TextEncoder().encode(VALUE),
  });
  assert(stored.ok);
  const record: SecretRecord = {
    name: "service.key",
    sealedRef: stored.value,
    revision: 3,
  };
  const before = await Deno.readDir(Deno.cwd());
  const names = new Set<string>();
  for await (const entry of before) names.add(entry.name);

  const registry = createKnownSecretRegistry();
  const exported = await createSecretTransfer({
    keychain: source,
    registry,
    prepare: () => Promise.resolve(ok({} as SecretPreparation)),
    context: context(),
  }).exportSelected({
    selection: {
      records: [{ ...record, purpose: "app_secret", owner: "service.key" }],
    },
    passphrase: PASSPHRASE,
  });
  assert(exported.ok);
  assert(!new TextDecoder().decode(exported.value.bytes).includes(VALUE));

  const after = await Deno.readDir(Deno.cwd());
  const created: string[] = [];
  for await (const entry of after) {
    if (!names.has(entry.name)) created.push(entry.name);
  }
  assertEquals(created, []);

  let serial = 0;
  const target = createFakeKeychain({
    random: () => serial++ === 0 ? "existing-ref" : `imported-${serial}`,
  });
  const previous = await target.store({
    name: "service.key",
    purpose: "app_secret",
    owner: "service.key",
    value: new TextEncoder().encode("previous-value"),
  });
  assert(previous.ok);
  const kept: SecretRecord = {
    name: "service.key",
    sealedRef: previous.value,
    revision: 7,
  };
  const evidence = preparations();
  const work = createSecretWork({
    keychain: target,
    preparations: evidence,
    registry,
    processes: { ended: () => Promise.resolve(false) },
    preparationId: () => "prep-import",
  });
  const transfer = createSecretTransfer({
    keychain: target,
    registry,
    prepare: (input, value) => work.prepare(input, value),
    context: context(),
  });

  const locked = await (async () => {
    target.setStatus("unavailable");
    return await transfer.importSelected({
      file: exported.value,
      passphrase: PASSPHRASE,
      current: () => kept,
    });
  })();
  assert(!locked.ok);
  assertEquals(locked.error.code, "unavailable");
  assertEquals([...target.stored.keys()], [kept.sealedRef]);
  assertEquals(evidence.rows.length, 0);

  target.setStatus("available");
  const wrong = await transfer.importSelected({
    file: exported.value,
    passphrase: "not the passphrase",
    current: () => kept,
  });
  assert(!wrong.ok);
  assertEquals(evidence.rows.length, 0);
  assertEquals([...target.stored.keys()], [kept.sealedRef]);

  const restored = await transfer.importSelected({
    file: exported.value,
    passphrase: PASSPHRASE,
    current: () => kept,
  });
  assert(restored.ok);
  assertEquals(restored.value.length, 1);
  assertEquals(restored.value[0]!.current, {
    sealed_ref: kept.sealedRef,
    revision: kept.revision,
  });
  assertEquals(evidence.rows.length, 1);
  const loaded = await target.load(restored.value[0]!.preparation.sealed_ref);
  assert(loaded.ok);
  assertEquals(new TextDecoder().decode(loaded.value), VALUE);
  // CAS를 제출하기 전의 기존 참조는 이 경계가 바꾸지 않는다.
  assertEquals(restored.value[0]!.current?.sealed_ref, "existing-ref");
  const still = await target.load(kept.sealedRef);
  assert(still.ok);
  assertEquals(new TextDecoder().decode(still.value), "previous-value");
});

Deno.test("platform/secrets#R9: 준비 도중 실패하면 새 참조를 제출하지 않고 기존 값을 남긴다", async () => {
  const target = createFakeKeychain();
  const previous = await target.store({
    name: "first.key",
    purpose: "app_secret",
    owner: "first.key",
    value: new TextEncoder().encode("kept-value"),
  });
  assert(previous.ok);
  const sealed = await sealExchange({
    items: [
      {
        name: "first.key",
        purpose: "app_secret",
        owner: "first.key",
        value: new TextEncoder().encode("new-a"),
      },
      {
        name: "second.key",
        purpose: "app_secret",
        owner: "second.key",
        value: new TextEncoder().encode("new-b"),
      },
    ],
    passphrase: PASSPHRASE,
  });
  assert(sealed.ok);
  let calls = 0;
  const transfer = createSecretTransfer({
    keychain: target,
    registry: createKnownSecretRegistry(),
    prepare: (_input, value) => {
      calls += 1;
      if (calls > 1) {
        return Promise.resolve(err({
          code: "unavailable",
          message: "OS keychain을 사용할 수 없다",
        }));
      }
      return target.store({
        name: "first.key",
        purpose: "app_secret",
        owner: "first.key",
        value,
      }).then((stored) =>
        stored.ok
          ? ok({
            preparation: "prep-partial",
            sealed_ref: stored.value,
            purpose: "app_secret" as const,
            owner: "first.key",
          })
          : stored
      );
    },
    context: context(),
  });
  const imported = await transfer.importSelected({
    file: sealed.value,
    passphrase: PASSPHRASE,
    current: (name) =>
      name === "first.key"
        ? { name, sealedRef: previous.value, revision: 1 }
        : undefined,
  });
  assert(!imported.ok);
  assertEquals(imported.error.code, "unavailable");
  const kept = await target.load(previous.value);
  assert(kept.ok);
  assertEquals(new TextDecoder().decode(kept.value), "kept-value");
  assertEquals([...target.stored.keys()], [previous.value]);
});
