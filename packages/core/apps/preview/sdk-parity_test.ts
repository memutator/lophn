// preview 대역의 두 겹이 같은 규칙인지 본다. 앱 프로세스 안에서는 packages/sdk의 cap-save·cap-secret
// client가 live가 아닌 mode에서 메모리 대역으로 답하고(broker에 나가지 않는다), broker 통로로 직접 온
// 요청은 packages/apps/preview의 대역이 받는다. apps leaf는 packages/sdk를 import하지 않으므로 두 구현을
// 한곳에 합치지 못한다. 대신 같은 요청 순서에서 같은 결과를 내는지 여기서 지킨다(apps/preview#R4).
import { assert, assertEquals } from "@std/assert";
import {
  CapabilityError,
  type CapHost,
  createSaveClient,
  createSaveStandIn,
} from "../../../sdk/cap-save/mod.ts";
import {
  CapabilityError as SecretCapabilityError,
  createSecretClient,
  createSecretStandIn,
} from "../../../sdk/cap-secret/mod.ts";
import {
  createPreviewDocumentsService,
  createPreviewSecretService,
} from "./mod.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const RELEASE = "rel_01arz3ndektsv4rrffq69g5fav";
const NONCE = "nonce-preview-1";

function previewHost(
  posts: string[],
  mode: "preview" | "test" = "preview",
): CapHost {
  return {
    mode,
    post(path) {
      posts.push(path);
      return Promise.reject(new Error("a stand-in must not reach the broker"));
    },
    call: () => null,
  };
}

const child = {
  app: APP,
  release: null,
  mode: "preview" as const,
  processNonce: NONCE,
};

Deno.test("apps/preview#R4: 문서 저장의 앱 쪽 대역과 broker 쪽 대역은 같은 요청 순서에서 같은 version과 충돌을 낸다", async () => {
  const sdk = createSaveStandIn();
  const broker = createPreviewDocumentsService({ documents: ["notes"] });
  const send = (base: string | null, key: string) =>
    broker.save(child, {
      process_nonce: NONCE,
      mode: "preview",
      key: "notes",
      base_version: base,
      idempotency_key: key,
    });
  const first = await sdk.save({
    key: "notes",
    baseVersion: null,
    idempotencyKey: "k1",
  });
  const firstBroker = await send(null, "k1");
  assert(firstBroker.ok);
  assertEquals(firstBroker.value.version, first.version);
  // 같은 재전송 key는 같은 결과다.
  const retry = await sdk.save({
    key: "notes",
    baseVersion: null,
    idempotencyKey: "k1",
  });
  const retryBroker = await send(null, "k1");
  assert(retryBroker.ok);
  assertEquals(retry.version, first.version);
  assertEquals(retryBroker.value.version, first.version);
  // 최신이 아닌 기대 version은 둘 다 conflict다.
  const stale = await sdk.save({
    key: "notes",
    baseVersion: null,
    idempotencyKey: "k2",
  })
    .catch((error: unknown) => error);
  assert(stale instanceof CapabilityError);
  assertEquals(stale.code, "conflict");
  const staleBroker = await send(null, "k2");
  assert(!staleBroker.ok);
  assertEquals(staleBroker.error.code, "conflict");
  // 이어받은 저장은 둘 다 다음 version이다.
  const next = await sdk.save({
    key: "notes",
    baseVersion: first.version,
    idempotencyKey: "k3",
  });
  const nextBroker = await send(first.version, "k3");
  assert(nextBroker.ok);
  assertEquals(nextBroker.value.version, next.version);
  assertEquals(sdk.versions.get("notes"), broker.versions.get("notes"));
});

Deno.test("apps/preview#R4: secret 사용의 앱 쪽 대역과 broker 쪽 대역은 선언하지 않은 이름을 같은 permission 이름과 scope로 거절한다", async () => {
  const sdk = createSecretStandIn({ allowed: ["calendar_token"] });
  const broker = createPreviewSecretService({
    secrets: ["calendar_token"],
    net: [{ host: "api.example.com", port: 443 }],
  });
  const destination = { host: "api.example.com", port: 443 };
  const used = await sdk.use({ name: "calendar_token", destination });
  assertEquals(used, { used: true, standIn: true });
  const usedBroker = await broker.use(child, {
    process_nonce: NONCE,
    mode: "preview",
    release: RELEASE,
    invocation: null,
    command: "usage.save",
    input_hash: "ab".repeat(32),
    name: "calendar_token",
    destination: { scheme: "https", ...destination },
  });
  assert(usedBroker.ok);
  assertEquals(usedBroker.value, { used: true });
  const refused = await sdk.use({ name: "other_token", destination }).catch((
    error: unknown,
  ) => error);
  assert(refused instanceof SecretCapabilityError);
  assertEquals(refused.code, "forbidden");
  const refusedBroker = await broker.use(child, {
    process_nonce: NONCE,
    mode: "preview",
    release: RELEASE,
    invocation: null,
    command: "usage.save",
    input_hash: "ab".repeat(32),
    name: "other_token",
    destination: { scheme: "https", ...destination },
  });
  assert(!refusedBroker.ok);
  assertEquals(refusedBroker.error.code, "forbidden");
  assertEquals(refusedBroker.error.details, {
    permission: "secret.use",
    scope: { name: "other_token" },
  });
  assertEquals(refused.permission, "secret.use");
  assertEquals(refused.scope, { name: "other_token" });
});

Deno.test("apps/preview#R4: preview·test mode의 앱 코드는 문서 저장과 secret 사용이 broker에 나가지 않고 대역이 답한다", async () => {
  for (const mode of ["preview", "test"] as const) {
    const posts: string[] = [];
    const host = previewHost(posts, mode);
    const save = await createSaveClient({ host }).save({
      key: "notes",
      baseVersion: null,
      idempotencyKey: "k1",
    });
    assertEquals(save.saved, true);
    assertEquals(save.standIn, true);
    const secret = await createSecretClient({ host }).use({
      name: "calendar_token",
      destination: { host: "api.example.com", port: 443 },
    });
    assertEquals(secret, { used: true, standIn: true });
    assertEquals(posts, []);
  }
});
