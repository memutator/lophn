// 테스트로 확인됨 닫힘의 후보 읽기와 만약의 만약 대상(problems/closing#R3, R4).
// architecture/problems 7.6. machine 판정기만 닫으며 판정의 근거는 problems/tests의
// reproduction 종류 pass Verification 하나뿐이다. app test·test command·agent의 통과
// 주장은 후보로 읽지 않는다.
import { err, ok, type Result } from "../../base/mod.ts";
import type { Seq } from "../../contracts/platform/mod.ts";
import type { Verification } from "../../contracts/problems/mod.ts";
import type { Closure } from "../../contracts/problems/mod.ts";

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
