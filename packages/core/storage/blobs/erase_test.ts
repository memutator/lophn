import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/platform/mod.ts";
import { applyMigrations } from "../migration/mod.ts";
import { LEDGER_SCHEMA_STEPS, openConnection } from "../ledger/mod.ts";
import { eraseBlobRefs } from "./mod.ts";

// 사람이 요청한 session delete가 지운 기록의 본문 참조만 지운다(lophn-agent/conversation#R20).
// 평소의 blob 영구 참조는 지우거나 바꾸지 않는다(platform/blob-store#R4).

async function open() {
  const dir = await Deno.makeTempDir({ prefix: "blob-erase-" });
  const path = `${dir}/ledger.db`;
  const applied = await applyMigrations(path, LEDGER_SCHEMA_STEPS, {
    clock: manualClock(Date.UTC(2026, 0, 1)),
  });
  assert(applied.ok, "migrate");
  const opened = openConnection(path);
  assert(opened.ok, "open");
  const db = opened.value;
  const event = Number(
    db.sql.run(
      `insert into events (type, subject, actor, run, payload, at)
       values ('Fact', null, 'machine', null, '{}', 'now')`,
      [],
    ).lastInsertRowid,
  );
  for (
    const [kind, owner, hash] of [
      ["model_call", "mcl_1", "a"],
      ["model_call", "mcl_2", "b"],
      ["tool_call", "mcl_1", "c"],
    ]
  ) {
    db.sql.run(
      `insert into blob_refs (owner_kind, owner_key, field, hash, size_bytes, registered_seq)
       values (?, ?, 'input', ?, 1, ?)`,
      [kind!, owner!, hash!.repeat(64), event],
    );
  }
  return db;
}

Deno.test("platform/blob-store#R4 [agent-I12b]: erasing removes the refs of the named owners only", async () => {
  const db = await open();
  try {
    const result = eraseBlobRefs({ sql: db.sql } as Tx, "model_call", [
      "mcl_1",
    ]);
    assert(result.ok);
    const left = db.sql.all(
      "select owner_kind, owner_key from blob_refs order by hash",
      [],
    );
    assertEquals(left, [
      { owner_kind: "model_call", owner_key: "mcl_2" },
      { owner_kind: "tool_call", owner_key: "mcl_1" },
    ]);
  } finally {
    db.close();
  }
});

Deno.test("platform/blob-store#R4 [agent-I12b]: a ref is still never deleted or changed outside an erase", async () => {
  const db = await open();
  try {
    assert(eraseBlobRefs({ sql: db.sql } as Tx, "run", ["run_1"]).ok);
    for (
      const sql of [
        "delete from blob_refs",
        "update blob_refs set size_bytes = 2",
      ]
    ) {
      let refused = false;
      try {
        db.sql.run(sql, []);
      } catch {
        refused = true;
      }
      assert(refused, sql);
    }
    // 지운 뒤 창이 닫혀 있다.
    assertEquals(db.sql.all("select * from erase_windows", []), []);
    assertEquals(db.sql.all("select * from blob_refs", []).length, 3);
  } finally {
    db.close();
  }
});
