import assert from "node:assert/strict";
import { test } from "node:test";

import { contentBasis } from "../handle.ts";
import { fakeCore, id, ok } from "./kinds_fixture.ts";
import {
  COMPLETE_PROVIDER_LOGIN,
  createSecretSubmitter,
  DISCONNECT_PROVIDER,
  readSecretInput,
  REGISTER_PROVIDER,
} from "./secret-input.ts";

// 사람 결정(2026-10-12): provider에는 credential이 하나다. Connect는 보호 입력으로 받은 값의 준비 증거를 실어
// RegisterProvider 하나를 부르고, Disconnect는 확인 창을 거쳐 provider와 credential을 지운다.
// 계정 교체·회수는 없다.

const VALUE = "correct-horse-battery-staple-9";
const PVD = id("pvd", 1);

const DEFINITION = {
  key: "anthropic",
  display_name: "Anthropic",
  protocols: ["anthropic-messages"],
  auth_kinds: ["api_key"],
  models_endpoint: "https://api.anthropic.com/v1/models",
  oauth: null,
  revision: "2026-10",
};

const CONNECT = {
  name: "Anthropic",
  definition: DEFINITION,
  endpoint: "https://api.anthropic.com/v1",
  protocol: "anthropic-messages" as const,
  kind: "api_key" as const,
};

function everything(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item) => item instanceof Uint8Array ? [...item] : item,
  );
}

const EVIDENCE = {
  preparation: "prep-2",
  sealed_ref: "sealed-2",
  purpose: "provider_credential",
  owner: PVD,
};

test("lophn-agent/harness/provider#R8, platform/secrets#R2: Connect는 보호 입력의 증거를 실어 RegisterProvider를 부르고 확인 handle은 만들지 않는다", async () => {
  const core = fakeCore({
    "upload:secrets/input": () => ok(EVIDENCE),
    "command:providers/register": () => ok({ provider: {} }),
  });
  const read = await readSecretInput(core, {
    owner: PVD,
    purpose: "provider_credential",
    connect: CONNECT,
  });
  if (!read.ok) return assert.fail("read");
  assert.deepEqual(read.value.allowed, [REGISTER_PROVIDER]);
  assert.equal(read.value.handle, "deferred");
  assert.equal(read.value.view?.entry, "key");
  assert.equal(read.value.view?.name, "Anthropic");
  // 아직 없는 provider라 core를 읽지 않는다.
  assert.equal(core.calls.length, 0);
  let registered = 0;
  const sent = await createSecretSubmitter(core, { now: () => 0 }).submit({
    windowId: "cfw_1",
    canonical: read.value,
    decision: REGISTER_PROVIDER,
    commandInput: { value: VALUE },
    register: () => {
      registered += 1;
      return Promise.resolve({ ok: true, confirmation: "P".repeat(43) });
    },
  });
  assert.deepEqual(sent, {
    ok: true,
    value: { secret_ref: "Anthropic", stored: "stored" },
  });
  assert.equal(registered, 0);
  const upload = core.calls.find((call) => call.kind === "upload")!;
  assert.deepEqual(upload.body, {
    purpose: "provider_credential",
    owner: PVD,
    bytes: new TextEncoder().encode(VALUE).length,
  });
  const command = core.calls.find((call) => call.method === "register")!
    .body as Record<string, unknown>;
  assert.deepEqual(command.input, {
    id: PVD,
    name: "Anthropic",
    definition: DEFINITION,
    endpoint: "https://api.anthropic.com/v1",
    protocol: "anthropic-messages",
    credential: { kind: "api_key", preparation: EVIDENCE },
  });
  assert.deepEqual(command.compare, {});
  assert.equal("confirmation" in command, false);
  // 값은 upload 바이트 밖 어디에도 없다.
  const others = core.calls.filter((call) => call.kind !== "upload");
  assert.equal(everything(others).includes(VALUE), false);
  assert.equal(everything(sent).includes(VALUE), false);
});

test("lophn-agent/harness/provider#R8: 값 저장에 실패하면 provider를 등록하지 않는다", async () => {
  const core = fakeCore({
    "upload:secrets/input": () => ({
      ok: false,
      error: { code: "unavailable", message: `keychain ${VALUE}` },
    }),
    "command:providers/register": () => ok({ provider: {} }),
  });
  const read = await readSecretInput(core, {
    owner: PVD,
    purpose: "provider_credential",
    connect: CONNECT,
  });
  if (!read.ok) return assert.fail("read");
  const sent = await createSecretSubmitter(core, { now: () => 0 }).submit({
    windowId: "cfw_1",
    canonical: read.value,
    decision: REGISTER_PROVIDER,
    commandInput: { value: VALUE },
    register: () => Promise.resolve({ ok: true, confirmation: "P".repeat(43) }),
  });
  assert.equal(sent.ok, false);
  assert.equal(everything(sent).includes(VALUE), false);
  assert.equal(core.calls.some((call) => call.method === "register"), false);
});

test("lophn-agent/harness/provider#R6, shell/confirmation-window#R5: Disconnect는 provider 이름과 판으로 확인 창을 열고 값을 받지 않으며 그 판의 DisconnectProvider만 부른다", async () => {
  const core = fakeCore({
    "read:providers/read": () =>
      ok({ provider: { id: PVD, name: "Anthropic", revision: 6 } }),
    "command:providers/disconnect": () => ok({ provider: PVD }),
  });
  const read = await readSecretInput(core, {
    owner: PVD,
    purpose: "provider_credential",
    disconnect: true,
  });
  if (!read.ok) return assert.fail("read");
  assert.deepEqual(read.value.allowed, [DISCONNECT_PROVIDER]);
  assert.equal(read.value.handle, "deferred");
  assert.equal(read.value.view?.entry, "disconnect");
  assert.equal(read.value.view?.name, "Anthropic");
  const registered: {
    content_hash: string;
    allowed_decisions: readonly string[];
  }[] = [];
  const sent = await createSecretSubmitter(core, { now: () => 0 }).submit({
    windowId: "cfw_1",
    canonical: read.value,
    decision: DISCONNECT_PROVIDER,
    commandInput: { value: VALUE },
    register: (request) => {
      registered.push(request);
      return Promise.resolve({ ok: true, confirmation: "D".repeat(43) });
    },
  });
  assert.deepEqual(sent, {
    ok: true,
    value: { secret_ref: "Anthropic", stored: "revoked" },
  });
  // 값을 받는 일이 아니다. 누가 값을 보내도 올리지 않는다.
  assert.equal(core.calls.some((call) => call.kind === "upload"), false);
  assert.equal(everything(core.calls).includes(VALUE), false);
  const command = core.calls.find((call) => call.method === "disconnect")!
    .body as Record<string, unknown>;
  assert.deepEqual(command.input, { provider: PVD });
  assert.deepEqual(command.compare, { revision: 6 });
  assert.equal(command.confirmation, "D".repeat(43));
  assert.deepEqual(registered.map((request) => request.allowed_decisions), [
    [DISCONNECT_PROVIDER],
  ]);
  assert.equal(
    registered[0]!.content_hash,
    contentBasis({ provider: PVD }),
  );
});

test("lophn-agent/harness/provider#R6: 이미 지운 provider의 Disconnect는 창을 열 정본이 없다", async () => {
  const core = fakeCore({});
  const read = await readSecretInput(core, {
    owner: PVD,
    purpose: "provider_credential",
    disconnect: true,
  });
  assert.equal(read.ok, false);
  assert.equal(core.calls.some((call) => call.method === "disconnect"), false);
});

test("lophn-agent/harness/provider#R8: 계정 교체·삭제와 등록 정보 field는 더는 받지 않는다", async () => {
  const core = fakeCore({
    "read:providers/read": () =>
      ok({ provider: { id: PVD, name: "Anthropic", revision: 4 } }),
  });
  const attempts = [
    { change: { key: "main", action: "replace" } },
    { change: { key: "main", action: "revoke" } },
    {
      credential: {
        key: "main",
        kind: "api_key",
        label: "Main key",
        account: null,
        organization: null,
        plan: null,
      },
    },
  ];
  for (const extra of attempts) {
    const read = await readSecretInput(core, {
      owner: PVD,
      purpose: "provider_credential",
      ...extra,
    } as never);
    assert.equal(read.ok, false, JSON.stringify(extra));
  }
});

test("lophn-agent/harness/provider#R11: OAuth 로그인 값은 secret store에 가지 않고 CompleteProviderLogin의 submission으로만 간다", async () => {
  const core = fakeCore({
    "upload:secrets/input": () => ok(EVIDENCE),
    "command:providers/login-complete": () => ok({ completed: true }),
  });
  const read = await readSecretInput(core, {
    owner: PVD,
    purpose: "provider_credential",
    connect: {
      ...CONNECT,
      name: "OpenAI",
      kind: "oauth",
      login: "login-abc12345",
    },
  });
  if (!read.ok) return assert.fail("read");
  assert.deepEqual(read.value.allowed, [COMPLETE_PROVIDER_LOGIN]);
  assert.equal(read.value.view?.entry, "code");
  const registered: { content_hash: string }[] = [];
  const pasted =
    "https://auth.example.test/callback?code=the-code&state=state-1";
  const sent = await createSecretSubmitter(core, { now: () => 0 }).submit({
    windowId: "cfw_1",
    canonical: read.value,
    decision: COMPLETE_PROVIDER_LOGIN,
    commandInput: { value: pasted },
    register: (request) => {
      registered.push(request);
      return Promise.resolve({ ok: true, confirmation: "L".repeat(43) });
    },
  });
  assert.deepEqual(sent, {
    ok: true,
    value: { secret_ref: "OpenAI", stored: "stored" },
  });
  assert.equal(core.calls.some((call) => call.kind === "upload"), false);
  const complete = core.calls.find((call) => call.method === "login-complete")!
    .body as Record<string, unknown>;
  const input = { provider: PVD, login: "login-abc12345", submission: pasted };
  assert.deepEqual(complete.input, input);
  assert.equal(
    registered[0]!.content_hash,
    contentBasis(input),
  );
  const others = core.calls.filter((call) => call.method !== "login-complete");
  assert.equal(everything(others).includes("the-code"), false);
});
