import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import type { GrantPermissionRequirement } from "../../../protocol/apps/mod.ts";
import { permissionsSchemaSteps } from "./schema.ts";
import { compareFacts } from "./facts.ts";
import { syncAppGrants } from "./commands.ts";
import { loadGrants } from "./store.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzzzzzza";

function open() {
  const db = new DatabaseSync(":memory:");
  db.exec("CREATE TABLE apps (id TEXT PRIMARY KEY, source_path TEXT)");
  db.exec(`INSERT INTO apps VALUES ('${APP}', NULL)`);
  for (const step of permissionsSchemaSteps) db.exec(step.sql);
  let n = 0;
  const tx = {
    sql: {
      run: (sql: string, params: never[]) => {
        const result = db.prepare(sql).run(...params);
        return {
          changes: result.changes,
          lastInsertRowid: result.lastInsertRowid,
        };
      },
      get: (sql: string, params: never[]) =>
        db.prepare(sql).get(...params) as Record<string, never> | undefined,
      all: (sql: string, params: never[]) =>
        db.prepare(sql).all(...params) as Record<string, never>[],
    },
    newId: () =>
      `grt_01hzzzzzzzzzzzzzzzzzzzz${
        String(++n).padStart(3, "0")
      }` as `grt_${string}`,
    now: () => "2026-10-16T00:00:00.000Z",
  };
  return { db, tx };
}

const net = (host: string): GrantPermissionRequirement => ({
  kind: "net.fetch",
  scope: { host, port: 443 },
  reason: "test",
});

test("넓어진 선언은 사람이 허락하기 전에 앱 grant가 되지 않는다", () => {
  const { db, tx } = open();
  try {
    const one = { permissions: [net("a.example")], app_connections: [] };
    const two = {
      permissions: [net("a.example"), net("b.example")],
      app_connections: [],
    };
    const active = () => {
      const loaded = loadGrants(tx.sql, { app: APP, status: "active" });
      assert.ok(loaded.ok);
      return loaded.value;
    };
    const hosts = () =>
      active().map((grant) => (grant.scope as { host: string }).host).sort();

    // 처음에는 허락으로 만든다.
    assert.ok(syncAppGrants(tx, APP, one, "granted").ok);
    assert.deepStrictEqual(hosts(), ["a.example"]);

    // ① 선언이 같으면 비교가 비고 grant는 그대로다.
    assert.deepStrictEqual(compareFacts(active(), one), {
      added_resources: [],
      added_tools: [],
    });
    const before = active();
    assert.ok(syncAppGrants(tx, APP, one, "not_needed").ok);
    assert.deepStrictEqual(active(), before);

    // ② 새 host는 목록에 뜨고 허락 없이는 grant가 되지 않는다.
    assert.deepStrictEqual(compareFacts(active(), two).added_resources, [
      "net.fetch:b.example:443",
    ]);
    assert.ok(syncAppGrants(tx, APP, two, "not_needed").ok);
    assert.deepStrictEqual(hosts(), ["a.example"]);

    // ③ 허락하면 만든다.
    assert.ok(syncAppGrants(tx, APP, two, "granted").ok);
    assert.deepStrictEqual(hosts(), ["a.example", "b.example"]);

    // ④ 선언에서 빠진 항목의 grant는 거둔다.
    const removed = syncAppGrants(tx, APP, one, "not_needed");
    assert.ok(removed.ok);
    assert.deepStrictEqual(removed.value.revoked.length, 1);
    assert.deepStrictEqual(hosts(), ["a.example"]);

    // ⑤ 거둔 grant는 다시 active가 되지 않는다.
    const revokedId = removed.value.revoked[0].id;
    let reopened = false;
    try {
      tx.sql.run(
        "UPDATE grants SET status = 'active', revoked_at = NULL WHERE id = ?",
        [revokedId] as never[],
      );
      reopened = true;
    } catch {
      // trigger가 거절한다.
    }
    assert.deepStrictEqual(reopened, false);
    assert.ok(syncAppGrants(tx, APP, two, "granted").ok);
    const b = loadGrants(tx.sql, { app: APP, status: "active" });
    assert.ok(b.ok && b.value.every((grant) => grant.id !== revokedId));
  } finally {
    db.close();
  }
});
