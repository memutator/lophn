import assert from "node:assert/strict";
import { test } from "node:test";

import { type SecretCore, submitSecret } from "./submit.ts";

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
