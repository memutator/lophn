// 테스트로 확인됨 닫힘의 후보 읽기와 만약의 만약 대상(problems/closing#R3, R4).
// architecture/problems 7.6. machine 판정기만 닫으며 판정의 근거는 problems/tests의
// reproduction 종류 pass Verification 하나뿐이다. app test·test command·agent의 통과
// 주장은 후보로 읽지 않는다.
import { err, ok, type Result } from "../../../base/mod.ts";
import type { Seq } from "../../../protocol/base/mod.ts";
import type { Verification } from "../../../protocol/problems/mod.ts";
import type { Closure } from "../../../protocol/problems/mod.ts";

// 닫힘이 참조하는 근거다. reproduction pass만 verified 근거다(closing#R3).
export type ClosureEvidence = {
  verification: Verification;
};

// reproduction 종류 pass만 verified 닫힘의 후보다(R3). result 검증은 저장된
// Verification의 사실 그대로다.
export function verifiedCandidate(
  verification: Verification,
): Result<ClosureEvidence | null> {
  if (verification.kind !== "reproduction" || verification.result !== "pass") {
    return ok(null);
  }
  if (verification.problem === null || verification.basis_seq === null) {
    return err({ code: "invalid_input", message: "근거 연결이 없다" });
  }
  if (verification.after === null) {
    return err({ code: "invalid_input", message: "근거 연결이 없다" });
  }
  return ok({ verification });
}

// 닫힘 요청 CAS의 재료다(R5, R14). 낡은 seq·release의 요청은 다시 읽지 않고 conflict다.
export type ConclusionBasis = {
  problem: string;
  problem_seq: Seq;
  release: string;
};

// verified 근거의 closure 값이다(closing domain). reason verified는 release·verification
// 필수이고 confirmation·last_report·note는 null이다.
export function verifiedClosure(evidence: ClosureEvidence): Closure {
  const verification = evidence.verification;
  return {
    reason: "verified",
    basis_seq: verification.basis_seq as string,
    release: verification.after,
    verification: verification.id,
    confirmation: null,
    last_report: null,
    note: null,
  };
}

type SqlGet = {
  get(
    sql: string,
    params?: readonly unknown[],
  ): Record<string, unknown> | undefined;
};

// 사람이 "아직입니다"(not_fixed)라고 한 뒤 같은 release·같은 근거로 고쳐짐 확인을 다시
// 제안하지 않는다(problems/closing#R10). 마지막 부정 확인 event의 release와 그 뒤 새 근거
// (같은 문제의 고친 기록·Verification)를 읽는다. 부정 확인이 없거나, 활성 release가 그때와
// 다르거나, 그 뒤 새 근거가 있으면 다시 제안한다.
export function offersFixedConfirmation(
  sql: SqlGet,
  problem: string,
  activeRelease: string | null,
): boolean {
  const last = sql.get(
    `select cast(seq as text) as seq,
            coalesce(json_extract(payload, '$.decision.release'),
                     json_extract(payload, '$.release')) as release
       from events
      where subject = ?
        and ((type = 'ProblemConfirmationRecorded'
              and json_extract(payload, '$.choice') = 'not_fixed')
          or (type = 'ProblemReopened'
              and json_extract(payload, '$.decision.choice') = 'not_fixed'))
      order by seq desc limit 1`,
    [problem],
  );
  if (last === undefined) return true;
  const release = last["release"] === null || last["release"] === undefined
    ? null
    : String(last["release"]);
  if (release !== activeRelease) return true;
  const evidence = sql.get(
    `select 1 as found from events
      where seq > ?
        and ((type = 'ProblemFixRecorded' and subject = ?)
          or (type = 'VerificationRecorded'
              and json_extract(payload, '$.problem') = ?))
      limit 1`,
    [BigInt(String(last["seq"])), problem, problem],
  );
  return evidence !== undefined;
}
