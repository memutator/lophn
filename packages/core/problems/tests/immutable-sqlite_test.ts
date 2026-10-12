import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  appendActualSideStart,
  appendRequestObservation,
  handleRequestTest,
} from "./commands.ts";
import { handleRecordVerification } from "./record.ts";
import { blob, executed, requester } from "./fixtures.ts";
import { reproductionSetup } from "./testing/reproduction.ts";
Deno.test("problems/tests#R5: file SQLite 모든 표 PK·unique replacement와 upsert는 immutable", () => {
  const {
    ledger,
    request,
    hash,
    caller,
    preparedValue,
    lifecycleProof,
    execution,
    result,
  } = reproductionSetup();
  try {
    assert(
      ledger.transaction((tx) =>
        handleRequestTest(tx, requester(), request, () => preparedValue)
      ).ok,
    );
    assert(
      ledger.transaction((tx) =>
        appendRequestObservation(tx, caller, {
          phase: "start_attempt",
          request_principal: "user-1",
          request_key: request.request_key,
          request_hash: hash,
          at: executed.started_at,
          previous_runner: null,
          runner_principal: caller.principal,
          reason: "attempt",
        }, lifecycleProof)
      ).ok,
    );
    for (const item of execution) {
      assert(
        ledger.transaction((tx) =>
          appendActualSideStart(tx, caller, {
            request_principal: "user-1",
            request_key: request.request_key,
            request_hash: hash,
            side: item.side,
            bundle_hash: item.bundle_hash,
            test_hash: item.test_hash,
            started_at: item.started_at,
          }, lifecycleProof)
        ).ok,
      );
    }
    const { value, preparedEvidence } = result();
    assert(
      ledger.transaction((tx) =>
        handleRecordVerification(tx, caller, {
          verification: value,
          blobs: blob(caller.principal, value, preparedEvidence),
        }, preparedEvidence)
      ).ok,
    );
    for (
      const table of [
        "test_requests",
        "test_side_starts",
        "verifications",
        "verification_reports",
      ]
    ) {
      const before = ledger.sql.all(`select * from ${table}`, []);
      for (
        const statement of [
          `update ${table} set ${
            table === "verification_reports"
              ? "report=report"
              : table === "verifications"
              ? "reason=reason"
              : "seq=seq"
          }`,
          `delete from ${table}`,
          `replace into ${table} select * from ${table}`,
          `insert or replace into ${table} select * from ${table}`,
          `insert into ${table} select * from ${table} where true on conflict do update set ${
            table === "verification_reports"
              ? "report=excluded.report"
              : table === "verifications"
              ? "reason=excluded.reason"
              : "seq=excluded.seq"
          }`,
        ]
      ) {
        assertThrows(() => ledger.sql.run(statement, []));
        assertEquals(ledger.sql.all(`select * from ${table}`, []), before);
      }
    }
    assertThrows(() =>
      ledger.sql.run(
        `insert or replace into verifications(rowid, id, request_principal, request_key, request_hash, kind, app, target_bundle_hash, target_release, problem, basis_seq, before_release, after_release, ticket, ticket_check_index, ticket_check_hash, ticket_completion_seq, test, execution, result, reason, observations, recorded_seq, verification_canonical) select rowid, 'vrf_01ary8h2z3n4p5q6r7s8t9v0wz', 'other', 'other', request_hash, kind, app, target_bundle_hash, target_release, problem, basis_seq, before_release, after_release, ticket, ticket_check_index, ticket_check_hash, ticket_completion_seq, test, execution, result, reason, observations, recorded_seq, verification_canonical from verifications`,
        [],
      )
    );
    assertThrows(() =>
      ledger.sql.run(
        `insert or replace into verification_reports(rowid, verification, report) select rowid, verification, 'rpt_01ary8h2z3n4p5q6r7s8t9v0wf' from verification_reports`,
        [],
      )
    );
    assertThrows(() =>
      ledger.sql.run(
        "insert or replace into test_side_starts select seq, 'other', request_key, request_hash, runner_principal, side, bundle_hash, test_hash, started_at from test_side_starts",
        [],
      )
    );
    assertThrows(() =>
      ledger.sql.run(
        "insert or replace into test_side_starts select seq+1, request_principal, request_key, request_hash, runner_principal, side, bundle_hash, test_hash, started_at from test_side_starts",
        [],
      )
    );
    assertThrows(() =>
      ledger.sql.run(
        "insert or replace into verifications select 'vrf_01ary8h2z3n4p5q6r7s8t9v0wy', request_principal, request_key, request_hash, kind, app, target_bundle_hash, target_release, problem, basis_seq, before_release, after_release, ticket, ticket_check_index, ticket_check_hash, ticket_completion_seq, test, execution, result, reason, observations, recorded_seq, verification_canonical from verifications",
        [],
      )
    );
  } finally {
    ledger.close();
  }
});
