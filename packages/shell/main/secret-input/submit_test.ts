import assert from "node:assert/strict";
import { test } from "node:test";

import { connectProviderKey, type SecretCore, submitSecret } from "./submit.ts";

const VALUE = "sk-live-very-secret-value";

// 실패 code마다 오류 원문(값을 되비치는 문장 포함)이 core에서 온다고 하고 고정 code만 나가는지 본다.
const CASES: Array<[string, "invalid_input" | "unavailable"]> = [
  ["invalid_input", "invalid_input"],
  ["unauthorized", "unavailable"],
  ["forbidden", "unavailable"],
  ["unavailable", "unavailable"],
  ["internal", "unavailable"],
  ["throws", "unavailable"],
];

for (const [code, expected] of CASES) {
  test(`secret 제출이 ${code}로 실패해도 값은 결과에 없다`, async () => {
    const core: SecretCore = {
      upload() {
        if (code === "throws") {
          return Promise.reject(new Error(`failed with ${VALUE}`));
        }
        return Promise.resolve({
          ok: false,
          error: { code, message: `bad value ${VALUE}` } as { code: string },
        });
      },
    };
    const reply = await submitSecret(core, { name: "API_KEY", value: VALUE });
    assert.deepEqual(reply, { ok: false, code: expected });
    assert.ok(!JSON.stringify(reply).includes(VALUE));
  });
}

test("secret 제출이 성공하면 이름과 byte 수만 올린다", async () => {
  let seen: unknown;
  let during = "";
  const core: SecretCore = {
    upload(_resource, _method, input, bytes) {
      seen = input;
      during = new TextDecoder().decode(bytes);
      return Promise.resolve({ ok: true, value: {} });
    },
  };
  const reply = await submitSecret(core, { name: "API_KEY", value: VALUE });
  assert.deepEqual(reply, { ok: true });
  assert.equal(during, VALUE);
  assert.deepEqual(seen, { name: "API_KEY", bytes: VALUE.length });
});

test("provider API key는 앞뒤 공백을 떼고 올리며 내부 공백·줄바꿈은 올리지 않고 거절한다", async () => {
  const uploaded: Array<{ resource: string; method: string; value: string }> =
    [];
  const core: SecretCore = {
    upload(resource, method, _input, bytes) {
      uploaded.push({
        resource,
        method,
        value: new TextDecoder().decode(bytes),
      });
      return Promise.resolve({ ok: true, value: {} });
    },
  };

  for (const bad of ["   \n\t ", "sk-ant-123 extra", "sk-ant-123\nsecond"]) {
    assert.deepEqual(
      await connectProviderKey(core, { definition: "anthropic" }, bad),
      { ok: false, code: "invalid_input" },
    );
    assert.deepEqual(
      await submitSecret(core, {
        name: "provider.01h455vb4pex5v6nkc6gd5fd10",
        value: bad,
      }),
      { ok: false, code: "invalid_input" },
    );
  }
  assert.equal(uploaded.length, 0);

  assert.deepEqual(
    await connectProviderKey(core, { definition: "anthropic" }, `  ${VALUE}\n`),
    { ok: true },
  );
  assert.deepEqual(
    await submitSecret(core, {
      name: "provider.01h455vb4pex5v6nkc6gd5fd10",
      value: `\t${VALUE}  `,
    }),
    { ok: true },
  );
  // 일반 secret(예: passphrase)은 공백을 허용한다.
  assert.deepEqual(
    await submitSecret(core, { name: "API_KEY", value: "pass phrase" }),
    { ok: true },
  );
  assert.deepEqual(uploaded, [
    { resource: "providers", method: "connect-key", value: VALUE },
    { resource: "secrets", method: "put", value: VALUE },
    { resource: "secrets", method: "put", value: "pass phrase" },
  ]);
});
