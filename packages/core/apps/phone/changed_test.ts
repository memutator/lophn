import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import { createPhoneChangedWatch } from "./changed.ts";

// 알림 규칙: 기준 id가 바뀔 때만(이름 바꾸기·연결 갱신은 같은 id), 폰 화면 앱이 있을 때만.
test("phone_changed is recorded only when the primary device id changes and phone-screen apps exist", async () => {
  let primary: string | null = "dev_a";
  let apps = 2;
  const recorded: unknown[] = [];
  const watch = createPhoneChangedWatch({
    primaryId: () => primary,
    phoneScreenApps: () => apps,
    record: (input) => {
      recorded.push(input);
      return Promise.resolve(ok({ id: "ntc_1" }));
    },
  });
  const devices = [{ name: "remote_devices" as const, id: null }];

  await watch.onStateChanged(devices);
  await watch.onStateChanged([{ name: "notices", id: null }]);
  assert.deepStrictEqual(recorded, []);

  primary = "dev_b";
  await watch.onStateChanged([{ name: "notices", id: null }]);
  assert.deepStrictEqual(recorded, []);
  await watch.onStateChanged(devices);
  assert.deepStrictEqual(recorded, [
    { kind: "phone_changed", key: "phone_changed", params: { apps: 2 } },
  ]);

  // 기준을 지우면 알리지 않고, 그 뒤 다른 기기가 기준이 되면 알린다.
  recorded.length = 0;
  primary = null;
  await watch.onStateChanged(devices);
  primary = "dev_c";
  await watch.onStateChanged(devices);
  assert.equal(recorded.length, 1);

  // 폰 화면 앱이 없으면 알리지 않고, 그 기준 id는 본 것으로 친다.
  recorded.length = 0;
  apps = 0;
  primary = "dev_d";
  await watch.onStateChanged(devices);
  apps = 1;
  await watch.onStateChanged(devices);
  assert.deepStrictEqual(recorded, []);
});
