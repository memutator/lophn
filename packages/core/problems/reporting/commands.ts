import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import type { LophnError } from "../../../base/mod.ts";
import type {
  CommandDefinition,
  Input,
  Output,
  RequestContext,
  Tx,
} from "../../../protocol/server/mod.ts";
import {
  type ProblemReportBlobInput,
  recordProblemReport,
} from "../../../protocol/problems/mod.ts";
import {
  problemOpened,
  problemReopened,
} from "../../../protocol/events/mod.ts";
import { insertProblemSnapshot } from "../snapshots/mod.ts";
import {
  conflict,
  findProblem,
  findReport,
  type ProblemRow,
  reopenDecision,
  reportsInWindow,
  windowBounds,
  windowLimit,
} from "./model.ts";
import { ReleaseLookupPort } from "./release-port.ts";

type Accepted = Output<typeof recordProblemReport>;
type Report = Input<typeof recordProblemReport>["report"];

// 같은 ID·principal·content hash는 원래 결과, principal이나 내용이 다르면 conflict다.
function replayOrConflict(
  sql: Pick<Tx["sql"], "get">,
  report: Report,
): Result<Accepted, LophnError> | undefined {
  const prior = findReport(sql, report.id);
  if (prior === null) return undefined;
  if (
    prior.principal !== report.principal ||
    prior.content_hash !== report.content_hash
  ) return conflict();
  const row = sql.get(
    "select problem, diagnostic_scope, snapshot from reports where id = ?",
    [report.id],
  );
  if (row === undefined) {
    return err({ code: "internal", message: "접수 행이 없다" });
  }
  const snapshot = String(row.snapshot);
  return ok(
    row.problem === null
      ? {
        report: report.id,
        snapshot,
        problem: null,
        diagnostic_scope: String(row.diagnostic_scope),
      }
      : {
        report: report.id,
        snapshot,
        problem: String(row.problem),
        diagnostic_scope: null,
      },
  );
}

// event envelope 시각(tx.now) 기준 앱당 새 Report 상한. 같은 ID 재전송은 세지 않는다.
function windowReaches(
  tx: Tx,
  app: string,
  withoutReport: string,
): Result<true, LophnError> {
  const { windowMs, maxNew } = windowBounds();
  const counted = reportsInWindow(tx.sql, app, windowMs, Date.parse(tx.now()))
    .filter((id) => id !== withoutReport);
  return counted.length >= maxNew ? windowLimit() : ok(true);
}

// blob 참조의 registered_seq. 열린 문제의 또 다른 발생은 event를 남기지 않으므로 지금까지의 마지막 seq다.
function headSeq(tx: Tx): string {
  const row = tx.sql.get(
    "select coalesce(max(seq), 0) as head from events",
    [],
  );
  return String(row?.head ?? 0);
}

function registerBlobs(
  tx: Tx,
  principal: string,
  report: string,
  blobs: readonly ProblemReportBlobInput[],
): Result<true, LophnError> {
  const registeredSeq = headSeq(tx);
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
      registered_seq: registeredSeq,
      source: { kind: "prepared", blob: { ...blob.source.blob } },
    });
    if (!registered.ok) return registered;
    if (
      registered.value.hash !== blob.hash ||
      registered.value.owner_kind !== "report" ||
      registered.value.owner_key !== report ||
      registered.value.field !== blob.purpose
    ) return conflict();
  }
  return ok(true);
}

// 발생의 release가 활성화된 시각. 모르는 release나 다른 앱의 release는 null이다.
function activatedAtOf(
  tx: Tx,
  app: string,
  release: string | null,
): Result<string | null, LophnError> {
  if (release === null) return ok(null);
  const found = tx.port(ReleaseLookupPort)(tx.sql).get(release);
  if (!found.ok) return found;
  return ok(
    found.value === null || found.value.app !== app
      ? null
      : found.value.activated_at,
  );
}

function reopenIfRecurred(
  tx: Tx,
  problem: ProblemRow,
  report: Report,
): Result<true, LophnError> {
  // release를 물을 일은 해결됨인 문제뿐이다.
  const activated = problem.state === "resolved"
    ? activatedAtOf(tx, report.app, report.release)
    : ok(null);
  if (!activated.ok) return activated;
  if (reopenDecision(problem, activated.value) === "accumulate") {
    return ok(true);
  }
  tx.sql.run(
    `update problems
     set state = 'open', state_changed_at = ?, seq = seq + 1,
         recurred_resolved_at = ?, recurred_release = ?
     where id = ?`,
    [tx.now(), problem.state_changed_at, report.release, problem.id],
  );
  tx.emit(problemReopened, problem.id, {
    app: report.app,
    report: report.id,
  });
  return ok(true);
}

// 문제가 없으면 열고, 있으면 상태에 따라 쌓기만 하거나 다시 연다. 문제의 id를 돌려준다.
function attachToProblem(
  tx: Tx,
  report: Report,
  input: Input<typeof recordProblemReport>,
): Result<string, LophnError> {
  const key = canonicalize(input.group_key);
  const found = findProblem(tx.sql, report.app, key);
  if (found === null) {
    // 제보가 고른 기존 문제는 그 문제의 key로 와야 한다.
    if (input.existing_problem !== null) return conflict();
    const id = tx.newId("prb");
    tx.sql.run(
      `insert into problems (id, app, group_key, name, state, state_changed_at, seq)
       values (?, ?, ?, ?, 'open', ?, 1)`,
      [id, report.app, key, report.name, tx.now()],
    );
    tx.emit(problemOpened, id, { app: report.app, report: report.id });
    return ok(id);
  }
  if (input.existing_problem !== null && input.existing_problem !== found.id) {
    return conflict();
  }
  const reopened = reopenIfRecurred(tx, found, report);
  return reopened.ok ? ok(found.id) : reopened;
}

function handleRecordProblemReport(
  tx: Tx,
  _ctx: RequestContext,
  input: Input<typeof recordProblemReport>,
): Result<Accepted, LophnError> {
  const report = input.report;
  const prior = replayOrConflict(tx.sql, report);
  if (prior !== undefined) return prior;
  // 창은 새 Report만 센다. 재전송은 여기까지 오지 않는다.
  const windowed = windowReaches(tx, report.app, report.id);
  if (!windowed.ok) return windowed;

  // live 발생만 문제에 붙는다. preview·test는 진단 scope로만 읽힌다.
  let problem: string | null = null;
  if (report.mode === "live") {
    const attached = attachToProblem(tx, report, input);
    if (!attached.ok) return attached;
    problem = attached.value;
  }

  const inserted = insertProblemSnapshot(tx, input.snapshot);
  if (!inserted.ok) return inserted;
  tx.sql.run(
    `insert into reports (
       id, app, problem, source, mode, diagnostic_scope, release, release_missing_reason,
       bundle_hash, name, message, details, snapshot, observed_at, principal, content_hash
     ) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      report.id,
      report.app,
      problem,
      report.source,
      report.mode,
      report.diagnostic_scope,
      report.release,
      report.release_missing_reason,
      report.bundle_hash,
      report.name,
      report.message,
      report.details,
      input.snapshot.id,
      report.observed_at,
      report.principal,
      report.content_hash,
    ],
  );
  const blobs = registerBlobs(tx, report.principal, report.id, input.blobs);
  if (!blobs.ok) return blobs;
  return ok(
    problem === null
      ? {
        report: report.id,
        snapshot: input.snapshot.id,
        problem: null,
        diagnostic_scope: report.diagnostic_scope!,
      }
      : {
        report: report.id,
        snapshot: input.snapshot.id,
        problem,
        diagnostic_scope: null,
      },
  );
}

export const recordProblemReportCommand: CommandDefinition<
  typeof recordProblemReport
> = {
  route: recordProblemReport,
  handle: handleRecordProblemReport,
};
