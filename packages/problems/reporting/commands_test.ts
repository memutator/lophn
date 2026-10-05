import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import type { RequestContext } from "../../contracts/platform/mod.ts";
import type { RecordReportInput } from "../../contracts/problems/mod.ts";
import { canonicalize } from "../../base/mod.ts";
import { handleRecordReport } from "./commands.ts";
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

// 색인 형식(domain-model platform/ledger "시각·기간·seq")을 직접 만든다.
const at = (ms: number) => `${new Date(ms).toISOString().slice(0, 23)}Z`;

// fileLedger의 TEST 스키마에 reporting 스키마를 더한다. 적용기 순서와 같다.
function reportingLedger() {
  const ledger = fileLedger();
  for (const step of [...REPORTS_SCHEMA_STEPS, ...SNAPSHOTS_SCHEMA_STEPS]) {
    ledger.db.exec(step.sql);
  }
  return ledger;
}

function reportId(serial: number): string {
  return `rpt_${String(serial).padStart(22, "0")}`;
}

function snapshotId(serial: number): string {
  return `snp_${String(serial).padStart(22, "0")}`;
}

function hash(seed: number): string {
  return String(seed % 16).repeat(64);
}

// 접수 input 하나를 만든다. live 운영 보고인 예외 보고다.
function liveInput(patch: Partial<RecordReportInput> = {}): RecordReportInput {
  const report: RecordReportInput["report"] = {
    id: reportId(1),
    app: APP,
    mode: "live",
    diagnostic_scope: null,
    release: "rel_01ary8h2z3n4p5q6r7s8t9v0wa",
    release_missing_reason: null,
    bundle_hash: hash(1),
    source: "exception",
    code: "_exception",
    text: null,
    details: null,
    snapshot: snapshotId(1),
    observed_at: at(Date.UTC(2026, 9, 4, 12, 0, 0)),
    principal: "user-1",
    content_hash: hash(2),
  };
  const snapshot: RecordReportInput["snapshot"] = {
    id: snapshotId(1),
    captured_at: at(Date.UTC(2026, 9, 4, 12, 0, 0)),
    invocation: {
      id: "inv_01ary8h2z3n4p5q6r7s8t9v0wa",
      binding: "sdk_context",
      record_missing_reason: null,
    },
    invocation_missing_reason: null,
    error: {
      name: "TypeError",
      message: "boom",
      message_missing_reason: null,
      frames: [{ path: "src/a.ts", function: null, line: 1, column: 1 }],
      source_missing_reason: null,
      stack: hash(3),
      stack_missing_reason: null,
      truncation_notes: [],
    },
    error_missing_reason: null,
    logs: {
      blob: hash(4),
      line_count: 2,
      truncated: false,
      scope: "process",
      from_at: null,
      to_at: null,
      collected_at: at(Date.UTC(2026, 9, 4, 12, 0, 0)),
    },
    logs_missing_reason: null,
    screen: null,
    screen_missing_reason: { reason: "not collected" },
  };
  return {
    report,
    snapshot,
    group_key: {
      kind: "exception",
      code: "_exception",
      discriminator: snapshot.error!.stack!,
    },
    existing_problem: null,
    blobs: [
      {
        hash: hash(3),
        size_bytes: 64,
        purpose: "snapshot_stack",
        source: {
          kind: "prepared",
          blob: {
            preparation: "prep-stack-1",
            principal: "user-1",
            hash: hash(3),
            size_bytes: 64,
            purpose: "snapshot_stack",
          },
        },
      },
      {
        hash: hash(4),
        size_bytes: 64,
        purpose: "snapshot_logs",
        source: {
          kind: "prepared",
          blob: {
            preparation: "prep-logs-1",
            principal: "user-1",
            hash: hash(4),
            size_bytes: 64,
            purpose: "snapshot_logs",
          },
        },
      },
    ],
    origin: {
      context: {
        authentication: {
          principal: "user-1",
          actor: "machine",
          scope: { operations: [], targets: {} },
          conditions: {},
          credential_ref: "cred-1",
        },
        app: APP,
        mode: "live",
        diagnostic_scope: null,
        release: "rel_01ary8h2z3n4p5q6r7s8t9v0wa",
        release_missing_reason: null,
        bundle_hash: hash(1),
        binding: "sdk",
        origin: "process_observer",
      },
      report_id: report.id,
      content_hash: report.content_hash,
    },
    ...patch,
  };
}

// 접수 transaction을 한 번 돌린다. fileLedger의 begin/commit 경계를 쓴다(R10).
function submit(
  ledger: ReturnType<typeof fileLedger>,
  input: RecordReportInput,
  compare: { active_release: string | null; problem_seq: string | null } = {
    active_release: "rel_01ary8h2z3n4p5q6r7s8t9v0wa",
    problem_seq: null,
  },
) {
  return ledger.transaction((tx) =>
    handleRecordReport(
      tx,
      ctx(),
      input,
      compare,
      (key) => canonicalize(value(key)),
      insertSnapshot,
    )
  );
}

function value(key: unknown): Parameters<typeof canonicalize>[0] {
  return key as never;
}

Deno.test("problems/reporting#R9: 같은 ID·principal·content hash 재전송은 원래 결과, principal이나 내용이 다르면 conflict", () => {
  const ledger = reportingLedger();
  try {
    const accepted = submit(ledger, liveInput());
    assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    const again = submit(ledger, liveInput());
    assert(again.ok);
    assertEquals(again.value, accepted.value);
    const rows = ledger.sql.all("select * from reports", []);
    assertEquals(rows.length, 1);
    // principal이 다른 재전송은 conflict다(R9).
    const resendOtherPrincipal = liveInput();
    resendOtherPrincipal.report = {
      ...resendOtherPrincipal.report,
      principal: "user-2",
      content_hash: hash(9),
    };
    resendOtherPrincipal.origin = {
      ...resendOtherPrincipal.origin,
      content_hash: hash(9),
    };
    const other = ledger.transaction((tx) =>
      handleRecordReport(
        tx,
        ctx({ principal: "user-2" }),
        resendOtherPrincipal,
        {
          active_release: "rel_01ary8h2z3n4p5q6r7s8t9v0wa",
          problem_seq: null,
        },
        (key) => canonicalize(key as never),
        insertSnapshot,
      )
    );
    assertFalse(other.ok);
    assertEquals(other.error.code, "conflict");
  } finally {
    ledger.close();
  }
});

Deno.test("problems/reporting#R10: 저장 중 실패 주입 시 Report·Snapshot·Problem·event가 하나도 남지 않는다", () => {
  const ledger = reportingLedger();
  try {
    // 저장 중 실패 주입: handler 안에서 throw하면 runTransaction이 전체를
    // rollback한다(R10). fileLedger.transaction은 rollback 경계를 probe한다.
    let rollback = false;
    try {
      ledger.transaction((tx) => {
        const result = handleRecordReport(
          tx,
          ctx(),
          liveInput(),
          { active_release: null, problem_seq: null },
          (key) => canonicalize(key as never),
          insertSnapshot,
        );
        if (!result.ok) return { ok: false, error: result.error };
        // 성공 뒤 일부러 실패를 던져 transaction이 rollback되는지 본다(R10).
        throw new Error("fail during store");
      });
    } catch {
      rollback = true;
    }
    assert(rollback);
    assertEquals(
      ledger.sql.all("select * from reports", []).length,
      0,
    );
    assertEquals(
      ledger.sql.all("select * from snapshots where id != 'none'", []).length,
      0,
    );
    assertEquals(ledger.sql.all("select * from problems", []).length, 0);
    assertEquals(
      ledger.sql.all("select * from probe_events", []).length,
      0,
    );
  } finally {
    ledger.close();
  }
});

Deno.test("problems/reporting#R11: 같은 시각·같은 group key라도 ID가 다르면 각각 남고 UPDATE·DELETE 경로가 없다", () => {
  const ledger = reportingLedger();
  try {
    for (let serial = 1; serial <= 6; serial++) {
      const input = liveInput();
      input.report = {
        ...input.report,
        id: reportId(serial),
        snapshot: snapshotId(serial),
      };
      input.snapshot = {
        ...input.snapshot,
        id: snapshotId(serial),
      };
      input.origin = { ...input.origin, report_id: input.report.id };
      input.blobs = input.blobs.map((blob) => ({
        ...blob,
        source: {
          kind: "prepared" as const,
          blob: {
            ...blob.source,
            preparation: `prep-${serial}`,
            principal: "user-1",
            purpose: blob.purpose,
            hash: blob.hash,
            size_bytes: 64,
          },
        },
      }));
      const accepted = submit(ledger, input);
      assert(accepted.ok, accepted.ok ? "" : accepted.error.message);
    }
    // 6행이 모두 남는다(R11 — 같은 key·시각, 다른 ID다).
    assertEquals(ledger.sql.all("select * from reports", []).length, 6);
    assertEquals(ledger.sql.all("select * from problems", []).length, 1);
    // UPDATE·DELETE는 immutable 트리거에 걸린다(R11).
    assertThrows(() => ledger.sql.run("update reports set text = 'x'", []));
    assertThrows(() => ledger.sql.run("delete from reports", []));
    assertThrows(() => ledger.sql.run("delete from snapshots", []));
  } finally {
    ledger.close();
  }
});

Deno.test("problems/reporting#R12: event envelope 시각으로 앱당 60,000ms 안 새 Report 21번째는 unavailable, 같은 ID 재전송은 세지 않는다", () => {
  const ledger = reportingLedger();
  try {
    const base = Date.UTC(2026, 9, 4, 12, 0, 0);
    for (let serial = 1; serial <= 20; serial++) {
      const input = liveInput();
      input.report = {
        ...input.report,
        id: reportId(serial),
        snapshot: snapshotId(serial),
        observed_at: at(base - (serial - 1) * 1_000),
      };
      input.snapshot = { ...input.snapshot, id: snapshotId(serial) };
      input.origin = { ...input.origin, report_id: input.report.id };
      const accepted = submit(ledger, input);
      assert(
        accepted.ok,
        `#${serial}: ${accepted.ok ? "" : accepted.error.message}`,
      );
    }
    // 21번째 새 Report는 unavailable이다(R12).
    const twentyFirst = liveInput();
    twentyFirst.report = {
      ...twentyFirst.report,
      id: reportId(21),
      snapshot: snapshotId(21),
    };
    twentyFirst.snapshot = { ...twentyFirst.snapshot, id: snapshotId(21) };
    twentyFirst.origin = {
      ...twentyFirst.origin,
      report_id: twentyFirst.report.id,
    };
    assertEquals(
      ledger.sql.all("select * from reports", []).length,
      20,
    );
    const rejected = submit(ledger, twentyFirst);
    assertFalse(rejected.ok);
    assertEquals(rejected.error.code, "unavailable");
    assertEquals(ledger.sql.all("select * from reports", []).length, 20);
    // 같은 ID 재전송은 세지 않는다(R12): observed_at을 창 뒤로 옮겨도
    // 1번째 재전송은 원래 결과를 돌려준다.
    const resend = liveInput();
    resend.report = {
      ...resend.report,
      id: reportId(1),
      snapshot: snapshotId(1),
    };
    resend.snapshot = { ...resend.snapshot, id: snapshotId(1) };
    resend.origin = { ...resend.origin, report_id: resend.report.id };
    const replayed = submit(ledger, resend);
    assert(replayed.ok);
    assertEquals(ledger.sql.all("select * from reports", []).length, 20);
  } finally {
    ledger.close();
  }
});
