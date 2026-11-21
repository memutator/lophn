import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type { MemoryHandler } from "../../server/mod.ts";
import { phoneRequestHandler } from "./handler.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";

// 화면만 쓰는 기능을 폰에 묻는 길이 열려 있으면 폰이 화면 길과 다른 확인(앞에 있는지, 허락)으로 그 기능을 돌리게 된다.
test("app_phone.request는 화면만 쓰는 기능을 폰에 묻지 않고 invalid_input으로 거절하고 backend가 쓰는 기능은 묻는다", async () => {
  const asked: string[] = [];
  const handler = phoneRequestHandler({
    appStatus: () => "active",
    phone: () => ({
      primary: async () => ok("dev_1"),
      call: async ({ kind }) => {
        asked.push(kind);
        return ok({ online: true, type: "wifi" });
      },
    }),
  });
  const call = (capability: string, input: unknown = {}) =>
    (handler as MemoryHandler)(
      { actor: `app:${APP}` } as never,
      { capability, input } as never,
    );

  for (const capability of ["haptics.play", "clipboard.read", "code.scan"]) {
    const refused = await call(capability);
    assert.ok(!refused.ok);
    assert.equal(refused.error.code, "invalid_input");
  }
  assert.deepEqual(asked, []);

  const answered = await call("network.get");
  assert.deepEqual(answered, ok({ value: { online: true, type: "wifi" } }));
  assert.deepEqual(asked, ["network.get"]);
});
