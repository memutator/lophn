import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import type { LophnError } from "../../base/mod.ts";
import type {
  CommandDefinition,
  Input,
  RequestContext,
  Tx,
} from "../../contracts/platform/mod.ts";
import type {
  GroupKey,
  ReportBlobInput,
  SnapshotInput,
} from "../../contracts/problems/mod.ts";
import {
  problemObserved,
  problemOpened,
  recordReport,
  reportRecorded,
  snapshotRecorded,
} from "../../contracts/problems/mod.ts";
import { insertSnapshot } from "../snapshots/mod.ts";
import type { Output } from "../../contracts/platform/mod.ts";
import {
  findProblem,
  findReport,
  type ProblemRow,
  reportsInWindow,
  windowBounds,
  windowLimit,
} from "./model.ts";

const CONFLICT = "같은 Report ID의 원주체나 내용이 다르다";

type AcceptedReport = Output<typeof recordReport>;

// 접수 content hash 비교(R9): 같은 ID·principal·content hash는 원래 결과,
// principal이나 내용이 다르면 conflict다.
function replayOrConflict(
  sql: Pick<Tx["sql"], "get">,
  reportId: string,
  principal: string,
  contentHash: string,
): Result<AcceptedReport, LophnError> | undefined {
  const prior = findReport(sql, reportId);
  if (prior === null) return undefined;
  if (prior.principal !== principal || prior.content_hash !== contentHash) {
    return err({ code: "conflict", message: CONFLICT });
  }
  const row = sql.get(
    "select problem, diagnostic_scope, snapshot from reports where id = ?",
    [reportId],
  );
  if (row === undefined) {
    return err({ code: "internal", message: "접수 행이 없다" });
  }
  const problem = row.problem === null ? null : String(row.problem);
  const scope = row.diagnostic_scope === null
    ? null
    : String(row.diagnostic_scope);
  const snapshot = String(row.snapshot);
  return ok(
    problem === null
      ? { report: reportId, snapshot, problem: null, diagnostic_scope: scope! }
      : { report: reportId, snapshot, problem, diagnostic_scope: null },
  );
}

// R12: event envelope 시각(tx.now) 기준 앱당 새 Report 상한. 같은 ID 재전송은
// 세지 않고 observed_at은 창을 우회하지 못한다.
function windowReaches(
  tx: Tx,
  app: string,
  withoutReport: string,
): Result<true, LophnError> {
  const { windowMs, maxNew } = windowBounds();
  const nowMs = Date.parse(tx.now());
  const counted = reportsInWindow(tx.sql, app, windowMs, nowMs)
    .filter((id) => id !== withoutReport);
  if (counted.length >= maxNew) return windowLimit();
  return ok(true);
}

function registerBlobs(
  tx: Tx,
  principal: string,
  report: string,
  blobs: readonly ReportBlobInput[],
  eventSeq: string,
): Result<true, LophnError> {
  for (const blob of blobs) {
    if (blob.source.kind !== "prepared") {
      return err({ code: "forbidden", message: "prepared blob만 등록한다" });
    }
    if (blob.source.blob.principal !== principal) {
      return err({ code: "forbidden", message: "blob 원주체가 다르다" });
    }
    const registered = tx.registerBlobRef({
      owner_kind: "report",
      owner_key: report,
      field: blob.purpose,
      registered_seq: eventSeq,
      source: { kind: "prepared", blob: { ...blob.source.blob } },
    });
    if (!registered.ok) return registered;
    if (
      registered.value.hash !== blob.hash ||
      registered.value.owner_kind !== "report" ||
      registered.value.owner_key !== report ||
      registered.value.field !== blob.purpose ||
      registered.value.registered_seq !== eventSeq
    ) {
      return err({ code: "conflict", message: CONFLICT });
    }
  }
  return ok(true);
}

// snapshotRecorded의 evidence_hashes: 값이 있는 증거 hash만 취한다.
function evidenceHashes(snapshot: SnapshotInput): string[] {
  const hashes: string[] = [];
  if (snapshot.error?.stack) hashes.push(snapshot.error.stack);
  if (snapshot.logs?.blob) hashes.push(snapshot.logs.blob);
  if (snapshot.screen?.state) hashes.push(snapshot.screen.state);
  if (snapshot.screen?.screenshot) hashes.push(snapshot.screen.screenshot);
  return hashes;
}

export function handleRecordReport(
  tx: Tx,
  _ctx: RequestContext,
  input: Input<typeof recordReport>,
  compare: unknown,
  keyText: (key: GroupKey) => string,
  insertSnapshotRow: (
    tx: Tx,
    snapshot: SnapshotInput,
  ) => Result<true, LophnError>,
): Result<AcceptedReport, LophnError> {
  const report = input.report;
  const existing = input.existing_problem;
  // 접수 content hash 비교(R9): 같은 ID·principal·content hash는 원래 결과.
  const prior = replayOrConflict(
    tx.sql,
    report.id,
    report.principal,
    report.content_hash,
  );
  if (prior !== undefined) return prior;
  // R12 창은 새 Report만 센다. 재전송은 여기까지 오지 않는다.
  const windowed = windowReaches(tx, report.app, report.id);
  if (!windowed.ok) return windowed;
  // 실행 자격 CAS: executor는 processed_through_seq만 검사하므로 이 command의
  // active_release·problem_seq 비교 기준은 handler가 형식을 본다.
  if (
    compare === null || typeof compare !== "object" ||
    !("active_release" in compare) || !("problem_seq" in compare)
  ) {
    return err({ code: "invalid_input", message: "접수 비교 기준이 없다" });
  }
  const compareKeys = compare as Record<string, unknown>;
  const activeRelease = compareKeys["active_release"] === null
    ? null
    : String(compareKeys["active_release"]);
  const problemSeq = compareKeys["problem_seq"];
  if (
    problemSeq !== null &&
    (typeof problemSeq !== "string" || !/^\d+$/.test(problemSeq))
  ) {
    return err({ code: "invalid_input", message: "접수 비교 기준이 없다" });
  }
  const snapshot = input.snapshot;
  const live = report.mode === "live";
  // preview·test는 problem=null과 진단 scope 필수이고 운영 Problem을 바꾸지 않는다(R4, grouping#R7).
  if (!live && (existing !== null || report.diagnostic_scope === null)) {
    return err({
      code: "invalid_input",
      message: "비운영 보고에 진단 범위가 없다",
    });
  }
  const key = keyText(input.group_key);
  let problemRow: ProblemRow | null = null;
  if (live) {
    // (app, group_key) unique는 상태와 무관하게 같은 문제를 찾는다(grouping#R10).
    problemRow = findProblem(tx.sql, report.app, key);
    if (
      problemRow !== null && existing !== null && problemRow.id !== existing
    ) {
      return err({ code: "conflict", message: "다른 앱의 기존 문제다" });
    }
  }
  const acceptance: AcceptedReport = live
    ? {
      report: report.id,
      snapshot: snapshot.id,
      problem: problemRow === null ? "" : problemRow.id,
      diagnostic_scope: null,
    }
    : {
      report: report.id,
      snapshot: snapshot.id,
      problem: null,
      diagnostic_scope: report.diagnostic_scope!,
    };
  // live Problem: 새로 열 문제는 reportRecorded 전에 insert한다. reportRecorded
  // payload는 live 보고에 problem id가 있어야 하므로(위 refine), emit 시점에 id가
  // 있어야 한다. event와 등록, insert는 runTransaction fail-closed rollback 안에
  // 있다(R10).
  let problemId: string | null = null;
  if (live && problemRow === null) {
    // 없음→open: insert는 emit 전이지만 rollback은 같다(R10). ProblemOpened는
    // insert 뒤에 낸다.
    problemId = tx.newId("prb");
    tx.sql.run(
      `insert into problems (id, app, group_key, status, work, interpretation_version, interpretation_section, closure)
       values (?, ?, ?, 'open', NULL, NULL, NULL, NULL)`,
      [problemId, report.app, key],
    );
    acceptance.problem = problemId;
  } else if (live && problemRow !== null) {
    // reportRecorded payload는 live 보고에 문제 ID가 있어야 하므로 emit 전에 정한다.
    problemId = problemRow.id;
  }
  const eventSeq = tx.emit(reportRecorded, report.id, {
    app: report.app,
    problem: live ? problemId : null,
    source: report.source,
    mode: report.mode,
    code: report.code,
    snapshot: snapshot.id,
    observed_at: report.observed_at,
    content_hash: report.content_hash,
  });
  tx.emit(snapshotRecorded, snapshot.id, {
    report: report.id,
    captured_at: snapshot.captured_at,
    evidence_hashes: evidenceHashes(snapshot),
    missing_reasons: {
      invocation: snapshot.invocation_missing_reason ?? null,
      error: snapshot.error_missing_reason ?? null,
      logs: snapshot.logs_missing_reason ?? null,
      screen: snapshot.screen_missing_reason ?? null,
    },
  });
  if (live && problemRow === null) {
    tx.emit(problemOpened, problemId!, {
      app: report.app,
      group_key: input.group_key,
      report: report.id,
    });
  } else if (live && problemRow !== null) {
    // open/fixing→동일, closed→closed 유지(늦은 이전 release 보고).
    // closed+현재 활성 release의 reopen 분기는 problems/closing의 몫이다(T21).
    tx.emit(problemObserved, problemRow.id, {
      report: report.id,
      release: report.release,
      active_release_at_acceptance: activeRelease,
      previous_status: problemRow.status,
    });
  }
  const inserted = insertSnapshotRow(tx, snapshot);
  if (!inserted.ok) return inserted;
  tx.sql.run(
    `insert into reports (
       id, app, problem, source, mode, diagnostic_scope, release, release_missing_reason,
       bundle_hash, code, text, details, snapshot, observed_at, principal, content_hash
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      report.id,
      report.app,
      live ? problemId : null,
      report.source,
      report.mode,
      report.diagnostic_scope,
      report.release,
      report.release_missing_reason,
      report.bundle_hash,
      report.code,
      report.text,
      report.details,
      snapshot.id,
      report.observed_at,
      report.principal,
      report.content_hash,
    ],
  );
  const blobs = registerBlobs(
    tx,
    report.principal,
    report.id,
    input.blobs,
    eventSeq,
  );
  if (!blobs.ok) return blobs;
  return ok(acceptance);
}

export const recordReportCommand: CommandDefinition<typeof recordReport> = {
  route: recordReport,
  handle(tx, ctx, input, compare) {
    return handleRecordReport(
      tx,
      ctx,
      input,
      compare,
      groupKeyJson,
      insertSnapshot,
    );
  },
};

// key는 (app, kind, code, discriminator)의 canonical JSON이다(releases·업무 값·
// message·시각 제외, domain-model problems/grouping).
function groupKeyJson(key: GroupKey): string {
  return canonicalize(key);
}
