import { assert, assertEquals, assertThrows } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { schemaSql } from "./support.ts";

function open(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec("PRAGMA recursive_triggers=ON");
  db.exec(schemaSql());
  return db;
}

Deno.test("problems/tests#R5: INSERT OR REPLACE와 UPDATE는 기록을 바꾸지 못한다", () => {
  const db = open();
  db.prepare(
    `insert into test_requests (
       seq, request_principal, request_key, request_hash, phase, accepted,
       preparation_failed, at, start_unknown, result_ref, runner_principal,
       reason, payload
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    1n,
    "user-1",
    "key-1",
    "a".repeat(64),
    "accepted",
    1,
    0,
    "2026-10-04T00:00:00.000Z",
    0,
    null,
    "runner-1",
    "accepted",
    "{}",
  );
  assertThrows(() =>
    db.prepare(
      `insert or replace into test_requests (
         seq, request_principal, request_key, request_hash, phase, accepted,
         preparation_failed, at, start_unknown, result_ref, runner_principal,
         reason, payload
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      1n,
      "user-1",
      "key-1",
      "a".repeat(64),
      "accepted",
      1,
      0,
      "2026-10-04T00:00:00.000Z",
      0,
      null,
      "runner-1",
      "rewritten",
      "{}",
    )
  );
  assertThrows(() =>
    db.prepare(`update test_requests set reason = ? where seq = ?`).run(
      "rewritten",
      1n,
    )
  );
  const row = db.prepare(`select seq, reason from test_requests`).get() as {
    seq: number | bigint;
    reason: string;
  };
  assertEquals(row.seq, 1);
  assertEquals(row.reason, "accepted");
  const wide = (1n << 53n) + 3n;
  db.prepare(
    `insert into test_requests (
       seq, request_principal, request_key, request_hash, phase, accepted,
       preparation_failed, at, start_unknown, result_ref, runner_principal,
       reason, payload
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    wide,
    "user-1",
    "key-2",
    "b".repeat(64),
    "accepted",
    1,
    0,
    null,
    0,
    null,
    "runner-1",
    "accepted",
    "{}",
  );
  const stored = db.prepare(
    `select cast(seq as text) as seq from test_requests where request_key = ?`,
  ).get("key-2") as { seq: string };
  assertEquals(stored.seq, wide.toString());
  db.close();
});

Deno.test("problems/tests#R5: side 시작과 verification도 replace가 거절된다", () => {
  const db = open();
  db.prepare(
    `insert into test_side_starts (
       seq, request_principal, request_key, request_hash, runner_principal,
       side, bundle_hash, test_hash, started_at
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    1n,
    "user-1",
    "key-1",
    "a".repeat(64),
    "runner-1",
    "single",
    "a".repeat(64),
    "a".repeat(64),
    "2026-10-04T00:00:02.000Z",
  );
  assertThrows(() =>
    db.prepare(
      `insert or replace into test_side_starts (
         seq, request_principal, request_key, request_hash, runner_principal,
         side, bundle_hash, test_hash, started_at
       ) values (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      2n,
      "user-1",
      "key-1",
      "a".repeat(64),
      "runner-2",
      "single",
      "b".repeat(64),
      "b".repeat(64),
      "2026-10-04T00:00:09.000Z",
    )
  );
  const kept = db.prepare(`select runner_principal from test_side_starts`)
    .get() as {
      runner_principal: string;
    };
  assertEquals(kept.runner_principal, "runner-1");
  db.prepare(
    `insert into verifications (
       id, request_principal, request_key, request_hash, kind, app,
       target_bundle_hash, target_release, problem, basis_seq, before_release,
       after_release, ticket, ticket_check_index, ticket_check_hash,
       ticket_completion_seq, test, execution, result, reason, observations,
       recorded_seq, verification_canonical
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    "vrf_01ary8h2z3n4p5q6r7s8t9v0wx",
    "user-1",
    "key-1",
    "a".repeat(64),
    "app_test",
    "app_01ary8h2z3n4p5q6r7s8t9v0wa",
    "a".repeat(64),
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    "a".repeat(64),
    "a".repeat(64),
    "pass",
    "ran",
    "a".repeat(64),
    "3",
    '{"reports":["rpt_01ary8h2z3n4p5q6r7s8t9v0we"]}',
  );
  assertThrows(() =>
    db.prepare(`delete from verifications where id = ?`).run(
      "vrf_01ary8h2z3n4p5q6r7s8t9v0wx",
    )
  );
  const result = db.prepare(`select result from verifications`).get() as {
    result: string;
  };
  assertEquals(result.result, "pass");
  const id = "vrf_01ary8h2z3n4p5q6r7s8t9v0wx";
  const report = "rpt_01ary8h2z3n4p5q6r7s8t9v0we";
  db.prepare(
    `insert into verification_reports (verification, report) values (?, ?)`,
  ).run(id, report);
  for (
    const sql of [
      `insert or replace into verification_reports (verification, report) values (?, ?)`,
      `replace into verification_reports (verification, report) values (?, ?)`,
      `insert into verification_reports (verification, report) values (?, ?) on conflict (verification, report) do update set report = excluded.report`,
    ]
  ) {
    assertThrows(() => db.prepare(sql).run(id, report));
  }
  assertEquals(
    (db.prepare(`select count(*) as n from verification_reports`).get() as {
      n: number;
    }).n,
    1,
  );
  assert(db.prepare(`select count(*) as n from verifications`).get());
  db.close();
});
