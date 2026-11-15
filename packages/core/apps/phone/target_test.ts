import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { DEVICES_SCHEMA_STEPS } from "../../remote/devices.ts";
import { phoneTargetRead } from "./target.ts";

// agent가 읽는 값이라 기기 id와 공개 key가 새면 안 된다. 기준 기기가 없으면 null이다.
test("app.phone_target은 기준 기기의 크기만 싣고 id와 key를 싣지 않으며, 없으면 null이다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(DEVICES_SCHEMA_STEPS[0]!.sql);
  const snapshot = {
    as_of_seq: "1",
    sql: {
      get: (text: string, params: unknown[]) =>
        db.prepare(text).get(...(params as never[])) as
          | Record<string, unknown>
          | undefined,
    },
  };
  const read = () => phoneTargetRead.handle(snapshot as never, {} as never, {});
  const none = read();
  assert.ok(none.ok);
  assert.equal(none.value.device, null);

  const add = db.prepare(
    "insert into devices values (?, ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', null, ?)",
  );
  add.run("dev_a", "Old", "android", 360, 780, 3, "KEY_A", 0);
  add.run("dev_b", "Pixel", "ios", 390, 844, 3, "KEY_B", 1);
  const found = read();
  assert.ok(found.ok);
  assert.deepStrictEqual(found.value.device, {
    name: "Pixel",
    os: "ios",
    width: 390,
    height: 844,
    dpr: 3,
  });
});
