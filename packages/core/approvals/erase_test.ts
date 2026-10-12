import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../base/mod.ts";
import type { Tx } from "../../protocol/server/mod.ts";
import { APPROVAL_BLOB_OWNER_KIND } from "../../protocol/approvals/mod.ts";
import { applyMigrations } from "../storage/migration/mod.ts";
import { LEDGER_SCHEMA_STEPS, openConnection } from "../storage/ledger/mod.ts";
import { APPROVAL_SCHEMA_STEPS, eraseApprovalRequests } from "./mod.ts";

// session delete가 그 session의 run이 낸 approval request를 사용 기록·본문 참조와 함께 지운다
// (lophn-agent/conversation#R20). 평소에는 지우지 않는다(platform/approvals 불변 조건).

async function open() {
  const dir = await Deno.makeTempDir({ prefix: "approval-erase-" });
  const path = `${dir}/ledger.db`;
  const applied = await applyMigrations(
    path,
    [...LEDGER_SCHEMA_STEPS, ...APPROVAL_SCHEMA_STEPS],
    { clock: manualClock(Date.UTC(2026, 0, 1)) },
  );
  assert(applied.ok, "migrate");
  const opened = openConnection(path);
  assert(opened.ok, "open");
  const db = opened.value;
  const event = () =>
    Number(
      db.sql.run(
        `insert into events (type, subject, actor, run, payload, at)
         values ('Fact', null, 'machine', null, '{}', 'now')`,
        [],
      ).lastInsertRowid,
    );
  for (const [approval, run] of [["apr_1", "run_1"], ["apr_2", "run_2"]]) {
    db.sql.run(
      `insert into approval_requests (id, requester, run, reason_blob, effect, action,
         action_binding_hash, session_grantable, status, grant_scope, created_seq, closed_seq)
       values (?, 'agent', ?, 'r', 'write', 'a', 'h', 0, 'granted', 'once', ?, ?)`,
      [approval!, run!, event(), event()],
    );
    db.sql.run(
      "insert into approval_uses (approval, concern, receipt, accepted_seq) values (?, 'c', 'r', ?)",
      [approval!, event()],
    );
    db.sql.run(
      `insert into blob_refs (owner_kind, owner_key, field, hash, size_bytes, registered_seq)
       values (?, ?, 'reason', ?, 1, ?)`,
      [APPROVAL_BLOB_OWNER_KIND, approval!, "a".repeat(64), event()],
    );
  }
  return db;
}

Deno.test("platform/approvals#R1 [agent-I12b]: erasing removes the requests of the given runs with their uses and text refs", async () => {
  const db = await open();
  try {
    assert(eraseApprovalRequests({ sql: db.sql } as Tx, ["run_1"]).ok);
    for (
      const [table, column] of [
        ["approval_requests", "id"],
        ["approval_uses", "approval"],
        ["blob_refs", "owner_key"],
      ]
    ) {
      assertEquals(
        db.sql.all(`select ${column} as k from ${table}`, []),
        [{ k: "apr_2" }],
        table,
      );
    }
    assertEquals(db.sql.all("select * from erase_windows", []), []);
  } finally {
    db.close();
  }
});

Deno.test("platform/approvals#R1 [agent-I12b]: a request and its use are still never deleted outside an erase", async () => {
  const db = await open();
  try {
    for (const table of ["approval_uses", "approval_requests"]) {
      let refused = false;
      try {
        db.sql.run(`delete from ${table}`, []);
      } catch {
        refused = true;
      }
      assert(refused, table);
    }
  } finally {
    db.close();
  }
});
