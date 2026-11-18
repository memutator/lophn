import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import {
  invocationEventCallerSchemaSteps,
  invocationsRemoteCallerSchemaSteps,
  invocationsSchemaSteps,
} from "./schema.ts";

// 옛 호출 기록의 대상(`tool`)을 command로 옮기고, 끝난 행을 잠그는 trigger를 되살린다.
test("operation-kinds step은 옛 tool 기록을 command로 옮기고 종료한 행의 잠금을 유지한다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(invocationsSchemaSteps[0].sql);
  const insert = db.prepare(
    `INSERT INTO invocations (id, app, release, mode, operation, effect, status, finished_at, summary)
     VALUES (?, 'app_1', 'rel_1', 'live', ?, 'write', 'succeeded', '2026-10-16T00:00:00.000Z', '{}')`,
  );
  insert.run("inv_1", JSON.stringify({ kind: "tool", tool: "items.add" }));
  insert.run("inv_2", JSON.stringify({ kind: "data_change", from: 1, to: 2 }));
  db.exec(invocationsSchemaSteps[1].sql);

  const rows = db
    .prepare("SELECT id, operation FROM invocations ORDER BY id")
    .all() as { id: string; operation: string }[];
  assert.deepStrictEqual(
    rows.map((row) => JSON.parse(row.operation)),
    [
      { kind: "command", name: "items.add" },
      { kind: "data_change", from: 1, to: 2 },
    ],
  );
  assert.throws(
    () => db.exec("UPDATE invocations SET effect = 'read' WHERE id = 'inv_1'"),
    /terminal invocation is immutable/,
  );
});

// 사람의 ledger에서 caller 종류에 `event`를 더하려고 표를 다시 짠다. 옛 행, index, trigger가 하나도 빠지면 안 된다.
test("event-caller step은 표를 다시 짜도 모든 행과 index와 trigger를 그대로 두고 event caller를 받는다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(invocationsSchemaSteps[0].sql);
  db.exec(invocationsSchemaSteps[1].sql);
  // apps.delete.erase-windows가 바꾼 지금 모양의 지우기 막기.
  db.exec(`
    CREATE TABLE erase_windows (table_name TEXT);
    DROP TRIGGER invocations_no_delete;
    CREATE TRIGGER invocations_no_delete BEFORE DELETE ON invocations
    WHEN NOT EXISTS (SELECT 1 FROM erase_windows WHERE table_name = 'invocations')
    BEGIN SELECT RAISE(ABORT, 'invocations are recorded, not deleted'); END;
  `);
  const hash = "a".repeat(64);
  const callers = [
    { kind: "person", view_session: "v" },
    { kind: "agent", session: "ses_1", turn: "trn_1", tool_call: "tcl_1" },
    { kind: "app", app: "app_1", release: "rel_1", parent_invocation: null },
    { kind: "program", job: "job_1", job_run: "jbr_1" },
    { kind: "flow", instance: "wfi_1" },
    null,
  ];
  const insert = db.prepare(
    `INSERT INTO invocations
       (id, app, release, mode, operation, caller, caller_kind, session, turn, effect, status,
        started_at, finished_at, input_hash, summary, changeset_hash, changeset_size, reverted_by)
     VALUES (?, 'app_1', 'rel_1', 'live', '{"kind":"command","name":"x"}', ?, ?, ?, ?, 'write', 'succeeded',
        '2026-10-16T00:00:00.000Z', '2026-10-16T00:00:01.000Z', ?, '{}', ?, 10, 'rwd_1')`,
  );
  callers.forEach((caller, index) => {
    insert.run(
      `inv_${index}`,
      caller === null ? null : JSON.stringify(caller),
      caller?.kind ?? null,
      caller?.kind === "agent" ? "ses_1" : null,
      caller?.kind === "agent" ? "trn_1" : null,
      hash,
      hash,
    );
  });
  const schemaOf = () =>
    (
      db
        .prepare(
          `SELECT name, sql FROM sqlite_master
            WHERE tbl_name = 'invocations' AND type IN ('index', 'trigger') AND sql IS NOT NULL
            ORDER BY name`,
        )
        .all() as { name: string; sql: string }[]
    ).map((row) => [row.name, row.sql]);
  const rowsOf = () =>
    db.prepare("SELECT * FROM invocations ORDER BY id").all();
  const beforeRows = rowsOf();
  const beforeSchema = schemaOf();
  assert.equal(beforeRows.length, callers.length);

  db.exec(invocationEventCallerSchemaSteps[0].sql);

  assert.deepStrictEqual(rowsOf(), beforeRows);
  assert.deepStrictEqual(schemaOf(), beforeSchema);
  db.prepare(
    `INSERT INTO invocations
       (id, app, release, mode, operation, caller, caller_kind, effect, status, finished_at, summary)
     VALUES ('inv_event', 'app_1', 'rel_1', 'live', '{"kind":"operation","name":"on.masup.usage.limit"}',
        '{"kind":"event"}', 'event', 'write', 'succeeded', '2026-10-16T00:00:00.000Z', '{}')`,
  ).run();
  assert.throws(
    () =>
      db.exec("UPDATE invocations SET effect = 'read' WHERE id = 'inv_event'"),
    /terminal invocation is immutable/,
  );
  assert.throws(
    () => db.exec("DELETE FROM invocations WHERE id = 'inv_event'"),
    /invocations are recorded, not deleted/,
  );
});

// 이 표는 지난 호출의 기록이다. caller 종류에 `remote`를 더하려고 표를 다시 짜도 지난 행과 index, trigger가 그대로여야 한다.
test("remote-caller step은 표를 다시 짜도 모든 행과 index와 trigger를 그대로 두고 remote caller를 받는다", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of invocationsSchemaSteps) db.exec(step.sql);
  db.exec(`CREATE TABLE erase_windows (table_name TEXT);`);
  db.exec(invocationEventCallerSchemaSteps[0].sql);
  const hash = "a".repeat(64);
  const callers = [
    { kind: "person", view_session: "v" },
    { kind: "agent", session: "ses_1", turn: "trn_1", tool_call: "tcl_1" },
    { kind: "app", app: "app_1", release: "rel_1", parent_invocation: null },
    { kind: "program", job: "job_1", job_run: "jbr_1" },
    { kind: "flow", instance: "wfi_1" },
    { kind: "event", publisher: "lophn" },
  ];
  const insert = db.prepare(
    `INSERT INTO invocations
       (id, app, release, mode, operation, caller, caller_kind, session, turn, effect, status,
        started_at, finished_at, input_hash, summary, detail_hash, changeset_hash, changeset_size, reverted_by)
     VALUES (?, 'app_1', 'rel_1', 'live', '{"kind":"command","name":"x"}', ?, ?, ?, ?, 'write', 'succeeded',
        '2026-10-16T00:00:00.000Z', '2026-10-16T00:00:01.000Z', ?, '{}', ?, ?, 10, 'rwd_1')`,
  );
  callers.forEach((caller, index) => {
    insert.run(
      `inv_${index}`,
      JSON.stringify(caller),
      caller.kind,
      caller.kind === "agent" ? "ses_1" : null,
      caller.kind === "agent" ? "trn_1" : null,
      hash,
      hash,
      hash,
    );
  });
  // 어느 열을 옮기다 빠뜨려도 잡히려면 모든 열이 어느 행에선가 값을 가져야 한다.
  const columns = db.prepare("PRAGMA table_info(invocations)").all() as {
    name: string;
  }[];
  for (const { name } of columns) {
    const filled = db
      .prepare(
        `SELECT count(*) AS n FROM invocations WHERE ${name} IS NOT NULL`,
      )
      .get() as { n: number };
    assert.ok(filled.n > 0, `column ${name} is filled in a fixture row`);
  }
  // 표의 정의(열과 CHECK)도 index·trigger와 같이 본다. caller 종류 목록만 달라야 한다.
  const schemaOf = (callerKinds = "") =>
    (
      db
        .prepare(
          `SELECT name, sql FROM sqlite_master
            WHERE tbl_name = 'invocations' AND sql IS NOT NULL
            ORDER BY name`,
        )
        .all() as { name: string; sql: string }[]
    ).map((row) => ({ ...row, sql: row.sql.replace(callerKinds, "") }));
  const rowsOf = () =>
    db.prepare("SELECT * FROM invocations ORDER BY id").all();
  const beforeRows = rowsOf();
  const beforeSchema = schemaOf();
  assert.equal(beforeRows.length, callers.length);
  assert.throws(() =>
    db.exec(
      `INSERT INTO invocations (id, app, release, mode, operation, caller, caller_kind, effect, status, finished_at, summary)
       VALUES ('inv_early', 'app_1', 'rel_1', 'live', '{"kind":"command","name":"x"}', '{"kind":"remote"}', 'remote', 'write', 'succeeded', '2026-10-16T00:00:00.000Z', '{}')`,
    ),
  );

  db.exec(invocationsRemoteCallerSchemaSteps[0].sql);

  assert.deepStrictEqual(rowsOf(), beforeRows);
  assert.deepStrictEqual(schemaOf(", 'remote'"), beforeSchema);
  db.exec(
    `INSERT INTO invocations (id, app, release, mode, operation, caller, caller_kind, effect, status, finished_at, summary)
     VALUES ('inv_remote', 'app_1', 'rel_1', 'live', '{"kind":"command","name":"x"}',
        '{"kind":"remote"}', 'remote', 'write', 'succeeded', '2026-10-16T00:00:00.000Z', '{}')`,
  );
  assert.throws(
    () =>
      db.exec("UPDATE invocations SET effect = 'read' WHERE id = 'inv_remote'"),
    /terminal invocation is immutable/,
  );
  assert.throws(
    () => db.exec("DELETE FROM invocations WHERE id = 'inv_remote'"),
    /invocations are recorded, not deleted/,
  );
});
