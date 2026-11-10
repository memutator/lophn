import assert from "node:assert/strict";
import { test } from "node:test";
import { desiredFromBundle } from "./desired.ts";

// 구독 handler가 선언한 handler 이름에서 빠지면 앱이 등록한 handler가 "선언하지 않음"으로 거절되어 release가 뜨지 않았다.
test("bundle의 필수 handler와 등록해도 되는 구독 handler(on.<source>.<event>)를 나눠 낸다", () => {
  const desired = desiredFromBundle(
    {
      root: "/r",
      manifest: {} as never,
      entry: "/r/main.ts",
      operations: [{ name: "page", title: "Page", effect: "read" }],
      commands: [],
      subscriptions: [{ source: "masup", event: "usage.limit" }],
      dataSchema: 0,
    },
    {
      app: "app_1",
      release: "rel_1",
      bundleHash: "b".repeat(64),
      runEnabled: true,
      archived: false,
      dataSchema: 0,
      dataPath: "/d",
    },
  );
  assert.deepStrictEqual(desired.tools, ["page"]);
  assert.deepStrictEqual(desired.subscribed, ["on.masup.usage.limit"]);
});
