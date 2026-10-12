import assert from "node:assert/strict";
import { test } from "node:test";

import { createCoordinator } from "../coordinator.ts";
import { fake, parent } from "../coordinator_fixture.ts";
import { contentBasis } from "../handle.ts";
import { fakeCore, id, ok } from "./kinds_fixture.ts";
import { createKinds } from "./mod.ts";
import {
  CHANGE_PROVIDER_CREDENTIALS,
  createSecretSubmitter,
  readSecretInput,
  REGISTER_PROVIDER_CREDENTIAL,
  SET_SECRET,
} from "./secret-input.ts";

const VALUE = "correct-horse-battery-staple-9";
const PVD = id("pvd", 1);

const EVIDENCE = {
  preparation: "prep-1",
  sealed_ref: "sealed-1",
  purpose: "app_secret",
  owner: "weather.key",
};

function secretCore(
  options: { configured?: boolean; upload?: "ok" | "unavailable" } = {},
) {
  return fakeCore({
    "read:secrets/list": () =>
      ok({
        secrets: [{
          name: "weather.key",
          configured: options.configured ?? false,
          revision: options.configured ? 1 : null,
        }],
      }),
    "upload:secrets/input": () =>
      options.upload === "unavailable"
        ? {
          ok: false,
          error: { code: "unavailable", message: `keychain ${VALUE}` },
        }
        : ok({ ...EVIDENCE, extra: "dropped" }),
    "command:secrets/set": () =>
      ok({ name: "weather.key", configured: true, revision: 1 }),
    "read:providers/read": () =>
      ok({ provider: { id: PVD, name: "Anthropic", revision: 4 } }),
    "command:provider-credentials/register": () => ok({ provider: {} }),
  });
}

function everything(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item) => item instanceof Uint8Array ? [...item] : item,
  );
}

test("platform/secrets#R2, shell/confirmation-window#R6: secret 값은 보호 입력에서 upload 바이트로만 가고 handle은 준비 증거를 받은 뒤 그 binding으로 만든다", async () => {
  const core = secretCore();
  const read = await readSecretInput(core, {
    owner: "weather.key",
    purpose: "app_secret",
  });
  assert.equal(read.ok, true);
  if (!read.ok) return;
  assert.equal(read.value.handle, "deferred");
  assert.deepEqual(read.value.allowed, [SET_SECRET]);
  const registered: unknown[] = [];
  const submitter = createSecretSubmitter(core, { now: () => 1_000 });
  const sent = await submitter.submit({
    windowId: "cfw_1",
    canonical: read.value,
    decision: SET_SECRET,
    commandInput: { value: VALUE },
    register: (request) => {
      registered.push(request);
      return Promise.resolve({ ok: true, confirmation: "S".repeat(43) });
    },
  });
  // 창에는 안전 이름과 저장 결과만 간다.
  assert.deepEqual(sent, {
    ok: true,
    value: { secret_ref: "weather.key", stored: "stored" },
  });
  const upload = core.calls.find((call) => call.kind === "upload")!;
  assert.deepEqual(upload.body, {
    purpose: "app_secret",
    owner: "weather.key",
    bytes: new TextEncoder().encode(VALUE).length,
  });
  assert.equal(new TextDecoder().decode(upload.bytes), VALUE);
  // upload 말고는 값이 어디에도 없다(command·handle 등록·결과).
  const others = core.calls.filter((call) => call.kind !== "upload");
  assert.equal(everything(others).includes(VALUE), false);
  assert.equal(everything(registered).includes(VALUE), false);
  assert.equal(everything(sent).includes(VALUE), false);
  const preparation = {
    preparation: "prep-1",
    sealed_ref: "sealed-1",
    purpose: "app_secret",
    owner: "weather.key",
  };
  assert.deepEqual(registered, [{
    target_ref: "weather.key",
    content_hash: contentBasis({ name: "weather.key", preparation }),
    allowed_decisions: [SET_SECRET],
    expires_at: new Date(121_000).toISOString(),
  }]);
  const set = others.find((call) => call.method === "set")!
    .body as Record<string, unknown>;
  assert.deepEqual(set.input, { name: "weather.key", preparation });
  assert.deepEqual(set.compare, { sealed_ref: null, revision: null });
  assert.equal(set.confirmation, "S".repeat(43));
});

test("platform/secrets#R2: 저장하지 못해도 값은 오류·결과에 없고 handle도 만들지 않는다", async () => {
  const core = secretCore({ upload: "unavailable" });
  const read = await readSecretInput(core, {
    owner: "weather.key",
    purpose: "app_secret",
  });
  if (!read.ok) return assert.fail("read");
  let registered = 0;
  const sent = await createSecretSubmitter(core, { now: () => 0 }).submit({
    windowId: "cfw_1",
    canonical: read.value,
    decision: SET_SECRET,
    commandInput: { value: VALUE },
    register: () => {
      registered += 1;
      return Promise.resolve({ ok: true, confirmation: "S".repeat(43) });
    },
  });
  assert.equal(sent.ok, false);
  assert.equal(everything(sent).includes(VALUE), false);
  assert.equal(everything(sent).includes("keychain"), false);
  assert.equal(registered, 0);
  // 이미 값이 있으면 교체 비교 기준이 없어 고를 결정이 없다.
  const configured = await readSecretInput(secretCore({ configured: true }), {
    owner: "weather.key",
    purpose: "app_secret",
  });
  assert.equal(configured.ok && configured.value.allowed.length, 0);
});

test("lophn-agent/harness/provider#R1, platform/secrets#R2: provider credential은 같은 입력으로 증거를 받아 RegisterProviderCredential을 부른다", async () => {
  const core = fakeCore({
    "read:providers/read": () =>
      ok({ provider: { id: PVD, name: "Anthropic", revision: 4 } }),
    "upload:secrets/input": () =>
      ok({
        preparation: "prep-2",
        sealed_ref: "sealed-2",
        purpose: "provider_credential",
        owner: PVD,
      }),
    "command:provider-credentials/register": () => ok({ provider: {} }),
  });
  const credential = {
    key: "main",
    kind: "api_key" as const,
    label: "Main key",
    account: null,
    organization: null,
    plan: null,
    dedup_fingerprint: "d".repeat(64),
  };
  const read = await readSecretInput(core, {
    owner: PVD,
    purpose: "provider_credential",
    credential,
  });
  if (!read.ok) return assert.fail("read");
  assert.deepEqual(read.value.allowed, [REGISTER_PROVIDER_CREDENTIAL]);
  assert.equal(read.value.view?.entry, "key");
  const registered: { content_hash: string }[] = [];
  const sent = await createSecretSubmitter(core, { now: () => 0 }).submit({
    windowId: "cfw_1",
    canonical: read.value,
    decision: REGISTER_PROVIDER_CREDENTIAL,
    commandInput: { value: VALUE },
    register: (request) => {
      registered.push(request);
      return Promise.resolve({ ok: true, confirmation: "P".repeat(43) });
    },
  });
  assert.deepEqual(sent, {
    ok: true,
    value: { secret_ref: "Main key", stored: "stored" },
  });
  const preparation = {
    preparation: "prep-2",
    sealed_ref: "sealed-2",
    purpose: "provider_credential",
    owner: PVD,
  };
  const register = core.calls.find((call) => call.method === "register")!
    .body as Record<string, unknown>;
  assert.deepEqual(register.input, {
    provider: PVD,
    key: "main",
    kind: "api_key",
    label: "Main key",
    preparation,
    account: null,
    organization: null,
    plan: null,
    dedup_fingerprint: "d".repeat(64),
  });
  assert.deepEqual(register.compare, { revision: 4 });
  assert.equal(
    registered[0]!.content_hash,
    contentBasis({ provider: PVD, key: "main", preparation }),
  );
  assert.equal(everything(core.calls.slice(2)).includes(VALUE), false);
});

test("shell/confirmation-window#R9, platform/secrets#R2: secret 창은 열 때 handle을 만들지 않고 제출 한 번에 하나만 만들며 두 번 보내지 않는다", async () => {
  const env = fake();
  const core = secretCore();
  const kinds = createKinds({
    core: () => core,
    clock: { now: () => env.clock.now },
    random: (bytes) => bytes,
  });
  const confirm = createCoordinator({
    host: env.host,
    canon: kinds.canon,
    handles: env.handles,
    submit: kinds.submit,
    deferred: kinds.deferred,
    clock: { now: () => env.clock.now },
    preload: "/preload-confirmation.cjs",
    packaged: true,
    epoch: () => "epoch-1",
    connected: () => true,
  });
  const opened = await confirm.open({
    intent: {
      kind: "secret_input",
      owner: "weather.key",
      purpose: "app_secret",
    },
    parent: parent("shell-1"),
    requestedByPerson: true,
  });
  if (!opened.ok) return assert.fail("open");
  assert.equal(env.handles.issued, 0);
  const shown = confirm.display(opened.value.windowId);
  assert.deepEqual(shown?.decisions, [SET_SECRET]);
  assert.equal(shown?.view?.kind, "secret");
  const first = await confirm.submit({
    windowId: opened.value.windowId,
    displayId: opened.value.displayId,
    decision: SET_SECRET,
    commandInput: { value: VALUE },
  });
  assert.deepEqual(first, {
    ok: true,
    value: { secret_ref: "weather.key", stored: "stored" },
  });
  assert.equal(env.handles.issued, 1);
  const second = await confirm.submit({
    windowId: opened.value.windowId,
    displayId: opened.value.displayId,
    decision: SET_SECRET,
    commandInput: { value: VALUE },
  });
  assert.equal(second.ok, false);
  assert.equal(env.handles.issued, 1);
  assert.equal(
    core.calls.filter((call) => call.kind === "upload").length,
    1,
  );
  // renderer로 나간 표시에도 값이 없다.
  assert.equal(everything(env.windows[0]?.sent).includes(VALUE), false);
});

function accountCore() {
  return fakeCore({
    "read:providers/read": () =>
      ok({ provider: { id: PVD, name: "Anthropic", revision: 6 } }),
    "read:provider-credentials/list": () =>
      ok({
        credentials: [
          { key: "main", label: "Main key", revision: 3, order: 0 },
          { key: "spare", label: "Spare key", revision: 1, order: 1 },
        ],
      }),
    "upload:secrets/input": () =>
      ok({
        preparation: "prep-3",
        sealed_ref: "sealed-3",
        purpose: "provider_credential",
        owner: PVD,
      }),
    "command:provider-credentials/change": () => ok({ provider: {} }),
  });
}

test("lophn-agent/harness/provider#R6, platform/secrets#R2: 계정 교체는 새 값의 증거를 그 계정에만 넣어 ChangeProviderCredentials로 보낸다", async () => {
  const core = accountCore();
  const read = await readSecretInput(core, {
    owner: PVD,
    purpose: "provider_credential",
    change: { key: "main", action: "replace" },
  });
  if (!read.ok) return assert.fail("read");
  assert.deepEqual(read.value.allowed, [CHANGE_PROVIDER_CREDENTIALS]);
  assert.equal(read.value.handle, "deferred");
  assert.equal(read.value.view?.entry, "replace");
  assert.equal(read.value.view?.name, "Main key");
  const registered: { content_hash: string }[] = [];
  const sent = await createSecretSubmitter(core, { now: () => 0 }).submit({
    windowId: "cfw_1",
    canonical: read.value,
    decision: CHANGE_PROVIDER_CREDENTIALS,
    commandInput: { value: VALUE },
    register: (request) => {
      registered.push(request);
      return Promise.resolve({ ok: true, confirmation: "C".repeat(43) });
    },
  });
  assert.deepEqual(sent, {
    ok: true,
    value: { secret_ref: "Main key", stored: "stored" },
  });
  const preparation = {
    preparation: "prep-3",
    sealed_ref: "sealed-3",
    purpose: "provider_credential",
    owner: PVD,
  };
  const change = core.calls.find((call) => call.method === "change")!
    .body as Record<string, unknown>;
  const credentials = [{
    key: "main",
    revision: 3,
    replacement: preparation,
    order: 0,
    revoke: false,
  }];
  assert.deepEqual(change.input, { provider: PVD, credentials });
  assert.deepEqual(change.compare, { revision: 6 });
  assert.equal(
    registered[0]!.content_hash,
    contentBasis({ provider: PVD, credentials }),
  );
  assert.equal(everything(core.calls.slice(2)).includes(VALUE), false);
});

test("lophn-agent/harness/provider#R6, shell/confirmation-window#R5: 계정 삭제는 값을 받지 않고 그 계정을 새 일에서 막으며 막은 것만 돌려준다", async () => {
  const core = accountCore();
  const read = await readSecretInput(core, {
    owner: PVD,
    purpose: "provider_credential",
    change: { key: "spare", action: "revoke" },
  });
  if (!read.ok) return assert.fail("read");
  assert.equal(read.value.view?.entry, "revoke");
  const sent = await createSecretSubmitter(core, { now: () => 0 }).submit({
    windowId: "cfw_1",
    canonical: read.value,
    decision: CHANGE_PROVIDER_CREDENTIALS,
    commandInput: {},
    register: () => Promise.resolve({ ok: true, confirmation: "R".repeat(43) }),
  });
  assert.deepEqual(sent, {
    ok: true,
    value: { secret_ref: "Spare key", stored: "revoked" },
  });
  assert.equal(core.calls.some((call) => call.kind === "upload"), false);
  const change = core.calls.find((call) => call.method === "change")!
    .body as Record<string, unknown>;
  assert.deepEqual(change.input, {
    provider: PVD,
    credentials: [{
      key: "spare",
      revision: 1,
      replacement: null,
      order: 1,
      revoke: true,
    }],
  });
  // 없는 계정은 열지 않는다.
  const missing = await readSecretInput(core, {
    owner: PVD,
    purpose: "provider_credential",
    change: { key: "gone", action: "revoke" },
  });
  assert.equal(missing.ok, false);
});

// 순서 숫자가 이어지지 않는 계정 셋. 회수된 계정(old)도 목록에 있다.
function listedCore() {
  return fakeCore({
    "read:providers/read": () =>
      ok({ provider: { id: PVD, name: "Anthropic", revision: 6 } }),
    "read:provider-credentials/list": () =>
      ok({
        credentials: [
          {
            key: "main",
            label: "Main key",
            revision: 3,
            order: 0,
            enabled: true,
            state: "available",
          },
          {
            key: "spare",
            label: "Spare key",
            revision: 1,
            order: 2,
            enabled: false,
            state: "available",
          },
          {
            key: "old",
            label: "Old key",
            revision: 2,
            order: 5,
            enabled: true,
            state: "revoked",
          },
        ],
      }),
    "command:provider-credentials/change": () => ok({ provider: {} }),
  });
}

async function submitChange(
  core: ReturnType<typeof listedCore>,
  change: { key?: string; action: string; keys?: string[] },
  commandInput: unknown = {},
) {
  const read = await readSecretInput(core, {
    owner: PVD,
    purpose: "provider_credential",
    change: change as never,
  });
  if (!read.ok) return assert.fail(`read: ${read.error.code}`);
  const registered: { content_hash: string; allowed_decisions: string[] }[] =
    [];
  const sent = await createSecretSubmitter(core, { now: () => 0 }).submit({
    windowId: "cfw_1",
    canonical: read.value,
    decision: CHANGE_PROVIDER_CREDENTIALS,
    commandInput,
    register: (request) => {
      registered.push(request);
      return Promise.resolve({ ok: true, confirmation: "E".repeat(43) });
    },
  });
  const command = core.calls.find((call) => call.method === "change")
    ?.body as Record<string, unknown> | undefined;
  return { read: read.value, sent, command, registered };
}

test("shell/desktop#R49 [agent-I48], lophn-agent/harness/provider#R8: 계정 끄기와 켜기는 그 계정 하나의 enabled만 바꾸고 순서·판은 그대로이며 값은 받지 않는다", async () => {
  const core = listedCore();
  const off = await submitChange(core, { key: "main", action: "disable" }, {
    value: VALUE,
  });
  assert.deepEqual(off.read.allowed, [CHANGE_PROVIDER_CREDENTIALS]);
  assert.equal(off.read.handle, "deferred");
  assert.equal(off.read.view?.entry, "disable");
  assert.equal(off.read.view?.name, "Main key");
  assert.equal(off.read.view?.provider, "Anthropic");
  assert.deepEqual(off.sent, {
    ok: true,
    value: { secret_ref: "Main key", stored: "stored" },
  });
  // 값을 받는 일이 아니다. 누가 값을 보내도 올리지 않는다.
  assert.equal(core.calls.some((call) => call.kind === "upload"), false);
  assert.equal(everything(core.calls).includes(VALUE), false);
  const credentials = [{
    key: "main",
    revision: 3,
    replacement: null,
    enabled: false,
    order: 0,
    revoke: false,
  }];
  assert.deepEqual(off.command?.input, { provider: PVD, credentials });
  assert.deepEqual(off.command?.compare, { revision: 6 });
  assert.equal(
    off.registered[0]!.content_hash,
    contentBasis({ provider: PVD, credentials }),
  );

  const onCore = listedCore();
  const on = await submitChange(onCore, { key: "spare", action: "enable" });
  assert.equal(on.read.view?.entry, "enable");
  assert.deepEqual(on.command?.input, {
    provider: PVD,
    credentials: [{
      key: "spare",
      revision: 1,
      replacement: null,
      enabled: true,
      order: 2,
      revoke: false,
    }],
  });
});

test("shell/desktop#R49 [agent-I48]: 이미 그 상태이거나 없는 계정의 끄고 켜기는 창을 열지 않는다", async () => {
  const core = listedCore();
  for (
    const [key, action] of [
      ["main", "enable"],
      ["spare", "disable"],
      ["gone", "disable"],
    ] as const
  ) {
    const read = await readSecretInput(core, {
      owner: PVD,
      purpose: "provider_credential",
      change: { key, action },
    });
    assert.equal(read.ok, false, `${key} ${action}`);
  }
});

test("shell/desktop#R49 [agent-I48], lophn-agent/harness/provider#R8: 계정 순서 바꾸기는 새 순서의 계정 전부를 이미 쓰던 순서 숫자 위에 얹고 전후 순서를 창에 보인다", async () => {
  const core = listedCore();
  const moved = await submitChange(core, {
    action: "reorder",
    keys: ["spare", "old", "main"],
  });
  assert.equal(moved.read.view?.entry, "reorder");
  assert.equal(moved.read.view?.name, "Anthropic");
  assert.deepEqual(moved.read.view?.before, [
    "Main key",
    "Spare key",
    "Old key",
  ]);
  assert.deepEqual(moved.read.view?.after, [
    "Spare key",
    "Old key",
    "Main key",
  ]);
  assert.deepEqual(moved.sent, {
    ok: true,
    value: { secret_ref: "Anthropic", stored: "stored" },
  });
  assert.equal(core.calls.some((call) => call.kind === "upload"), false);
  // 쓰던 숫자 0·2·5를 새 순서대로 나눈다. 회수된 계정도 순서에 든다.
  const credentials = [
    { key: "spare", revision: 1, replacement: null, order: 0, revoke: false },
    { key: "old", revision: 2, replacement: null, order: 2, revoke: false },
    { key: "main", revision: 3, replacement: null, order: 5, revoke: false },
  ];
  assert.deepEqual(moved.command?.input, { provider: PVD, credentials });
  assert.deepEqual(moved.command?.compare, { revision: 6 });
  assert.equal(
    moved.registered[0]!.content_hash,
    contentBasis({ provider: PVD, credentials }),
  );
});

test("shell/desktop#R49 [agent-I48]: 순서 바꾸기는 지금 계정 전부와 정확히 같은 key 목록일 때만 열린다", async () => {
  const core = listedCore();
  for (
    const keys of [
      ["spare", "main"],
      ["spare", "old", "main", "extra"],
      ["spare", "old", "gone"],
    ]
  ) {
    const read = await readSecretInput(core, {
      owner: PVD,
      purpose: "provider_credential",
      change: { action: "reorder", keys },
    });
    assert.equal(read.ok, false, keys.join());
  }
});

test("shell/desktop#R49 [agent-I48], lophn-agent/harness/provider#R4: provider 끊기는 아직 쓰는 계정을 모두 새 일에서 막고 막은 것만 돌려주며 값은 받지 않는다", async () => {
  const core = listedCore();
  const gone = await submitChange(core, { action: "disconnect" });
  assert.equal(gone.read.view?.entry, "disconnect");
  assert.equal(gone.read.view?.name, "Anthropic");
  // 이미 회수된 계정은 막을 것이 아니다.
  assert.deepEqual(gone.read.view?.accounts, ["Main key", "Spare key"]);
  assert.deepEqual(gone.sent, {
    ok: true,
    value: { secret_ref: "Anthropic", stored: "revoked" },
  });
  assert.equal(core.calls.some((call) => call.kind === "upload"), false);
  const credentials = [
    { key: "main", revision: 3, replacement: null, order: 0, revoke: true },
    { key: "spare", revision: 1, replacement: null, order: 2, revoke: true },
  ];
  assert.deepEqual(gone.command?.input, { provider: PVD, credentials });
  assert.deepEqual(gone.command?.compare, { revision: 6 });
  assert.equal(
    gone.registered[0]!.content_hash,
    contentBasis({ provider: PVD, credentials }),
  );
});

test("shell/desktop#R49 [agent-I48]: 막을 계정이 하나도 없는 provider의 끊기는 창을 열지 않는다", async () => {
  const core = fakeCore({
    "read:providers/read": () =>
      ok({ provider: { id: PVD, name: "Ollama", revision: 2 } }),
    "read:provider-credentials/list": () => ok({ credentials: [] }),
  });
  const read = await readSecretInput(core, {
    owner: PVD,
    purpose: "provider_credential",
    change: { action: "disconnect" },
  });
  assert.equal(read.ok, false);
  assert.equal(core.calls.some((call) => call.method === "change"), false);
});

test("lophn-agent/harness/provider#R9, platform/secrets#R2: 등록 정보에 지문이 없으면 main이 넣은 값의 sha256으로 만들고 값은 어디에도 남지 않는다", async () => {
  const core = fakeCore({
    "read:providers/read": () =>
      ok({ provider: { id: PVD, name: "Anthropic", revision: 4 } }),
    "upload:secrets/input": () =>
      ok({
        preparation: "prep-4",
        sealed_ref: "sealed-4",
        purpose: "provider_credential",
        owner: PVD,
      }),
    "command:provider-credentials/register": () => ok({ provider: {} }),
  });
  const read = await readSecretInput(core, {
    owner: PVD,
    purpose: "provider_credential",
    credential: {
      key: "key-1",
      kind: "api_key",
      label: "Work key",
      account: null,
      organization: null,
      plan: null,
    },
  });
  if (!read.ok) return assert.fail("read");
  const sent = await createSecretSubmitter(core, { now: () => 0 }).submit({
    windowId: "cfw_1",
    canonical: read.value,
    decision: REGISTER_PROVIDER_CREDENTIAL,
    commandInput: { value: VALUE },
    register: () => Promise.resolve({ ok: true, confirmation: "F".repeat(43) }),
  });
  assert.equal(sent.ok, true);
  const register = core.calls.find((call) => call.method === "register")!
    .body as { input: { dedup_fingerprint: string } };
  assert.match(register.input.dedup_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(
    register.input.dedup_fingerprint,
    (await import("node:crypto")).createHash("sha256").update(VALUE).digest(
      "hex",
    ),
  );
  assert.equal(everything(core.calls.slice(1)).includes(VALUE), false);
});

test("lophn-agent/harness/provider#R11, lophn-agent#T16: OAuth 로그인 값은 secret store에 가지 않고 CompleteProviderLogin의 submission으로만 간다", async () => {
  const core = fakeCore({
    "read:providers/read": () =>
      ok({ provider: { id: PVD, name: "OpenAI", revision: 5 } }),
    "upload:secrets/input": () =>
      ok({
        preparation: "prep-9",
        sealed_ref: "sealed-9",
        purpose: "provider_credential",
        owner: PVD,
      }),
    "command:providers/login-complete": () => ok({ provider: {} }),
    "command:provider-credentials/register": () => ok({ provider: {} }),
  });
  const read = await readSecretInput(core, {
    owner: PVD,
    purpose: "provider_credential",
    credential: {
      key: "login-abc12345",
      kind: "oauth",
      label: "ChatGPT login",
      account: null,
      organization: null,
      plan: null,
    },
  });
  if (!read.ok) return assert.fail("read");
  assert.deepEqual(read.value.allowed, [REGISTER_PROVIDER_CREDENTIAL]);
  assert.equal(read.value.view?.entry, "code");
  const registered: { content_hash: string }[] = [];
  const pasted =
    "https://auth.example.test/callback?code=the-code&state=state-1";
  const sent = await createSecretSubmitter(core, { now: () => 0 }).submit({
    windowId: "cfw_1",
    canonical: read.value,
    decision: REGISTER_PROVIDER_CREDENTIAL,
    commandInput: { value: pasted },
    register: (request) => {
      registered.push(request);
      return Promise.resolve({ ok: true, confirmation: "L".repeat(43) });
    },
  });
  assert.deepEqual(sent, {
    ok: true,
    value: { secret_ref: "ChatGPT login", stored: "stored" },
  });
  // OAuth 값은 upload(증거)로 가지 않는다.
  assert.equal(core.calls.some((call) => call.kind === "upload"), false);
  const complete = core.calls.find((call) => call.method === "login-complete")!
    .body as Record<string, unknown>;
  const input = complete.input as Record<string, string>;
  assert.deepEqual(input, {
    provider: PVD,
    login: "login-abc12345",
    submission: pasted,
  });
  // 값은 소유 command의 submission binding으로만 간다(handle 등록·결과에는 없다).
  const others = core.calls.filter((
    call,
  ) =>
    !(call.kind === "command" && call.method === "login-complete") &&
    call.kind !== "upload"
  );
  assert.equal(everything(others).includes("the-code"), false);
  assert.equal(registered.length, 1);
});
