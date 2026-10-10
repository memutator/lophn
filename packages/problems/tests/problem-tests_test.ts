// 문제 상세가 읽는 테스트 사실(problems/tests#R5, problems#T22). tests leaf의 실제 표 모양
// (`test_requests`·`verifications`·`test_evidence`)에 행을 두고 `ProblemTestPort` 구현으로 읽는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import type { Sql, SqlRow } from "../../contracts/platform/mod.ts";
import { problemTestHistory, problemTestLookup } from "./problem-tests.ts";
import { schemaSql } from "./support.ts";

const PRB = "prb_01arz3ndektsv4rrffq69g5fav";
const OTHER = "prb_01arz3ndektsv4rrffq69g5faw";

function ledger() {
  const db = new DatabaseSync(":memory:");
  db.exec(schemaSql());
  const prepare = (statement: string) => {
    const prepared = db.prepare(statement);
    prepared.setReadBigInts(true);
    return prepared;
  };
  const sql: Sql = {
    run: (statement, params) => prepare(statement).run(...params),
    get: (statement, params) =>
      prepare(statement).get(...params) as SqlRow | undefined,
    all: (statement, params) => prepare(statement).all(...params) as SqlRow[],
  };
  let seq = 0;
  const request = (
    key: string,
    phase: string,
    payload: { kind: string; problem: string | null },
    resultRef: string | null = null,
  ) => {
    seq += 1;
    sql.run(
      `insert into test_requests (seq, request_principal, request_key, request_hash,
         phase, accepted, preparation_failed, at, start_unknown, result_ref,
         runner_principal, reason, payload)
       values (?, 'user-1', ?, 'h', ?, ?, ?, ?, 0, ?, 'runner-1', 'r', ?)`,
      [
        seq,
        key,
        phase,
        phase === "accepted" ? 1 : 0,
        phase === "preparation_failed" ? 1 : 0,
        phase === "actual_started" ? "2026-10-09T00:00:01.000Z" : null,
        resultRef,
        JSON.stringify(payload),
      ],
    );
  };
  const verification = (
    id: string,
    key: string,
    kind: string,
    result: string,
    recorded: string,
    problem: string = PRB,
  ) =>
    sql.run(
      `insert into verifications (id, request_principal, request_key, request_hash,
         kind, app, target_bundle_hash, problem, test, execution, result, reason,
         observations, recorded_seq, verification_canonical)
       values (?, 'user-1', ?, 'h', ?, 'app_1', 'b', ?, 't', 'e', ?, 'r', 'o', ?, ?)`,
      [id, key, kind, problem, result, recorded, `canonical-${id}`],
    );
  const evidence = (key: string, canonical: string, ended: string[]) =>
    sql.run(
      `insert into test_evidence (request_principal, request_key, request_hash,
         runner_principal, evidence) values ('user-1', ?, 'h', ?, ?)`,
      [
        key,
        `runner-${key}-${canonical}`,
        JSON.stringify({
          verification_canonical: canonical,
          execution_evidence: ended.map((ended_at) => ({ ended_at })),
        }),
      ],
    );
  return { db, sql, request, verification, evidence };
}

Deno.test("problems/tests#R5: 접수만 됨·실제 시작·pass·fail·inconclusive가 pending·running·pass·fail·unconfirmed로 읽히고 종료 시각은 실행 증거에서 온다", () => {
  const l = ledger();
  try {
    assertEquals(problemTestLookup(l.sql, PRB), { ok: true, value: [] });
    // reproduction: 앞선 fail 뒤 pass가 지금 값이다. 종료 시각은 가장 늦은 실행 증거다.
    l.verification("vrf_1", "k1", "reproduction", "fail", "9");
    l.verification("vrf_2", "k2", "reproduction", "pass", "12");
    l.evidence("k2", "canonical-vrf_2", [
      "2026-10-09T00:00:03.000Z",
      "2026-10-09T00:00:05.000Z",
    ]);
    // 다른 Verification을 남긴 증거는 이 결과의 종료 시각이 아니다.
    l.evidence("k2", "canonical-other", ["2026-10-09T09:00:00.000Z"]);
    // app_test: inconclusive는 성공이 아니라 미확인이고, 증거가 없으면 종료 시각은 null이다.
    l.verification("vrf_3", "k3", "app_test", "inconclusive", "13");
    // 다른 문제의 결과는 싣지 않는다.
    l.verification("vrf_4", "k4", "test_command", "pass", "14", OTHER);
    l.verification("vrf_5", "k8", "test_command", "fail", "15");
    const done = problemTestLookup(l.sql, PRB);
    assertEquals(done, {
      ok: true,
      value: [
        {
          kind: "reproduction",
          state: "pass",
          ended_at: "2026-10-09T00:00:05.000Z",
        },
        { kind: "app_test", state: "unconfirmed", ended_at: null },
        { kind: "test_command", state: "fail", ended_at: null },
      ],
    });
    // 결과를 기다리는 요청이 그 종류의 지금 값이다: 접수만 됨 → pending, 실제 시작 → running.
    l.request("k5", "accepted", { kind: "app_test", problem: PRB });
    l.request("k6", "accepted", { kind: "reproduction", problem: PRB });
    l.request("k6", "actual_started", { kind: "reproduction", problem: PRB });
    // 준비 실패·결과가 붙은 요청은 기다리는 요청이 아니다.
    l.request("k7", "accepted", { kind: "test_command", problem: PRB });
    l.request("k7", "preparation_failed", {
      kind: "test_command",
      problem: PRB,
    });
    const waiting = problemTestLookup(l.sql, PRB);
    assertEquals(waiting, {
      ok: true,
      value: [
        { kind: "reproduction", state: "running", ended_at: null },
        { kind: "app_test", state: "pending", ended_at: null },
        { kind: "test_command", state: "fail", ended_at: null },
      ],
    });
    l.request(
      "k6",
      "result_ref",
      { kind: "reproduction", problem: PRB },
      "vrf_2",
    );
    const settled = problemTestLookup(l.sql, PRB);
    assert(settled.ok);
    assertEquals(settled.value[0].state, "pass");
  } finally {
    l.db.close();
  }
});

Deno.test("problems/tests#R4 problems/tests#R5: 앞선 결과와 준비 실패는 지금 값과 따로 남고 통과로 접지 않는다", () => {
  const l = ledger();
  try {
    l.verification("vrf_1", "k1", "reproduction", "fail", "9");
    l.verification("vrf_2", "k2", "reproduction", "pass", "12");
    l.evidence("k2", "canonical-vrf_2", ["2026-10-09T00:00:05.000Z"]);
    l.request("k7", "accepted", { kind: "reproduction", problem: PRB });
    l.request("k7", "preparation_failed", {
      kind: "reproduction",
      problem: PRB,
    });
    const current = problemTestLookup(l.sql, PRB);
    assert(current.ok);
    assertEquals(current.value[0], {
      kind: "reproduction",
      state: "pass",
      ended_at: "2026-10-09T00:00:05.000Z",
    });
    const history = problemTestHistory(l.sql, PRB);
    assert(history.ok);
    assertEquals(history.value, [
      { kind: "reproduction", state: "fail", ended_at: null },
      {
        kind: "reproduction",
        state: "pass",
        ended_at: "2026-10-09T00:00:05.000Z",
      },
      { kind: "reproduction", state: "not_run", ended_at: null },
    ]);

    l.db.exec(`
      create table events (
        seq integer primary key,
        type text not null,
        subject text not null,
        payload text not null
      );
      create table releases (
        id text primary key,
        bundle_hash text not null,
        status text not null
      );
    `);
    const after = "b".repeat(64);
    l.sql.run(
      `insert into events (seq, type, subject, payload) values (1, 'ProblemFixRecorded', ?, ?)`,
      [PRB, JSON.stringify({ after: "rel_01arz3ndektsv4rrffq69g5fa2" })],
    );
    l.sql.run(
      `insert into releases (id, bundle_hash, status) values (?, ?, 'prepared')`,
      ["rel_01arz3ndektsv4rrffq69g5fa2", after],
    );
    l.sql.run(
      `insert into verifications (id, request_principal, request_key, request_hash,
         kind, app, target_bundle_hash, problem, test, execution, result, reason,
         observations, recorded_seq, verification_canonical)
       values ('vrf_app', 'user-1', 'app-1', 'h', 'app_test', 'app_1', ?, null,
               't', 'e', 'fail', 'r', 'o', '20', 'canonical-vrf_app')`,
      [after],
    );
    l.sql.run(
      `insert into verifications (id, request_principal, request_key, request_hash,
         kind, app, target_bundle_hash, problem, test, execution, result, reason,
         observations, recorded_seq, verification_canonical)
       values ('vrf_other', 'user-1', 'app-2', 'h', 'app_test', 'app_1', ?, null,
               't', 'e', 'pass', 'r', 'o', '21', 'canonical-vrf_other')`,
      ["c".repeat(64)],
    );
    l.sql.run(
      `insert into test_requests (seq, request_principal, request_key, request_hash,
         phase, accepted, preparation_failed, at, start_unknown, result_ref,
         runner_principal, reason, payload)
       values (40, 'user-1', 'app-miss', 'h', 'preparation_failed', 0, 1, null, 0, null,
               'runner-1', 'r', ?)`,
      [JSON.stringify({
        kind: "app_test",
        problem: null,
        target: { bundle_hash: after },
      })],
    );
    const withApp = problemTestHistory(l.sql, PRB);
    assert(withApp.ok);
    assertEquals(
      withApp.value.filter((item) => item.kind === "app_test"),
      [
        { kind: "app_test", state: "fail", ended_at: null },
        { kind: "app_test", state: "not_run", ended_at: null },
      ],
    );
  } finally {
    l.db.close();
  }
});

Deno.test("problems/tests#R5: 표를 읽지 못하면 결과를 지어내지 않고 unavailable이다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    const sql: Sql = {
      run: (statement, params) => db.prepare(statement).run(...params),
      get: (statement, params) =>
        db.prepare(statement).get(...params) as SqlRow | undefined,
      all: (statement, params) =>
        db.prepare(statement).all(...params) as SqlRow[],
    };
    const missing = problemTestLookup(sql, PRB);
    assert(!missing.ok);
    assertEquals(missing.error.code, "unavailable");
  } finally {
    db.close();
  }
});
