// platform/secrets#R1, platform/redaction#R1: core의 secret store가 다른 concern의 참조 source를
// 같은 keychain·같은 등록·회수 통로로 맞추고, core 프로세스의 안전화(메시지 본문)가 같은
// matcher를 쓴다. keychain은 fake다(사람의 실제 keychain에 닿지 않는다). ledger는 temp dir다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../packages/base/mod.ts";
import type { KnownSecretChannel } from "../../packages/platform/ledger/mod.ts";
import {
  createFakeKeychain,
  type FakeKeychain,
  SECRET_SCHEMA_STEPS,
  type SecretRefSource,
} from "../../packages/platform/secrets/mod.ts";
import { receiveMessage } from "../../packages/contracts/lophn-agent/mod.ts";
import { openSecretStore, withSecretSync } from "./secret-store.ts";
import { createMessageBodyPreparer } from "./message-body.ts";

const OWNER_VALUE = "owner-credential-value-31337";
const OTHER_VALUE = "another-credential-value-9";

type Calls = { registered: string[]; revoked: string[]; ready: boolean[] };

function channel(calls: Calls): KnownSecretChannel {
  return {
    register(values) {
      calls.registered.push(...values);
      return Promise.resolve(ok(undefined));
    },
    revoke(values) {
      calls.revoked.push(...values);
      return Promise.resolve(ok(undefined));
    },
    setReady(ready) {
      calls.ready.push(ready);
      return Promise.resolve(ok(undefined));
    },
  };
}

function ledger(): { path: string; home: string } {
  const home = Deno.makeTempDirSync({ prefix: "lophn-secret-sources-" });
  const path = `${home}/lophn.db`;
  const db = new DatabaseSync(path);
  for (const step of SECRET_SCHEMA_STEPS) db.exec(step.sql);
  db.close();
  return { path, home };
}

async function put(keychain: FakeKeychain, value: string): Promise<string> {
  const stored = await keychain.store({
    name: "x",
    purpose: "provider_credential",
    owner: "x",
    value: new TextEncoder().encode(value),
  });
  assert(stored.ok);
  return stored.value;
}

Deno.test("platform/secrets#R1 platform/redaction#R1: 다른 concern의 참조 source도 등록·회수되고 같은 값을 쥔 다른 참조는 남는다", async () => {
  const { path, home } = ledger();
  try {
    const keychain = createFakeKeychain();
    const first = await put(keychain, OWNER_VALUE);
    const second = await put(keychain, OTHER_VALUE);
    // owner의 ledger 표는 이 concern 밖이라 시험은 가변 목록으로 대신한다.
    let refs = [{ name: "pvd_a", sealedRef: first }];
    const source: SecretRefSource = {
      owner: "lophn-agent/harness/provider",
      commands: ["RegisterProvider"],
      read: () => ok([...refs]),
    };
    const calls: Calls = { registered: [], revoked: [], ready: [] };
    const store = openSecretStore({
      ledgerPath: path,
      channel: channel(calls),
      keychain: () => keychain,
      sources: [source],
    });
    assert((await store.sync()).ok);
    assertEquals(calls.registered, [OWNER_VALUE]);
    assert(store.known.ready);
    assertEquals(
      store.known.match(`앞 ${OWNER_VALUE} 뒤`)?.length,
      OWNER_VALUE.length,
    );

    // 교체: 새 값이 알려지고 옛 값이 회수된다.
    refs = [{ name: "pvd_a", sealedRef: second }];
    assert((await store.sync()).ok);
    assertEquals(calls.registered, [OWNER_VALUE, OTHER_VALUE]);
    assertEquals(calls.revoked, [OWNER_VALUE]);
    assertEquals(store.known.match(OWNER_VALUE), undefined);
    assert(store.known.match(OTHER_VALUE) !== undefined);

    // 같은 값을 쥔 다른 이름이 있으면 하나가 사라져도 값은 남는다.
    const spare = await put(keychain, OTHER_VALUE);
    refs = [
      { name: "pvd_a", sealedRef: second },
      { name: "pvd_b", sealedRef: spare },
    ];
    assert((await store.sync()).ok);
    refs = [{ name: "pvd_b", sealedRef: spare }];
    assert((await store.sync()).ok);
    assert(store.known.match(OTHER_VALUE) !== undefined);
    // 모두 사라지면 회수된다.
    refs = [];
    assert((await store.sync()).ok);
    assertEquals(store.known.match(OTHER_VALUE), undefined);
    store.stop();
    assertEquals(store.known.ready, false);
  } finally {
    Deno.removeSync(home, { recursive: true });
  }
});

Deno.test("platform/secrets#R8: 값을 읽지 못하면 matcher가 준비되지 않음이고 풀리면 다시 준비된다", async () => {
  const { path, home } = ledger();
  try {
    const keychain = createFakeKeychain();
    const ref = await put(keychain, OWNER_VALUE);
    const source: SecretRefSource = {
      owner: "lophn-agent/harness/provider",
      commands: [],
      read: () => ok([{ name: "pvd_a", sealedRef: ref }]),
    };
    keychain.setStatus("unavailable");
    const calls: Calls = { registered: [], revoked: [], ready: [] };
    const store = openSecretStore({
      ledgerPath: path,
      channel: channel(calls),
      keychain: () => keychain,
      sources: [source],
      retryMs: 3_600_000,
    });
    assert(!(await store.sync()).ok);
    assertEquals(store.known.ready, false);
    keychain.setStatus("available");
    assert((await store.sync()).ok);
    assertEquals(store.known.ready, true);
    store.stop();
  } finally {
    Deno.removeSync(home, { recursive: true });
  }
});

Deno.test("platform/secrets#R1: owner의 참조를 바꾸는 command가 확정되면 응답 전에 다시 맞추고 다른 command는 맞추지 않는다", async () => {
  let syncs = 0;
  const writer = withSecretSync(
    {
      command: () => Promise.resolve(ok({} as never)),
      readResult: () => Promise.resolve(ok(null)),
      close: () => Promise.resolve(),
    },
    () => {
      syncs++;
      return Promise.resolve();
    },
    [{
      owner: "lophn-agent/harness/provider",
      commands: ["RegisterProvider"],
      read: () => ok([]),
    }],
  );
  const ctx = {
    principal: "user-1",
    actor: "user" as const,
    scope: { operations: [], targets: {} },
    conditions: {},
    credential_ref: "c",
  };
  const envelope = (command: string) => ({
    command,
    input: {},
    idempotency_key: "k",
    compare: {},
    prepared: [],
  });
  await writer.command(ctx, envelope("RegisterProvider") as never);
  await writer.command(ctx, envelope("SetSecret") as never);
  assertEquals(syncs, 2);
  await writer.command(ctx, envelope("ListThings") as never);
  assertEquals(syncs, 2);
});

type Known = {
  match(text: string): { index: number; length: number } | undefined;
  readonly ready: boolean;
};

function bodyPreparer(known: () => Known | undefined) {
  const prepared: Uint8Array[] = [];
  const prepare = createMessageBodyPreparer({
    relay: () => ({
      live: () => false,
      prepare(call) {
        // 준비되는 바이트를 읽어 모은다.
        return (async () => {
          const reader = call.bytes.getReader();
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            prepared.push(next.value);
          }
          return ok({
            preparation: "p",
            principal: call.principal,
            purpose: call.purpose,
            hash: call.expectedHash ?? "",
            size_bytes: 1,
          });
        })();
      },
    }),
    known,
  });
  return { prepare, prepared };
}

const user = {
  principal: "user-1",
  actor: "user" as const,
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "c",
};

const message = (text: string) => ({
  command: receiveMessage.name,
  input: {
    content: { schema_version: 1, parts: [{ kind: "text", text }] },
  },
  idempotency_key: "k",
  compare: {},
  prepared: [],
});

Deno.test("lophn-agent/conversation#R2 platform/redaction#R1: 메시지 본문은 알려진 값과 pattern을 함께 가리고 값을 다 모르면 막는다", async () => {
  const match = (text: string) => {
    const index = text.indexOf(OWNER_VALUE);
    return index < 0 ? undefined : { index, length: OWNER_VALUE.length };
  };
  const { prepare, prepared } = bodyPreparer(() => ({ ready: true, match }));
  const done = await prepare(
    user as never,
    message(
      `값 ${OWNER_VALUE} 그리고 ghp_abcdefghijklmnopqrstuvwxyz0123 끝`,
    ) as never,
  );
  assert(done.ok, done.ok ? "" : done.error.message);
  const content = (done.value.input as {
    content: { parts: { text: string }[] };
  }).content;
  assertEquals(content.parts[0]!.text, "값 * 그리고 * 끝");
  assert(!new TextDecoder().decode(prepared[0]).includes(OWNER_VALUE));

  // 준비되지 않음: 모르는 채로 원문을 저장하지 않는다.
  const notReady = bodyPreparer(() => ({ ready: false, match }));
  const refused = await notReady.prepare(
    user as never,
    message(`값 ${OWNER_VALUE}`) as never,
  );
  assert(!refused.ok);
  assertEquals(refused.error.code, "unavailable");
  assertEquals(notReady.prepared.length, 0);

  // matcher가 없으면 pattern 규칙만 쓴다(기존 동작).
  const plain = bodyPreparer(() => undefined);
  const kept = await plain.prepare(
    user as never,
    message(`값 ${OWNER_VALUE} ghp_abcdefghijklmnopqrstuvwxyz0123`) as never,
  );
  assert(kept.ok);
  const keptText = (kept.value.input as {
    content: { parts: { text: string }[] };
  }).content.parts[0]!.text;
  assertEquals(keptText, `값 ${OWNER_VALUE} *`);
});
