// 조건별 판정(coding-agent/tickets#R7, R8, R18, R19). 순수 함수다. model 호출도 I/O도 없다.
// 근거는 core가 읽어 준 사실뿐이다: 같은 app·bundle hash의 Verification, 앱 정본의 active
// release. shell 성공 문장·완료 summary·agent의 주장은 근거가 아니다(R18).
// 없는 근거는 inconclusive다(P11). 실제로 일어난 실패만 fail이다(P10).
import type {
  CheckWork,
  ReleaseFact,
  VerificationFact,
} from "./work.ts";

export type CheckResult = "pass" | "fail" | "inconclusive";

export type CheckTarget = {
  concern: string;
  id: string;
  revision: string;
  release: string | null;
};

export type ConditionDecision = {
  condition: number;
  result: CheckResult;
  reason: string;
  verification: string | null;
  targets: CheckTarget[];
};

export type TicketOutcome = "confirmed" | "check_failed" | "reported";

// 전부 pass일 때만 confirmed, 실제 fail 하나면 check_failed, 나머지는 reported다(R19).
export function outcomeOf(results: readonly CheckResult[]): TicketOutcome {
  if (results.includes("fail")) return "check_failed";
  if (results.length > 0 && results.every((result) => result === "pass")) {
    return "confirmed";
  }
  return "reported";
}

// 같은 근거가 여럿이면 결정이 난 것(pass·fail) 가운데 가장 나중의 것이다. 다시 돌린 결과가
// 앞선 결과를 대신하고, 판정 불가 기록은 결정이 난 기록을 가리지 못한다.
function latestDecisive(
  facts: readonly VerificationFact[],
): VerificationFact | undefined {
  for (let at = facts.length - 1; at >= 0; at--) {
    if (facts[at]!.result !== "inconclusive") return facts[at];
  }
  return undefined;
}

function fromTests(
  facts: readonly VerificationFact[],
  label: string,
  missing: string,
): Pick<ConditionDecision, "result" | "reason" | "verification"> {
  const decisive = latestDecisive(facts);
  if (decisive !== undefined) {
    return {
      result: decisive.result,
      reason: `${label} ${decisive.id} ${decisive.result}: ${decisive.reason}`,
      verification: decisive.id,
    };
  }
  const last = facts[facts.length - 1];
  if (last !== undefined) {
    return {
      result: "inconclusive",
      reason: `${label} ${last.id} could not decide: ${last.reason}`,
      verification: last.id,
    };
  }
  return { result: "inconclusive", reason: missing, verification: null };
}

// 보고 release와 같은 app·bundle hash의 Verification만 센다. 다른 묶음의 결과를 재사용하지 않는다.
function sameBundle(
  work: CheckWork,
  release: ReleaseFact,
  fact: VerificationFact,
): boolean {
  return fact.app === work.app && release.app === work.app &&
    fact.bundle_hash === release.bundle_hash;
}

function appTest(
  work: CheckWork,
  release: ReleaseFact,
): Pick<ConditionDecision, "result" | "reason" | "verification"> {
  return fromTests(
    work.verifications.filter((fact) =>
      fact.kind === "app_test" && sameBundle(work, release, fact)
    ),
    "app test",
    "no app test has run for the reported bundle",
  );
}

// test_command는 이번 completion·조건 번호·고정 조건 hash가 연결된 결과만 센다.
function testCommand(
  work: CheckWork,
  release: ReleaseFact,
  position: number,
  conditionHash: string,
): Pick<ConditionDecision, "result" | "reason" | "verification"> {
  return fromTests(
    work.verifications.filter((fact) =>
      fact.kind === "test_command" && sameBundle(work, release, fact) &&
      fact.ticket !== null && fact.ticket.ticket === work.ticket &&
      fact.ticket.check_index === position &&
      fact.ticket.check_hash === conditionHash &&
      fact.ticket.completion_seq === work.completion.seq
    ),
    "test command",
    "the test command has not run for this completion",
  );
}

// 실제 active release와 비교한다. 준비·승인 대기는 inconclusive, 활성화 실패는 fail이다.
function releaseActive(
  work: CheckWork,
  release: ReleaseFact,
): Pick<ConditionDecision, "result" | "reason" | "verification"> {
  const active = work.app_state?.active_release ?? null;
  if (release.status === "active" && active === release.id) {
    return {
      result: "pass",
      reason: `release ${release.id} is the active release`,
      verification: null,
    };
  }
  if (release.status === "failed") {
    return {
      result: "fail",
      reason: `activation of release ${release.id} failed${
        release.failure === null ? "" : `: ${release.failure}`
      }`,
      verification: null,
    };
  }
  if (release.status === "superseded") {
    return {
      result: "inconclusive",
      reason: `release ${release.id} is no longer active${
        active === null ? "" : `; ${active} is active`
      }`,
      verification: null,
    };
  }
  if (release.status === "active") {
    return {
      result: "inconclusive",
      reason: `the active release of the app is ${active ?? "unknown"}`,
      verification: null,
    };
  }
  return {
    result: "inconclusive",
    reason: release.status === "activating"
      ? `activation of release ${release.id} is in progress`
      : `release ${release.id} waits for activation approval`,
    verification: null,
  };
}

// 이 단계가 아직 판정하지 않는 조건이다. 통과도 실패도 아니다.
const LATER = {
  reproduction_test: "reproduction test is checked by the repair stage",
  problems_closed: "problem closure is checked by the repair stage",
  human_confirmation: "waiting for the person to confirm",
} as const;

export function judgeTicket(work: CheckWork): ConditionDecision[] {
  const release = work.release;
  return work.conditions.map((condition): ConditionDecision => {
    const base = {
      condition: condition.position,
      targets: [] as CheckTarget[],
    };
    if (condition.kind === "release_active") {
      if (release === null) {
        return {
          ...base,
          result: "inconclusive",
          reason: "the reported release was not found",
          verification: null,
        };
      }
      return {
        ...base,
        ...releaseActive(work, release),
        targets: work.app_state === null ? [] : [{
          concern: "apps",
          id: work.app,
          revision: work.app_state.revision,
          release: work.app_state.active_release,
        }],
      };
    }
    if (condition.kind === "app_test" || condition.kind === "test_command") {
      if (release === null) {
        return {
          ...base,
          result: "inconclusive",
          reason: "the reported release was not found",
          verification: null,
        };
      }
      return {
        ...base,
        ...(condition.kind === "app_test"
          ? appTest(work, release)
          : testCommand(
            work,
            release,
            condition.position,
            condition.condition_hash,
          )),
      };
    }
    return {
      ...base,
      result: "inconclusive",
      reason: LATER[condition.kind],
      verification: null,
    };
  });
}
