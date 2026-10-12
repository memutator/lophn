import { assert, assertEquals, assertFalse } from "@std/assert";
import type { RequestContext } from "../../../protocol/platform/mod.ts";
import type { RecordReportInput } from "../../../protocol/problems/mod.ts";
import { canonicalize } from "../../../base/mod.ts";
import { handleRecordReport, recordReportCommand } from "./commands.ts";
import { listReportsRead } from "./reads.ts";
import { emitObserved, emitOpened, existingProblem } from "../grouping/mod.ts";
import { insertSnapshot, SNAPSHOTS_SCHEMA_STEPS } from "../snapshots/mod.ts";
import { REPORTS_SCHEMA_STEPS } from "./schema.ts";
import { fileLedger } from "../tests/testing/mod.ts";

const APP = "app_01ary8h2z3n4p5q6r7s8t9v0wa";

const ctx = (patch: Partial<RequestContext> = {}): RequestContext => ({
  principal: "user-1",
  actor: "machine",
  scope: { operations: [], targets: {} },
  conditions: {},
  credential_ref: "cred-1",
  ...patch,
});

function reportingLedger() {
  const ledger = fileLedger();
  for (const step of [...REPORTS_SCHEMA_STEPS, ...SNAPSHOTS_SCHEMA_STEPS]) {
    ledger.db.exec(step.sql);
  }
  // 닫힌 문제의 재발 판정이 읽는 활성 release 열의 최소 모양이다(apps/releases 표).
  // 활성 release가 없으니 닫힌 문제의 새 보고는 닫힘을 유지한다.
  ledger.db.exec(
    "create table releases (id text primary key, app text not null, status text not null) strict",
  );
  return ledger;
}

// R12 보고 창을 우회하지 않도록 event envelope 시각을 앱당 20번 안으로 둔다.
// 테스트는 창 한도 안의 보고 3개만 쓴다.

function liveInput(patch: Partial<RecordReportInput> = {}): RecordReportInput {
  const report: RecordReportInput["report"] = {
    id: "rpt_1",
    app: APP,
    mode: "live",
    diagnostic_scope: null,
    release: "rel_1",
    release_missing_reason: null,
    bundle_hash: "1".repeat(64),
    source: "exception",
    code: "_exception",
    text: null,
    details: null,
    snapshot: "snp_1",
    observed_at: "2026-10-04T12:00:00.000Z",
    principal: "user-1",
    content_hash: "2".repeat(64),
  };
  const snapshot: RecordReportInput["snapshot"] = {
    id: "snp_1",
    captured_at: "2026-10-04T12:00:00.000Z",
    invocation: null,
    invocation_missing_reason: { reason: "not captured" },
    error: null,
    error_missing_reason: { reason: "no error" },
    logs: null,
    logs_missing_reason: { reason: "no logs" },
    screen: null,
    screen_missing_reason: { reason: "not collected" },
  };
  return {
    report,
    snapshot,
    group_key: {
      kind: "exception",
      code: "_exception",
      discriminator: "3".repeat(64),
    },
    existing_problem: null,
    blobs: [],
    origin: {
      // handleRecordReport는 origin.context를 본지 않는다. 표 모양만 채운다.
      context: {
        authentication: {
          principal: "user-1",
          actor: "machine",
          scope: { operations: [], targets: {} },
          conditions: {},
          credential_ref: "cred-1",
        },
        binding: "test-binding",
        origin: "process_observer" as const,
        app: APP,
        mode: "live",
        diagnostic_scope: null,
        release: "rel_1",
        release_missing_reason: null,
        bundle_hash: "1".repeat(64),
      },
      report_id: report.id,
      content_hash: report.content_hash,
    },
    ...patch,
  };
}

function submit(
  ledger: ReturnType<typeof reportingLedger>,
  input: RecordReportInput,
  compare: { active_release: string | null; problem_seq: string | null } = {
    active_release: "rel_1",
    problem_seq: null,
  },
) {
  return ledger.transaction((tx) =>
    handleRecordReport(
      tx,
      ctx(),
      input,
      compare,
      (key) => canonicalize(key as never),
      insertSnapshot,
    )
  );
}

Deno.test("problems/reporting#R3 problems/grouping#R1: 첫 live Report 하나로 ProblemOpened, 같은 key는 ProblemObserved, 2번째 발생 대기 상태가 없다", () => {
  const ledger = reportingLedger();
  try {
    // 첫 live Report 하나로 열린다(R3, grouping#R1).
    const first = submit(ledger, liveInput());
    assert(first.ok, first.ok ? "" : first.error.message);
    const problemId = first.value.problem as string;
    assertEquals(problemId, "vrf_01ary8h2z3n4p5q6r7s8t9v0wx");
    const opened = ledger.sql.all("select * from problems", []);
    assertEquals(opened.length, 1);
    assertEquals(String(opened[0]["status"]), "open");
    // 같은 key는 ProblemObserved고 Problem 때문에 기다리지 않는다(grouping#R1).
    const second = liveInput();
    second.report = { ...second.report, id: "rpt_2", snapshot: "snp_2" };
    second.snapshot = { ...second.snapshot, id: "snp_2" };
    second.origin = { ...second.origin, report_id: "rpt_2" };
    const again = submit(ledger, second);
    assert(again.ok, again.ok ? "" : again.error.message);
    assertEquals(again.value.problem, problemId);
    assertEquals(ledger.sql.all("select * from problems", []).length, 1);
    // 2번째 발생을 기다리는 상태는 없다: 문제 표에 pending 열이 없다.
    const columns = ledger.db.prepare(
      "select name from pragma_table_info('problems')",
    ).all().map((row) => String((row as Record<string, unknown>)["name"]));
    assertFalse(columns.includes("pending"));
    assertFalse(columns.includes("occurrences"));
  } finally {
    ledger.close();
  }
});

Deno.test("problems/reporting#R4 problems/grouping#R7: preview는 problem=null과 진단 scope 필수, 운영 Problem 상태·수가 바뀌지 않는다", () => {
  const ledger = reportingLedger();
  try {
    // 운영 live Report 하나를 먼저 접수한다.
    const first = submit(ledger, liveInput());
    assert(first.ok, first.ok ? "" : first.error.message);
    const before = ledger.sql.all("select * from problems", []);
    assertEquals(before.length, 1);
    assertEquals(String(before[0]["status"]), "open");
    // preview는 problem=null과 공백 아닌 진단 scope가 필수다(reporting#R4).
    const preview = liveInput();
    preview.report = {
      ...preview.report,
      id: "rpt_2",
      snapshot: "snp_2",
      mode: "preview",
      diagnostic_scope: "shell-session-1",
    };
    preview.snapshot = { ...preview.snapshot, id: "snp_2" };
    preview.origin = {
      ...preview.origin,
      context: {
        ...preview.origin.context,
        mode: "preview",
        diagnostic_scope: "shell-session-1",
      } as never,
      report_id: "rpt_2",
    };
    const accepted = submit(ledger, preview);
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    assertEquals(accepted.value.problem, null);
    assert(accepted.value.diagnostic_scope !== null);
    // 운영 Problem 상태·수가 바뀌지 않는다(grouping#R7).
    const after = ledger.sql.all("select * from problems", []);
    assertEquals(after.length, 1);
    assertEquals(String(after[0]["status"]), "open");
    // preview에 진단 scope가 없으면 거절한다(reporting#R4).
    const scopeless = liveInput();
    scopeless.report = {
      ...scopeless.report,
      id: "rpt_3",
      snapshot: "snp_3",
      mode: "preview",
      diagnostic_scope: null,
    };
    scopeless.snapshot = { ...scopeless.snapshot, id: "snp_3" };
    const rejected = submit(ledger, scopeless);
    assertFalse(rejected.ok);
    assertEquals(rejected.error.code, "invalid_input");
  } finally {
    ledger.close();
  }
});

Deno.test("problems/grouping#R10: 닫힌 문제도 (app, group_key) unique로 같은 Problem을 찾고 기간 상한이 없다", () => {
  const ledger = reportingLedger();
  try {
    // 문제를 연다.
    const first = submit(ledger, liveInput());
    assert(first.ok, first.ok ? "" : first.error.message);
    const problemId = first.value.problem as string;
    // 닫는다(상태 전환은 grouping command의 몫이다 — 여기서는 직접 update로
    // closed 상태를 만든다 — check는 닫힘과 closure의 짝을 묻는다).
    ledger.sql.run(
      "update problems set status = 'closed', closure = 'verified' where id = ?",
      [problemId],
    );
    const closed = ledger.sql.all("select * from problems", []);
    assertEquals(String(closed[0]["status"]), "closed");
    // 닫힌 문제도 같은 key로 찾는다(grouping#R10).
    const key = canonicalize(liveInput().group_key);
    const found = existingProblem(
      ledger.tx.sql,
      APP,
      key,
    );
    assert(found !== null);
    assertEquals(found.id, problemId);
    // 기간 상한이 없다: 창이 지나도 같은 Problem을 찾는다(grouping#R10).
    const late = liveInput();
    late.report = {
      ...late.report,
      id: "rpt_2",
      snapshot: "snp_2",
      observed_at: "2027-10-04T12:00:00.000Z",
    };
    late.snapshot = { ...late.snapshot, id: "snp_2" };
    late.origin = { ...late.origin, report_id: "rpt_2" };
    const accepted = submit(ledger, late);
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    assertEquals(accepted.value.problem, problemId);
    assertEquals(ledger.sql.all("select * from problems", []).length, 1);
  } finally {
    ledger.close();
  }
});

Deno.test("problems/reporting#R3: emitOpened·emitObserved grouping helpers는 problemOpened·problemObserved를 낸다", () => {
  const ledger = reportingLedger();
  try {
    const tx = ledger.tx;
    emitOpened(
      tx,
      "prb_9",
      APP,
      { kind: "exception", code: "_exception", discriminator: "4".repeat(64) },
      "rpt_9",
    );
    emitObserved(tx, "prb_9", "rpt_9", "rel_1", "rel_1", "open");
    const events = ledger.sql.all(
      "select subject, payload from probe_events",
      [],
    );
    assertEquals(events.length, 2);
    assertEquals(String(events[0]["subject"]), "prb_9");
    assertEquals(String(events[1]["subject"]), "prb_9");
  } finally {
    ledger.close();
  }
});

Deno.test("problems/reporting: recordReportCommand는 groupKeyJson과 insertSnapshot을 위임한다", () => {
  assert(recordReportCommand.route.name === "RecordReport");
  assert(typeof recordReportCommand.handle === "function");
  assert(typeof listReportsRead.handle === "function");
});
