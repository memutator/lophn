import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  DEVICES_KIND_STEPS,
  DEVICES_SCHEMA_STEPS,
  ROSTER_SCHEMA_STEPS,
} from "../../remote/devices.ts";
import { phoneTargetRead } from "./target.ts";

// agent가 읽는 값이라 기기 id와 공개 key가 새면 안 된다. 기준 기기가 없으면 null이다. 이름은 명단의 이름이다.
test("app.phone_target은 기준 기기의 크기와 명단의 이름만 싣고 id와 key를 싣지 않으며, 없으면 null이다", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of [
    ...DEVICES_SCHEMA_STEPS,
    ...DEVICES_KIND_STEPS,
    ...ROSTER_SCHEMA_STEPS,
  ])
    db.exec(step.sql);
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
    "insert into devices (id, kind, name, os, width, height, dpr, public_key, created_at, is_primary) values (?, 'phone', ?, ?, ?, ?, ?, ?, '2026-01-01T00:00:00.000Z', ?)",
  );
  add.run("dev_a", "Old", "android", 360, 780, 3, "KEY_A", 0);
  add.run("dev_b", "Pixel", "ios", 390, 844, 3, "KEY_B", 1);
  const unnamed = read();
  assert.ok(unnamed.ok);
  assert.equal(unnamed.value.device?.name, "Pixel");

  // 명단을 저장하면 view의 이름이 행의 alias에 든다(다른 컴퓨터에서 바꾼 이름).
  db.prepare("update devices set alias = ? where id = ?").run(
    "Work phone",
    "dev_b",
  );
  const found = read();
  assert.ok(found.ok);
  assert.deepStrictEqual(found.value.device, {
    name: "Work phone",
    os: "ios",
    width: 390,
    height: 844,
    dpr: 3,
  });
});
