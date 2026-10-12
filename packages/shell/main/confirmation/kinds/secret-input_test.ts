import assert from "node:assert/strict";
import { test } from "node:test";

import { createCoordinator } from "../coordinator.ts";
import { fake, parent } from "../coordinator_fixture.ts";
import { contentBasis } from "../handle.ts";
import { fakeCore, ok } from "./kinds_fixture.ts";
import { createKinds } from "./mod.ts";
import {
  createSecretSubmitter,
  readSecretInput,
  SET_SECRET,
} from "./secret-input.ts";

const VALUE = "correct-horse-battery-staple-9";

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
