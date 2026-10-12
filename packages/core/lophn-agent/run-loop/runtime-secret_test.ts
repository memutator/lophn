// lophn-agent/harness/provider#R4 #R7, platform/secrets#R5: core가 agent runtime의 secret 전송 부착 요청을
// 현재 provider 참조·판·목적지와 대조하고 값은 통과했을 때만 한 번 건넨다. ledger는 temp dir이고
// keychain은 fake다(사람의 실제 keychain에 닿지 않는다).
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { providerSchemaSteps } from "../providers/mod.ts";
import { createFakeKeychain, type FakeKeychain } from "../../secrets/mod.ts";
import { createAgentRuntimeSecrets } from "./runtime-secret.ts";

const VALUE = "violet-harbor-credential-5d8e2f41-lantern";
const ENDPOINT = "https://api.example.test";

type World = {
  home: string;
  keychain: FakeKeychain;
  ref: string;
  db: DatabaseSync;
  ready: { value: boolean };
};

async function open(): Promise<World> {
  const home = await Deno.makeTempDir({ prefix: "lophn-agent-secret-" });
  const db = new DatabaseSync(`${home}/lophn.db`);
  for (const step of providerSchemaSteps) db.exec(step.sql);
  const keychain = createFakeKeychain();
  const stored = await keychain.store({
    name: "pvd_a/main",
    purpose: "provider_credential",
    owner: "pvd_a",
    value: new TextEncoder().encode(VALUE),
  });
  assert(stored.ok);
  db.prepare(
    "INSERT INTO providers (id, name, definition_key, definition, endpoint, protocol, revision) VALUES ('pvd_a', 'a', 'openai', '{}', ?, 'openai-responses', 1)",
  ).run(ENDPOINT);
  db.prepare(
    "INSERT INTO provider_credentials (provider, kind, secret_name, secret_sealed_ref, secret_revision, revision, state) VALUES ('pvd_a', 'api_key', 'pvd_a/main', ?, 1, 1, 'available')",
  ).run(stored.value);
  return {
    home,
    keychain,
    ref: stored.value,
    db,
    ready: { value: true },
  };
}

function secrets(world: World) {
  return createAgentRuntimeSecrets({
    ledgerPath: `${world.home}/lophn.db`,
    keychain: () => world.keychain,
    known: () => ({
      ready: world.ready.value,
      match(text) {
        const index = text.indexOf(VALUE);
        return index < 0 ? undefined : { index, length: VALUE.length };
      },
    }),
    process: "lophn-agent/runtime",
    task: "lophn-agent",
  });
}

function request(world: World, over: Record<string, unknown> = {}) {
  return {
    type: "secret_send_request",
    request_id: "r1",
    use: {
      sealed_ref: world.ref,
      revision: 1,
      purpose: "provider_credential",
      destination: { kind: "https", origin: ENDPOINT },
    },
    operation: "model.call",
    url: `${ENDPOINT}/responses`,
    method: "POST",
    ...over,
  };
}

async function close(world: World) {
  world.db.close();
  await Deno.remove(world.home, { recursive: true });
}

function errorOf(response: unknown): string | undefined {
  const value = response as { ok: boolean; error?: { code: string } };
  return value.ok ? undefined : value.error?.code;
}

Deno.test("platform/secrets#R5: 현재 참조·판·목적지가 맞으면 값을 한 번 건네고 응답 밖에는 값이 없다", async () => {
  const world = await open();
  try {
    const answer = await secrets(world).answer(request(world), () => true);
    assertEquals(answer, {
      type: "secret_send_response",
      request_id: "r1",
      ok: true,
      value: VALUE,
    });
  } finally {
    await close(world);
  }
});

Deno.test("platform/secrets#R5: 바뀐 판·옛 참조·Disconnect한 provider는 conflict이고 다른 목적지·회수한 credential은 forbidden이다", async () => {
  const world = await open();
  try {
    const sut = secrets(world);
    const stale = request(world);
    (stale.use as { revision: number }).revision = 2;
    assertEquals(errorOf(await sut.answer(stale, () => true)), "conflict");

    const replaced = request(world);
    (replaced.use as { sealed_ref: string }).sealed_ref = "sealed-old";
    assertEquals(errorOf(await sut.answer(replaced, () => true)), "conflict");

    const elsewhere = request(world);
    (elsewhere.use as { destination: unknown }).destination = {
      kind: "https",
      origin: "https://other.example.test",
    };
    assertEquals(errorOf(await sut.answer(elsewhere, () => true)), "forbidden");

    // 같은 host의 loopback HTTP 목적지는 HTTPS 목적지를 대신하지 못한다.
    const downgraded = request(world);
    (downgraded.use as { destination: unknown }).destination = {
      kind: "loopback_http",
      origin: "http://127.0.0.1:8080",
    };
    assertEquals(
      errorOf(await sut.answer(downgraded, () => true)),
      "forbidden",
    );

    world.db.exec(
      "UPDATE provider_credentials SET state = 'revoked', unavailable_reason = 'refresh_revoked'",
    );
    assertEquals(
      errorOf(await sut.answer(request(world), () => true)),
      "forbidden",
    );

    // Disconnect로 provider와 credential이 지워지면 옛 참조는 현재가 아니다.
    world.db.exec("DELETE FROM provider_credentials; DELETE FROM providers");
    assertEquals(
      errorOf(await sut.answer(request(world), () => true)),
      "conflict",
    );
  } finally {
    await close(world);
  }
});

Deno.test("platform/secrets#R8 platform/redaction#R1: 값을 읽을 수 없거나 알려진 값이 아니거나 child가 끝났으면 값을 건네지 않는다", async () => {
  const world = await open();
  try {
    const sut = secrets(world);
    // 알려진 값 registry가 준비되지 않았다: 값이 어딘가 섞여도 지울 수 없다.
    world.ready.value = false;
    const notReady = await sut.answer(request(world), () => true);
    assertEquals(errorOf(notReady), "unavailable");
    assert(!JSON.stringify(notReady).includes(VALUE));
    world.ready.value = true;

    // keychain 잠김.
    world.keychain.setStatus("unavailable");
    const locked = await sut.answer(request(world), () => true);
    assertEquals(errorOf(locked), "unavailable");
    assert(!JSON.stringify(locked).includes(VALUE));
    world.keychain.setStatus("available");

    // 끝난 child generation.
    assertEquals(
      errorOf(await sut.answer(request(world), () => false)),
      "forbidden",
    );

    // 올바르지 않은 요청에는 답하지 않는다.
    assertEquals(
      await sut.answer({ type: "secret_send_request" }, () => true),
      undefined,
    );
  } finally {
    await close(world);
  }
});
