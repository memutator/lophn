// 보고 release의 test 결과를 check 결과 한 줄로 옮긴다. 순수 함수다. 판정은 하지 않는다:
// 상태를 정하지 않고 결과와 근거(Verification)만 남긴다. shell 성공 문장·완료 summary·agent의
// 주장은 근거가 아니다. 없는 근거는 inconclusive, 실제로 일어난 실패만 fail이다.
import type { CheckResult } from "../../../../protocol/coding-agent/ticket/mod.ts";
import type { CheckWork, VerificationFact } from "./work.ts";

type CheckOutcome = {
  result: CheckResult;
  reason: string;
  verification: string | null;
};

// 같은 근거가 여럿이면 결정이 난 것(pass·fail) 가운데 가장 나중의 것이다.
function fromTests(
  facts: readonly VerificationFact[],
  label: string,
  missing: string,
): CheckOutcome {
  for (let at = facts.length - 1; at >= 0; at--) {
    const fact = facts[at]!;
    if (fact.result !== "inconclusive") {
      return {
        result: fact.result,
        reason: `${label} ${fact.id} ${fact.result}: ${fact.reason}`,
        verification: fact.id,
      };
    }
  }
  const last = facts[facts.length - 1];
  return last === undefined
    ? { result: "inconclusive", reason: missing, verification: null }
    : {
      result: "inconclusive",
      reason: `${label} ${last.id} could not decide: ${last.reason}`,
      verification: last.id,
    };
}

// text check는 program이 돌리지 않는다. App Engineer의 판단이다.
export function checkOutcomeOf(work: CheckWork): CheckOutcome | null {
  if (work.check.kind === "text") return null;
  const release = work.release;
  if (release === null || release.app !== work.app) {
    return {
      result: "inconclusive",
      reason: "the reported release was not found",
      verification: null,
    };
  }
  const sameBundle = (fact: VerificationFact) =>
    fact.app === work.app && fact.bundle_hash === release.bundle_hash;
  if (work.check.kind === "app_test") {
    return fromTests(
      work.verifications.filter((fact) =>
        fact.kind === "app_test" && sameBundle(fact)
      ),
      "app test",
      "no app test has run for the reported bundle",
    );
  }
  return fromTests(
    work.verifications.filter((fact) =>
      fact.kind === "examples" && sameBundle(fact) &&
      fact.ticket !== null && fact.ticket.ticket === work.ticket &&
      fact.ticket.completion_seq === work.completion_seq
    ),
    "examples",
    "the examples have not run for this report",
  );
}
