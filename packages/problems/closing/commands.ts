// 닫힘 command handler(problems/closing#R1, R4, R5, R14). machine 판정기만 부르고,
// core는 참조된 신뢰 runner 결과의 kind·대상·판정과 현재 조건을 같은 transaction에서
// 다시 검사한다. 자료 해석·테스트는 하지 않는다. verifications 표는 problems/tests가
// 소유하므로 이 handler는 그 표의 읽는 열만 읽는다(repairs/commands.ts가 verifications를
// 읽는 선례).
import { err, ok, type Result, parseSeq } from "../../base/mod.ts";
import type { LophnError } from "../../base/mod.ts";
import type {
  CommandDefinition,
  Input,
  Output,
  RequestContext,
  Tx,
} from "../../contracts/platform/mod.ts";
import {
  closeProblemVerified,
  problemClosed,
} from "../../contracts/problems/mod.ts";
import { NOT_FOUND } from "../reporting/mod.ts";

const notFound = (): Result<never, LophnError> =>
  err({ code: "not_found", message: NOT_FOUND });
const conflict = (message: string): Result<never, LophnError> =>
  err({ code: "conflict", message });

function problemSeqOf(tx: Tx, problem: string): string {
  const row = tx.sql.get(
    `select cast(max(seq) as text) as seq from events where subject = ?`,
    [problem],
  );
  const seq = row?.seq;
  return seq === undefined || seq === null ? "0" : String(seq);
}

type ProblemRow = {
  app: string;
  status: "open" | "fixing" | "closed";
  work: string | null;
};

type VerificationRow = {
  app: string;
  kind: string;
  result: string;
  problem: string | null;
  basis_seq: string | null;
  after_release: string | null;
};

// verified 근거의 저장 열만 읽는다. problems/tests가 소유하는 표다.
function findVerification(
  tx: Tx,
  verification: string,
): VerificationRow | null {
  const row = tx.sql.get(
    `select app, kind, result, problem, basis_seq, after_release
       from verifications where id = ?`,
    [verification],
  );
  if (row === undefined) return null;
  return {
    app: String(row.app),
    kind: String(row.kind),
    result: String(row.result),
    problem: row.problem === null ? null : String(row.problem),
    basis_seq: row.basis_seq === null ? null : String(row.basis_seq),
    after_release: row.after_release === null
      ? null
      : String(row.after_release),
  };
}

// after가 현재 활성 release인지는 releases 표의 status 열 하나로 본다.
// activation이 이미 바꿔 둔 사실이고 이 handler는 release를 바꾸지 않는다.
function activeReleaseOf(tx: Tx, app: string): string | null {
  const row = tx.sql.get(
    `select id from releases where app = ? and status = 'active'`,
    [app],
  );
  return row === undefined ? null : String(row.id);
}

// basis_seq 뒤 같은 문제의 새 live Report가 0개인지다(R4). 늦은 이전 release 보고도
// 새 live Report라 이 0개 조건에 든다. report 접수는 그 문제를 payload로 싣는
// ReportRecorded event다(subject는 report ID다). quiet 대기도 날짜 만료도 없다(R5):
// 개수가 유일한 조건이다.
function liveReportsAfter(
  tx: Tx,
  problem: string,
  basis: string,
): number {
  const row = tx.sql.get(
    `select count(*) as found from events
      where type = 'ReportRecorded' and seq > ?
        and json_extract(payload, '$.problem') = ?`,
    [BigInt(basis), problem],
  );
  return Number(row?.found ?? 0);
}

// machine 판정기만 verified로 닫는다(R1). 조건은 7.6대로 세 가지다: 참조된 결과가
// 이 문제의 reproduction pass, after가 현재 활성 release, basis_seq 뒤 새 live Report
// 0개. 문제 seq·활성 release CAS는 실행기가 compare로 이미 좁힌다(R14).
export function handleCloseProblemVerified(
  tx: Tx,
  _ctx: RequestContext,
  input: Input<typeof closeProblemVerified>,
): Result<Output<typeof closeProblemVerified>, LophnError> {
  const row = tx.sql.get(
    `select app, status, work from problems where id = ?`,
    [input.problem],
  );
  if (row === undefined) return notFound();
  const problemRow: ProblemRow = {
    app: String(row.app),
    status: String(row.status) as ProblemRow["status"],
    work: row.work === null ? null : String(row.work),
  };
  if (problemRow.status === "closed") {
    return conflict("이미 닫혔다");
  }
  const found = findVerification(tx, input.verification);
  if (found === null) return notFound();
  // 다른 앱의 결과, reproduction이 아닌 결과, 실패·불가 판정은 후보가 아니다(R3).
  if (found.app !== problemRow.app) return notFound();
  if (found.kind !== "reproduction" || found.result !== "pass") {
    return err({ code: "invalid_input", message: "reproduction pass만 닫는다" });
  }
  if (found.problem !== input.problem) {
    return err({ code: "invalid_input", message: "근거 문제가 다르다" });
  }
  const basis = found.basis_seq;
  const after = found.after_release;
  if (basis === null || after === null) {
    return err({ code: "invalid_input", message: "근거 연결이 없다" });
  }
  if (parseSeq(basis).ok === false) {
    return err({ code: "invalid_input", message: "근거 연결이 없다" });
  }
  // after는 현재 활성 release여야 한다(R4).
  if (after !== activeReleaseOf(tx, problemRow.app)) {
    return conflict("활성 release가 바뀌었다");
  }
  // 요청의 release 예상도 현재 활성과 같아야 한다(R5, R14).
  if (input.release !== after) {
    return conflict("활성 release가 바뀌었다");
  }
  // basis_seq 뒤 같은 문제의 새 live Report가 0개일 때만 닫는다(R4).
  if (liveReportsAfter(tx, input.problem, basis) !== 0) {
    return conflict("근거 뒤 새 보고가 있다");
  }
  // 문제 seq CAS는 이미 compare로 지났으므로 지금 읽은 값과 compare가 같다.
  // compare의 기준이 이 closure의 basis_seq다(닫히는 문제에 뒤 변경이 없다는 뜻).
  const expectedSeq = problemSeqOf(tx, input.problem);
  if (expectedSeq !== input.problem_seq) {
    return conflict("문제가 바뀌었다");
  }
  const closure = {
    reason: "verified" as const,
    basis_seq: found.basis_seq as string,
    release: after,
    verification: input.verification,
    confirmation: null,
    last_report: null,
    note: null,
  };
  tx.sql.run(
    `update problems set status = 'closed', closure = ? where id = ?`,
    [JSON.stringify(closure), input.problem],
  );
  // 닫을 때 ProblemClosed event를 낸다(platform#T39 이어받음). 근거별 닫힘이다.
  tx.emit(problemClosed, input.problem, {
    previous_status: problemRow.status,
    closure,
  });
  return ok({ closure });
}

export const closeProblemVerifiedCommand: CommandDefinition<
  typeof closeProblemVerified
> = {
  route: closeProblemVerified,
  handle(tx, ctx, input) {
    return handleCloseProblemVerified(tx, ctx, input);
  },
};
