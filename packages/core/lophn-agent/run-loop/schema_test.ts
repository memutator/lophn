import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { turnSchemaSteps } from "./schema.ts";

const OLD_LIMITS = JSON.stringify({
  model_attempts: 150,
  stall_ms: 300_000,
  active_ms: 1_800_000,
});

function insertTurn(db: DatabaseSync, id: string, finished: boolean): void {
  db.prepare(
    `insert into turns (id, session, input_message, state, basis, started_at, limits, mode,
       finished_at, outcome_kind, outcome_reason, result, state_seq)
     values (?, 'ses_1', ?, ?, 'basis', '2026-10-01T00:00:00Z', ?, 'attended', ?, ?, ?, ?, 1)`,
  ).run(
    id,
    `msg_${id}`,
    finished ? "finished" : "running",
    OLD_LIMITS,
    finished ? "2026-10-01T00:30:00Z" : null,
    finished ? "failed" : null,
    finished ? "active_limit" : null,
    finished ? "facts" : null,
  );
}

test("drop-active-limit removes active_ms from started turns and keeps them fixed", () => {
  const db = new DatabaseSync(":memory:");
  const [tables, ...later] = turnSchemaSteps;
  db.exec(tables.sql);
  insertTurn(db, "trn_done", true);
  insertTurn(db, "trn_running", false);
  for (const step of later) db.exec(step.sql);

  const rows = db
    .prepare("select id, limits, outcome_reason from turns order by id")
    .all() as { id: string; limits: string; outcome_reason: string | null }[];
  for (const row of rows) {
    assert.deepEqual(JSON.parse(row.limits), {
      model_attempts: 150,
      stall_ms: 300_000,
    });
  }
  assert.equal(rows[0].outcome_reason, "active_limit");

  assert.throws(
    () => db.exec("update turns set limits = '{}' where id = 'trn_running'"),
    /fixed once started/,
  );
  assert.throws(
    () =>
      db.exec("update turns set elapsed_stall_ms = 1 where id = 'trn_done'"),
    /never reopened/,
  );
});
