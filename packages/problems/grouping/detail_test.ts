// 닫힘·수리·테스트 data는 T21과 뒤 wiring이 만들 값이라 fixture(fake)로 넣는다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import {
  TICKET_READINESS,
  TICKET_STATES,
} from "../../protocol/coding-agent/mod.ts";
import {
  type Closure,
  CLOSURE_REASONS,
  problemDetailSchema,
  type ProblemTestFact,
  type RepairTicketFact,
  WORK_STATES,
} from "../../protocol/problems/mod.ts";
import { type DetailFacts, projectProblemDetail } from "./detail.ts";

const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const VRF = "vrf_01arz3ndektsv4rrffq69g5fav";
const RPT = "rpt_01arz3ndektsv4rrffq69g5fav";
const CONFIRM = "confirmation-handle-ref";
const ENDED = "2026-10-07T01:02:03.000Z";

const CLOSURES: Record<Closure["reason"], Closure> = {
  verified: {
    reason: "verified",
    basis_seq: "5",
    release: REL,
    verification: VRF,
    confirmation: null,
    last_report: null,
    note: null,
  },
  user_confirmed: {
    reason: "user_confirmed",
    basis_seq: "5",
    release: REL,
    verification: null,
    confirmation: CONFIRM,
    last_report: null,
    note: null,
  },
  recovered: {
    reason: "recovered",
    basis_seq: "5",
    release: REL,
    verification: null,
    confirmation: CONFIRM,
    last_report: RPT,
    note: null,
  },
  dismissed: {
    reason: "dismissed",
    basis_seq: "5",
    release: REL,
    verification: null,
    confirmation: CONFIRM,
    last_report: null,
    note: "Not worth the time",
  },
};

function facts(patch: Partial<DetailFacts> = {}): DetailFacts {
  return {
    status: "open",
    closure: null,
    ticket: null,
    fixRecorded: false,
    tests: [],
    nextAction: null,
    ...patch,
  };
}

function closed(reason: Closure["reason"], patch: Partial<DetailFacts> = {}) {
  return projectProblemDetail(
    facts({ status: "closed", closure: CLOSURES[reason], ...patch }),
  );
}

const passed: ProblemTestFact = {
  kind: "reproduction",
  state: "pass",
  ended_at: ENDED,
};

function ticket(patch: Partial<RepairTicketFact>): RepairTicketFact {
  return { state: "open", readiness: "ready", needs: [], ...patch };
}

Deno.test("problems/closing#R13: the four closure kinds are distinct values with distinct text", () => {
  const details = CLOSURE_REASONS.map((reason) => {
    const detail = closed(reason, { tests: [passed] });
    assert(problemDetailSchema.safeParse(detail).success);
    return detail.closed!;
  });
  assertEquals(details.map((value) => value.reason), [...CLOSURE_REASONS]);
  for (const field of ["label", "attention"] as const) {
    assertEquals(new Set(details.map((value) => value[field])).size, 4);
  }
  assertEquals(
    new Set(details.map((value) => value.expanded.scope)).size,
    4,
  );
});

Deno.test("problems/closing#R13: by default the reason and the attention come first and scope, unconfirmed parts, release and evidence are expanded detail", () => {
  const detail = closed("verified", { tests: [passed] });
  assertEquals(detail.progress, { state: "closed", label: "Closed" });
  const value = detail.closed!;
  assertEquals(value.label, "Confirmed by a test");
  assert(value.attention.length > 0);
  assertEquals(Object.keys(value.expanded).sort(), [
    "evidence",
    "release",
    "scope",
    "unconfirmed",
  ]);
  assertEquals(value.expanded.evidence, [{
    text: "Reproduction test passed.",
    at: ENDED,
  }]);
  assert(value.expanded.release!.startsWith("The fixed version"));
  // 사용자용 상세에는 release·verification·confirmation·ticket ID가 없다.
  const text = JSON.stringify(detail);
  for (const internal of [REL, VRF, RPT, CONFIRM, "tkt_", "ver_"]) {
    assert(!text.includes(internal), internal);
  }
});

Deno.test("problems/closing#R13: tests not run, unconfirmed external effects and no chance to occur never count as success", () => {
  const verifiedUnread = closed("verified", { tests: undefined });
  assertEquals(verifiedUnread.closed!.expanded.evidence, [{
    text: "The passing test result could not be read.",
    at: null,
  }]);
  assertEquals(verifiedUnread.result.tests.state, "unknown");
  assert(
    verifiedUnread.closed!.expanded.unconfirmed.some((line) =>
      line.includes("Effects outside the app")
    ),
  );

  const confirmed = closed("user_confirmed", { tests: [] });
  assertEquals(confirmed.result.tests.state, "not_run");
  assert(
    confirmed.closed!.expanded.unconfirmed.includes("No test ran for this."),
  );
  assertEquals(confirmed.closed!.expanded.scope.includes("No test"), true);

  const recovered = closed("recovered", { tests: [] });
  assert(
    recovered.closed!.expanded.unconfirmed.includes(
      "It may not have had a chance to occur again.",
    ),
  );
  assert(
    recovered.closed!.expanded.unconfirmed.includes(
      "No change is known to have fixed it.",
    ),
  );

  const dismissed = closed("dismissed", { tests: [] });
  assert(
    dismissed.closed!.expanded.unconfirmed.includes(
      "Whether the problem is fixed is unknown.",
    ),
  );
  assertEquals(dismissed.closed!.expanded.evidence, [{
    text: "Your reason: Not worth the time",
    at: null,
  }]);
  // 어느 것도 verified 문구(테스트로 확인됨)를 빌리지 않는다.
  for (const value of [confirmed, recovered, dismissed]) {
    assertNotEquals(value.closed!.label, "Confirmed by a test");
  }
});

Deno.test("problems/grouping#R12: progress, the actual owner and the human action come first and each work state has its own en text", () => {
  const cases: [
    string,
    DetailFacts["ticket"],
    string,
    string,
    string | null,
  ][] = [
    [
      "needs_confirmation",
      ticket({ readiness: "needs_confirmation", needs: ["Which screen?"] }),
      "Needs confirmation",
      "nobody",
      "Confirm what the repair request still needs.",
    ],
    [
      "ready_to_hand_off",
      ticket({}),
      "Can be handed off",
      "nobody",
      "Hand this repair to a coding agent.",
    ],
    [
      "in_progress",
      ticket({ state: "claimed" }),
      "In progress",
      "coding_agent",
      null,
    ],
    [
      "checking",
      ticket({ state: "reported" }),
      "Checking",
      "platform_check",
      null,
    ],
  ];
  assertEquals(cases.map((row) => row[0]), [...WORK_STATES]);
  for (const [state, fact, label, owner, action] of cases) {
    const detail = projectProblemDetail(
      facts({
        status: state === "in_progress" ? "fixing" : "open",
        ticket: fact,
      }),
    );
    assert(problemDetailSchema.safeParse(detail).success);
    assertEquals(detail.repair.state, state);
    assertEquals(detail.repair.label, label);
    assertEquals(detail.owner.kind, owner);
    assertEquals(detail.needed_action, action);
    assertEquals(Object.keys(detail).slice(0, 3), [
      "progress",
      "owner",
      "needed_action",
    ]);
    // claim·기한·연결 식별자 field는 없다.
    const text = JSON.stringify(detail);
    for (const banned of ["claim_seq", "expires_at", "connection", "tkt_"]) {
      assert(!text.includes(banned), banned);
    }
  }
  assertEquals(
    projectProblemDetail(facts({
      ticket: ticket({ readiness: "needs_confirmation", needs: ["A", "B"] }),
    })).repair.needs,
    ["A", "B"],
  );
});

Deno.test("problems/grouping#R12: no ticket gives no fake owner and an unreadable ticket is unknown, not none", () => {
  const none = projectProblemDetail(facts({ ticket: null }));
  assertEquals(none.owner.kind, "nobody");
  assertEquals(none.repair.state, "none");
  assert(none.needed_action !== null);
  const declared = projectProblemDetail(
    facts({ ticket: null, nextAction: "Adjust the settings." }),
  );
  assertEquals(declared.needed_action, "Adjust the settings.");

  const unknown = projectProblemDetail(facts({ ticket: undefined }));
  assertEquals(unknown.owner.kind, "unknown");
  assertEquals(unknown.repair.state, "unknown");

  // 끝난 ticket은 지금 담당이 아니다. 실패한 확인은 다시 맡길 수 있음으로 보인다.
  assertEquals(
    projectProblemDetail(facts({ ticket: ticket({ state: "cancelled" }) }))
      .repair.state,
    "none",
  );
  const failed = projectProblemDetail(
    facts({ ticket: ticket({ state: "check_failed" }) }),
  );
  assertEquals(failed.repair.state, "ready_to_hand_off");
  assertEquals(failed.repair.last_check_failed, true);
  assertEquals(failed.result.fix_report, "reported");
});

Deno.test("problems/tests#R5: the fix claim and each test state are told apart next to the same problem", () => {
  const states = ["pending", "running", "pass", "fail", "unconfirmed"] as const;
  const labels = new Set<string>();
  for (const state of states) {
    const detail = projectProblemDetail(facts({
      fixRecorded: true,
      tests: [{ kind: "reproduction", state, ended_at: null }],
    }));
    assertEquals(detail.result.fix_report, "reported");
    assertEquals(detail.result.tests.state, state);
    assertEquals(detail.result.tests.items[0].state, state);
    labels.add(detail.result.tests.label);
  }
  assertEquals(labels.size, 5);

  // 완료 보고만으로 테스트 상태가 통과나 정상이 되지 않는다.
  const claimOnly = projectProblemDetail(facts({
    fixRecorded: true,
    tests: [],
  }));
  assertEquals(claimOnly.result.fix_report, "reported");
  assertEquals(claimOnly.result.tests.state, "not_run");
  assertEquals(claimOnly.closed, null);
  assertEquals(
    projectProblemDetail(facts({ tests: undefined })).result.tests.state,
    "unknown",
  );
  assertEquals(
    projectProblemDetail(facts({})).result.fix_report,
    "none",
  );
});

Deno.test("problems/tests#R5: a failed or unconfirmed test outranks a passed one and keeps the ended time", () => {
  const detail = projectProblemDetail(facts({
    tests: [
      passed,
      { kind: "app_test", state: "fail", ended_at: ENDED },
      { kind: "test_command", state: "unconfirmed", ended_at: null },
    ],
  }));
  assertEquals(detail.result.tests.state, "fail");
  assertEquals(detail.result.tests.items.map((item) => item.state), [
    "pass",
    "fail",
    "unconfirmed",
  ]);
  assertEquals(detail.result.tests.items[1].ended_at, ENDED);
  assertEquals(
    projectProblemDetail(facts({
      tests: [passed, { kind: "app_test", state: "pending", ended_at: null }],
    })).result.tests.state,
    "pending",
  );
});

Deno.test("problems/tests#R4 problems/closing#R2 problems/closing#R4: 적용되지 않은 고친 기록은 통과·실패·판정 불가·미실행과 남은 확인을 구별하고 닫지 않는다", () => {
  const detail = projectProblemDetail(facts({
    status: "fixing",
    fixRecorded: true,
    fixApplied: false,
    tests: [{ kind: "app_test", state: "pass", ended_at: ENDED }],
    recorded: [
      { kind: "reproduction", state: "pass", ended_at: ENDED },
      { kind: "reproduction", state: "fail", ended_at: ENDED },
      { kind: "reproduction", state: "unconfirmed", ended_at: null },
      { kind: "app_test", state: "not_run", ended_at: null },
    ],
  }));
  assert(problemDetailSchema.safeParse(detail).success, "detail");
  assertEquals(detail.progress.state, "fixing");
  assertEquals(detail.closed, null);
  assertEquals(detail.result.tests.state, "pass");
  assertEquals(
    detail.result.remaining,
    "The fixed version is not in use, so this stays open.",
  );
  const recorded = detail.result.recorded ?? [];
  assertEquals(recorded.map((item) => item.state), [
    "pass",
    "fail",
    "unconfirmed",
    "not_run",
  ]);
  assertEquals(new Set(recorded.map((item) => item.label)).size, 4);
  assertEquals(recorded[0]?.ended_at, ENDED);
  assertEquals(recorded[3]?.ended_at, null);
  const applied = projectProblemDetail(facts({
    fixRecorded: true,
    fixApplied: true,
    tests: [{ kind: "app_test", state: "pass", ended_at: ENDED }],
  }));
  assertEquals(applied.result.remaining, undefined);
  assertEquals(applied.closed, null);
  const closed = projectProblemDetail(facts({
    status: "closed",
    closure: CLOSURES.verified,
    fixRecorded: true,
    fixApplied: false,
    tests: [passed],
  }));
  assertEquals(closed.result.remaining, undefined);
});

Deno.test("problems/grouping#R12: the ticket fact values match coding-agent getTicket state and readiness", () => {
  const states: RepairTicketFact["state"][] = [
    "open",
    "claimed",
    "reported",
    "confirmed",
    "check_failed",
    "cancelled",
  ];
  const readiness: RepairTicketFact["readiness"][] = [
    "needs_confirmation",
    "ready",
  ];
  assertEquals(states, [...TICKET_STATES]);
  assertEquals(readiness, [...TICKET_READINESS]);
});

Deno.test("problems/closing#R10 R13: user decisions carry the close time and an open problem shows its last not_fixed or reopen", () => {
  const AT = "2026-10-08T03:04:05.000Z";
  for (const reason of ["user_confirmed", "recovered", "dismissed"] as const) {
    const detail = closed(reason, { closedAt: AT });
    assertEquals(detail.closed!.expanded.evidence[0]!.at, AT);
  }
  // 닫힌 문제는 제안도 마지막 결정 안내도 없다.
  const closedDetail = closed("user_confirmed", {
    decision: { offerFixed: true, last: { kind: "not_fixed", at: AT } },
  });
  assertEquals(closedDetail.decision, { offer_fixed: false, last: null });

  const labels = new Set<string>();
  for (
    const kind of [
      "not_fixed",
      "reopened_by_report",
      "reopened_by_you",
    ] as const
  ) {
    const detail = projectProblemDetail(facts({
      decision: {
        offerFixed: kind === "reopened_by_report",
        last: { kind, at: AT },
      },
    }));
    assert(problemDetailSchema.safeParse(detail).success);
    assertEquals(detail.decision!.last!.kind, kind);
    assertEquals(detail.decision!.last!.at, AT);
    assertEquals(detail.decision!.offer_fixed, kind === "reopened_by_report");
    labels.add(detail.decision!.last!.label);
  }
  assertEquals(labels.size, 3);
});
