// 조건별 판정(coding-agent/tickets#R7, R8, R18, R19). 순수 함수다. model 호출도 I/O도 없다.
// 근거는 core가 읽어 준 사실뿐이다: 같은 app·bundle hash의 Verification, 앱 정본의 active
// release. shell 성공 문장·완료 summary·agent의 주장은 근거가 아니다(R18).
// 없는 근거는 inconclusive다(P11). 실제로 일어난 실패만 fail이다(P10).
import type {
  CheckWork,
  ProblemFact,
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

// 수리 ticket의 조건이 연결 문제를 빠짐없이 덮지 않으면 전부 pass여도 confirmed가 아니다(R9).
// 일부 문제만 통과했거나 대상 문제가 전부 빠진 ticket은 자동으로 확인되지 않는다.
function repairCoverageGap(work: CheckWork): string | null {
  const repair = work.conditions.some((condition) =>
    condition.kind === "reproduction_test" ||
    condition.kind === "human_confirmation" ||
    condition.kind === "problems_closed"
  );
  if (!repair) return null;
  if (work.problems.length === 0) return "the ticket has no target problem";
  if (!work.conditions.some((condition) => condition.kind === "problems_closed")) {
    return "the ticket does not require the problems to close";
  }
  const covered = new Set(
    work.conditions.flatMap((condition) =>
      condition.input.kind === "reproduction_test" ||
        condition.input.kind === "human_confirmation"
        ? [condition.input.problem]
        : []
    ),
  );
  const missing = work.problems.find((problem) => !covered.has(problem));
  return missing === undefined
    ? null
    : `problem ${missing} has neither a reproduction test nor a human confirmation`;
}

// record_checks와 checker가 같은 규칙으로 ticket의 결과를 정한다.
export function ticketOutcome(
  work: CheckWork,
  results: readonly CheckResult[],
): TicketOutcome {
  const outcome = outcomeOf(results);
  return outcome === "confirmed" && repairCoverageGap(work) !== null
    ? "reported"
    : outcome;
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

// 문제 닫힘의 비교 대상 revision. 닫힘 근거가 바뀌면(재발·다시 닫힘) 달라진다.
function problemTarget(fact: ProblemFact): CheckTarget {
  const closure = fact.closure;
  return {
    concern: "problems",
    id: fact.id,
    revision: closure === null
      ? fact.status
      : `closed/${closure.reason}/${closure.release ?? "-"}/${closure.basis_seq}`,
    release: closure?.release ?? null,
  };
}

function problemOf(work: CheckWork, id: string): ProblemFact | undefined {
  return work.problem_facts.find((fact) =>
    fact.id === id && fact.app === work.app
  );
}

// problems/reproduction의 고정 test hash·문제·보고 after release·같은 묶음의 Verification만 센다.
function reproduction(
  work: CheckWork,
  release: ReleaseFact,
  problem: string,
  testHash: string,
): Pick<ConditionDecision, "result" | "reason" | "verification"> {
  return fromTests(
    work.verifications.filter((fact) =>
      fact.kind === "reproduction" && sameBundle(work, release, fact) &&
      fact.problem === problem && fact.test === testHash &&
      fact.after_release === release.id
    ),
    "reproduction test",
    "no reproduction test has run for this problem, test and release",
  );
}

// 이 보고의 고친 release로 닫힌 문제인지. 닫힘은 problems/closing이 이미 정했다(R21).
function closedByReport(
  work: CheckWork,
  fact: ProblemFact | undefined,
  id: string,
): string | null {
  if (fact === undefined) return `problem ${id} was not found`;
  if (fact.status !== "closed" || fact.closure === null) {
    return `problem ${id} is still ${fact.status}`;
  }
  if (fact.closure.reason === "dismissed") {
    return `problem ${id} was dismissed, not fixed by a release`;
  }
  if (fact.closure.release !== work.completion.release) {
    return `problem ${id} was closed by release ${
      fact.closure.release ?? "none"
    }, not the reported release ${work.completion.release}`;
  }
  return null;
}

function problemsClosed(
  work: CheckWork,
): Pick<ConditionDecision, "result" | "reason" | "verification" | "targets"> {
  if (work.problems.length === 0) {
    return {
      result: "inconclusive",
      reason: "the ticket has no target problem",
      verification: null,
      targets: [],
    };
  }
  const waiting = work.problems.flatMap((id) => {
    const why = closedByReport(work, problemOf(work, id), id);
    return why === null ? [] : [why];
  });
  const targets = work.problems.flatMap((id) => {
    const fact = problemOf(work, id);
    return fact === undefined ? [] : [problemTarget(fact)];
  });
  return waiting.length === 0
    ? {
      result: "pass",
      reason: `every target problem was closed by release ${work.completion.release}`,
      verification: null,
      targets,
    }
    : {
      result: "inconclusive",
      reason: waiting.join("; "),
      verification: null,
      targets,
    };
}

// "내가 확인함"이다. 문제 닫힘 가운데 사람이 이 release를 확인한 닫힘(user_confirmed)만 센다.
// Verification이 아니고 test 통과로 세지 않는다(R9).
function humanConfirmation(
  work: CheckWork,
  problem: string,
): Pick<ConditionDecision, "result" | "reason" | "verification" | "targets"> {
  const fact = problemOf(work, problem);
  const closure = fact?.closure ?? null;
  const confirmed = fact !== undefined && fact.status === "closed" &&
    closure !== null && closure.reason === "user_confirmed" &&
    closure.confirmation !== null &&
    closure.release === work.completion.release;
  return {
    result: confirmed ? "pass" : "inconclusive",
    reason: confirmed
      ? `the person confirmed problem ${problem} on release ${work.completion.release}`
      : `waiting for the person to confirm problem ${problem}`,
    verification: null,
    targets: fact === undefined ? [] : [problemTarget(fact)],
  };
}

export function judgeTicket(work: CheckWork): ConditionDecision[] {
  const release = work.release;
  return work.conditions.map((condition): ConditionDecision => {
    const base = {
      condition: condition.position,
      targets: [] as CheckTarget[],
    };
    const input = condition.input;
    // 문제 닫힘과 사람 확인은 보고 release 사실이 없어도 같은 정본에서 비교한다.
    if (input.kind === "problems_closed") {
      return { ...base, ...problemsClosed(work) };
    }
    if (input.kind === "human_confirmation") {
      return { ...base, ...humanConfirmation(work, input.problem) };
    }
    if (release === null) {
      return {
        ...base,
        result: "inconclusive",
        reason: "the reported release was not found",
        verification: null,
      };
    }
    switch (input.kind) {
      case "release_active":
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
      case "app_test":
        return { ...base, ...appTest(work, release) };
      case "test_command":
        return {
          ...base,
          ...testCommand(
            work,
            release,
            condition.position,
            condition.condition_hash,
          ),
        };
      case "reproduction_test":
        return {
          ...base,
          ...reproduction(work, release, input.problem, input.test_hash),
        };
    }
  });
}
