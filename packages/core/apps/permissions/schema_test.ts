import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import {
  PERMISSIONS_PHONE_KIND_STEPS,
  permissionsSchemaSteps,
} from "./schema.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";

// 사람의 data root가 이 step을 돈다. 표를 다시 만들어도 grant를 잃거나 규칙이 풀리면 안 된다.
test("phone_kind keeps every grant row, index and trigger and accepts phone.use", () => {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA foreign_keys = ON");
  db.exec("CREATE TABLE apps (id TEXT PRIMARY KEY)");
  db.exec(`INSERT INTO apps VALUES ('${APP}')`);
  for (const step of permissionsSchemaSteps) db.exec(step.sql);

  const insert = db.prepare(
    "INSERT INTO grants (id, app, kind, scope, status, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  const rows = [
    [
      "grt_1",
      APP,
      "net.fetch",
      '{"host":"a.example","port":443}',
      "active",
      "2026-10-01T00:00:00.000Z",
      null,
    ],
    [
      "grt_2",
      APP,
      "notify.send",
      "{}",
      "active",
      "2026-10-02T00:00:00.000Z",
      null,
    ],
    [
      "grt_3",
      APP,
      "secret.use",
      '{"name":"TOKEN"}',
      "revoked",
      "2026-10-03T00:00:00.000Z",
      "2026-10-04T00:00:00.000Z",
    ],
    [
      "grt_4",
      APP,
      "app.call",
      '{"app":"app_x","app_tools":["a"]}',
      "active",
      "2026-10-05T00:00:00.000Z",
      null,
    ],
  ] as const;
  for (const row of rows) insert.run(...row);
  const schemaOf = () =>
    db
      .prepare(
        "SELECT type, name, sql FROM sqlite_master WHERE tbl_name = 'grants' AND type IN ('index', 'trigger') ORDER BY name",
      )
      .all();
  const before = schemaOf();

  for (const step of PERMISSIONS_PHONE_KIND_STEPS) db.exec(step.sql);

  assert.deepStrictEqual(
    db
      .prepare(
        "SELECT id, app, kind, scope, status, created_at, revoked_at FROM grants ORDER BY id",
      )
      .all()
      .map((row) => Object.values(row)),
    rows.map((row) => [...row]),
  );
  assert.deepStrictEqual(schemaOf(), before);

  // 규칙이 그대로 걸린다: 내용 불변, revoked는 끝, 지우지 못함, 같은 scope의 active는 하나.
  assert.throws(() =>
    db.exec("UPDATE grants SET scope = '{}' WHERE id = 'grt_1'"),
  );
  assert.throws(() =>
    db.exec(
      "UPDATE grants SET status = 'active', revoked_at = NULL WHERE id = 'grt_3'",
    ),
  );
  assert.throws(() => db.exec("DELETE FROM grants WHERE id = 'grt_2'"));
  assert.throws(() =>
    insert.run(
      "grt_5",
      APP,
      "notify.send",
      "{}",
      "active",
      "2026-10-06T00:00:00.000Z",
      null,
    ),
  );
  assert.throws(() =>
    insert.run(
      "grt_6",
      APP,
      "camera.use",
      "{}",
      "active",
      "2026-10-06T00:00:00.000Z",
      null,
    ),
  );

  insert.run(
    "grt_7",
    APP,
    "phone.use",
    '{"capability":"location.get"}',
    "active",
    "2026-10-07T00:00:00.000Z",
    null,
  );
  assert.equal(
    (
      db.prepare("SELECT kind FROM grants WHERE id = 'grt_7'").get() as {
        kind: string;
      }
    ).kind,
    "phone.use",
  );
});
