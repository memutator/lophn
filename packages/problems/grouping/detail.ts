import type { Closure } from "../../protocol/problems/mod.ts";
import type {
  ProblemDetail,
  ProblemTestFact,
  ProblemTestRecord,
  RepairState,
  RepairTicketFact,
  TestState,
  TestSummaryState,
} from "../../protocol/problems/mod.ts";

// 사용자용 문제 상세 projection(grouping#R12, closing#R13, tests#R5). 읽은 사실에서 사람이 아는
// en 문구만 만든다. 모르는 사실(undefined)은 성공이나 없음이 아니라 "모름"으로 보인다(P11).
// 닫힘 4종·테스트 결과·고쳤다는 주장은 서로 다른 값으로 따로 낸다(P10).
export type DetailFacts = {
  status: "open" | "fixing" | "closed";
  closure: Closure | null;
  // null은 지금 수리 ticket이 없음, undefined는 읽지 못함이다.
  ticket: RepairTicketFact | null | undefined;
  // 고친 기록(ProblemFixRecorded)이 있는가.
  fixRecorded: boolean;
  // undefined는 읽지 못함이다.
  tests: ProblemTestFact[] | undefined;
  // 지금 값으로 접지 않은 결과. undefined는 읽지 못함이라 줄을 만들지 않는다.
  recorded?: ProblemTestRecord[];
  // false면 고친 release가 활성이 아니다. undefined는 그 사실을 말하지 않는다.
  fixApplied?: boolean;
  // 선언한 fixer가 user인 문제의 사람 조치다.
  nextAction: string | null;
  // 지금 닫힘을 남긴 ProblemClosed의 시각이다. 사람 결정 근거의 시각으로 보인다.
  closedAt?: string | null;
  // 사람 결정 뒤의 사실이다(T21의 ProblemConfirmationRecorded·ProblemReopened).
  decision?: DecisionFacts;
};

export type DecisionFacts = {
  // closing의 offersFixedConfirmation 결과와 활성 release를 아는지를 합친 값이다.
  offerFixed: boolean;
  // 지금 닫힘 뒤가 아니라 마지막 "아직입니다"·다시 열림 event다. 없으면 null이다.
  last: {
    kind: "not_fixed" | "reopened_by_report" | "reopened_by_you";
    at: string;
  } | null;
};

type Owner = ProblemDetail["owner"];
type Repair = ProblemDetail["repair"];

const PROGRESS_LABEL = {
  open: "Open",
  fixing: "Being fixed",
  closed: "Closed",
} as const;

const KIND_LABEL = {
  reproduction: "Reproduction test",
  app_test: "App test",
  test_command: "Test command",
} as const;

const TEST_STATE_LABEL: Record<TestState, string> = {
  pending: "waiting to run",
  running: "running",
  pass: "passed",
  fail: "failed",
  unconfirmed: "finished without a confirmed result",
};

const RECORDED_LABEL: Record<ProblemTestRecord["state"], string> = {
  ...TEST_STATE_LABEL,
  not_run: "has not run",
};

// 운영에 적용되지 않은 수리다. app test 통과나 준비만으로는 닫지 않는다(closing#R2, R4).
const NOT_IN_USE = "The fixed version is not in use, so this stays open.";

const TESTS_LABEL: Record<TestSummaryState, string> = {
  unknown: "Test results could not be read.",
  not_run: "No test has run.",
  pending: "A test is waiting to run.",
  running: "A test is running.",
  pass: "Every test that ran passed.",
  fail: "A test failed.",
  unconfirmed: "A test finished without a confirmed result.",
};

const REPAIR_LABEL: Record<RepairState, string> = {
  needs_confirmation: "Needs confirmation",
  ready_to_hand_off: "Can be handed off",
  in_progress: "In progress",
  checking: "Checking",
  none: "No repair work yet",
  unknown: "Repair work could not be read",
};

const NOBODY: Owner = { kind: "nobody", label: "Nobody has taken this yet." };

const ASK_ENGINEER = "Ask the App Engineer to look into this problem.";
const CONFIRM_NEEDS = "Confirm what the repair request still needs.";
const HAND_OFF = "Hand this repair to a coding agent.";
const HAND_OFF_AGAIN =
  "The last check failed. Hand this repair to a coding agent again.";

function repairOf(
  status: DetailFacts["status"],
  ticket: DetailFacts["ticket"],
  nextAction: string | null,
): { repair: Repair; owner: Owner; action: string | null } {
  const make = (
    state: RepairState,
    needs: string[] = [],
    failed = false,
  ): Repair => ({
    state,
    label: REPAIR_LABEL[state],
    needs,
    last_check_failed: failed,
  });
  if (status === "closed") {
    return { repair: make("none"), owner: NOBODY, action: null };
  }
  if (ticket === undefined) {
    return {
      repair: make("unknown"),
      owner: { kind: "unknown", label: "Who is working on this is not known." },
      action: nextAction,
    };
  }
  if (
    ticket === null || ticket.state === "confirmed" ||
    ticket.state === "cancelled"
  ) {
    return {
      repair: make("none"),
      owner: NOBODY,
      action: nextAction ?? ASK_ENGINEER,
    };
  }
  if (ticket.state === "claimed") {
    return {
      repair: make("in_progress"),
      owner: {
        kind: "coding_agent",
        label: "A coding agent is working on this.",
      },
      action: nextAction,
    };
  }
  if (ticket.state === "reported") {
    return {
      repair: make("checking"),
      owner: {
        kind: "platform_check",
        label: "The reported fix is being checked.",
      },
      action: nextAction,
    };
  }
  // open과 check_failed는 아직 아무도 맡지 않은 상태이고, 준비 여부가 사람 조치를 정한다.
  const failed = ticket.state === "check_failed";
  if (ticket.readiness === "needs_confirmation") {
    return {
      repair: make("needs_confirmation", ticket.needs, failed),
      owner: NOBODY,
      action: CONFIRM_NEEDS,
    };
  }
  return {
    repair: make("ready_to_hand_off", [], failed),
    owner: NOBODY,
    action: failed ? HAND_OFF_AGAIN : HAND_OFF,
  };
}

const TEST_PRIORITY: TestState[] = [
  "fail",
  "unconfirmed",
  "running",
  "pending",
];

function testsOf(
  tests: DetailFacts["tests"],
): ProblemDetail["result"]["tests"] {
  const summary = (state: TestSummaryState) => ({
    state,
    label: TESTS_LABEL[state],
  });
  if (tests === undefined) return { ...summary("unknown"), items: [] };
  const items = tests.map((fact) => ({
    kind: fact.kind,
    state: fact.state,
    label: `${KIND_LABEL[fact.kind]} ${TEST_STATE_LABEL[fact.state]}`,
    ended_at: fact.ended_at,
  }));
  if (items.length === 0) return { ...summary("not_run"), items };
  const worst = TEST_PRIORITY.find((state) =>
    items.some((item) => item.state === state)
  );
  return { ...summary(worst ?? "pass"), items };
}

function recordedOf(
  records: DetailFacts["recorded"],
): ProblemDetail["result"]["recorded"] {
  if (records === undefined || records.length === 0) return undefined;
  return records.map((fact) => ({
    kind: fact.kind,
    state: fact.state,
    label: `${KIND_LABEL[fact.kind]} ${RECORDED_LABEL[fact.state]}`,
    ended_at: fact.ended_at,
  }));
}

function remainingOf(facts: DetailFacts): string | undefined {
  if (facts.status === "closed" || !facts.fixRecorded) return undefined;
  if (facts.fixApplied !== false) return undefined;
  return NOT_IN_USE;
}

const RELEASE_TEXT: Record<Closure["reason"], string> = {
  verified: "The fixed version of the app that was active when this closed.",
  user_confirmed: "The app version you were using when you confirmed.",
  recovered: "The app version you were using when you confirmed.",
  dismissed: "The app version that was active when you decided.",
};

const REOPEN = "A new report from the active release reopens this problem.";

const NOT_PROVEN = "The underlying cause is not proven.";
const EFFECTS =
  "Effects outside the app, such as other services, were not confirmed.";
const NO_TEST = "No test ran for this.";

function closedOf(
  closure: Closure,
  tests: ProblemDetail["result"]["tests"],
  at: string | null,
): NonNullable<ProblemDetail["closed"]> {
  const release = closure.release === null
    ? null
    : RELEASE_TEXT[closure.reason];
  if (closure.reason === "verified") {
    const passed = tests.items.find((item) =>
      item.kind === "reproduction" && item.state === "pass"
    );
    return {
      reason: "verified",
      label: "Confirmed by a test",
      attention: `Nothing needed now. ${REOPEN}`,
      expanded: {
        scope:
          "A reproduction test failed before the fix and passed after it, and no new report arrived after the test was requested.",
        unconfirmed: [
          "Inputs other than the ones the test used were not tested.",
          EFFECTS,
          NOT_PROVEN,
        ],
        release,
        evidence: [
          passed === undefined
            ? { text: "The passing test result could not be read.", at: null }
            : { text: "Reproduction test passed.", at: passed.ended_at },
        ],
      },
    };
  }
  if (closure.reason === "user_confirmed") {
    return {
      reason: "user_confirmed",
      label: "Confirmed by you",
      attention: `No test confirmed this fix. ${REOPEN}`,
      expanded: {
        scope:
          "You confirmed it is fixed in the app version you were using. No test checked this.",
        unconfirmed: [NO_TEST, EFFECTS, NOT_PROVEN],
        release,
        evidence: [{ text: "Your confirmation.", at }],
      },
    };
  }
  if (closure.reason === "recovered") {
    return {
      reason: "recovered",
      label: "No longer seen",
      attention: `No fix is known. ${REOPEN}`,
      expanded: {
        scope:
          "You saw no sign of the problem in the app version you were using after its last report.",
        unconfirmed: [
          "No change is known to have fixed it.",
          "It may not have had a chance to occur again.",
          NO_TEST,
        ],
        release,
        evidence: [{
          text: "Your confirmation after the last report.",
          at,
        }],
      },
    };
  }
  return {
    reason: "dismissed",
    label: "Not pursued",
    attention: `Nobody is working on this. ${REOPEN}`,
    expanded: {
      scope: "You chose not to work on this problem. Nothing was checked.",
      unconfirmed: ["Whether the problem is fixed is unknown.", NO_TEST],
      release,
      evidence: [{
        text: `Your reason: ${closure.note ?? "none given"}`,
        at,
      }],
    },
  };
}

const LAST_DECISION_LABEL = {
  not_fixed: "You said this is not fixed yet.",
  reopened_by_report:
    "This was closed, and a new report from the active release reopened it.",
  reopened_by_you: "This was closed, and you said it is not fixed yet.",
} as const;

function decisionOf(
  status: DetailFacts["status"],
  facts: DecisionFacts | undefined,
): ProblemDetail["decision"] {
  if (facts === undefined) return undefined;
  if (status === "closed") return { offer_fixed: false, last: null };
  return {
    offer_fixed: facts.offerFixed,
    last: facts.last === null ? null : {
      kind: facts.last.kind,
      label: LAST_DECISION_LABEL[facts.last.kind],
      at: facts.last.at,
    },
  };
}

export function projectProblemDetail(facts: DetailFacts): ProblemDetail {
  const { repair, owner, action } = repairOf(
    facts.status,
    facts.ticket,
    facts.nextAction,
  );
  const tests = testsOf(facts.tests);
  const recorded = recordedOf(facts.recorded);
  const remaining = remainingOf(facts);
  const reported = facts.fixRecorded ||
    (facts.ticket !== undefined && facts.ticket !== null &&
      (facts.ticket.state === "reported" ||
        facts.ticket.state === "check_failed"));
  return {
    progress: {
      state: facts.status,
      label: PROGRESS_LABEL[facts.status],
    },
    owner,
    needed_action: action,
    repair,
    result: {
      fix_report: reported ? "reported" : "none",
      fix_report_label: reported
        ? "A fix was reported. This is the agent's word, not a confirmation."
        : "No fix has been reported.",
      tests,
      ...(recorded === undefined ? {} : { recorded }),
      ...(remaining === undefined ? {} : { remaining }),
    },
    closed: facts.status === "closed" && facts.closure !== null
      ? closedOf(facts.closure, tests, facts.closedAt ?? null)
      : null,
    ...(facts.decision === undefined
      ? {}
      : { decision: decisionOf(facts.status, facts.decision) }),
  };
}
