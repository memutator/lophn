// repair ticket 검사 테스트(coding-agent/tickets#R9, R20, R21; plan coding-agent T45).
// problems/tests·problems/closing이 만드는 사실(reproduction Verification, 문제 닫힘·재발,
// 사람 결정)은 그 command가 쓰는 모양 그대로 심는다: closure는 contract closureSchema로 만들고
// 문제 표와 함께 `ProblemClosed`·`ProblemReopened`·`ProblemConfirmationRecorded` event를 낸다.
// 사람 확인 닫힘의 confirmation은 handle이 아니라 `ApplyProblemDecision@<basis_seq>` 참조다.
// 제품 core의 실제 command 경로는 apps/core/ticket-checker_test.ts가 본다.
import { assert, assertEquals } from "@std/assert";
import { ok } from "../../base/mod.ts";
import { seqSchema } from "../../contracts/platform/mod.ts";
import {
  applyProblemDecision,
  type Closure as ProblemClosure,
  closureSchema,
  problemClosed,
  problemConfirmationRecorded,
  problemReopened,
} from "../../contracts/problems/mod.ts";
import { createTicketCheckCommands, loadCheckWork } from "./checks.ts";
import { judgeTicket } from "./checker/mod.ts";
import { APP, PRB, PRB_B, ticketFixture, userContext } from "./fixture.ts";

const TICKET = "tkt_01arz3ndektsv4rrffq69g5fav";
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const REL_OTHER = "rel_01arz3ndektsv4rrffq69g5faw";
const BUNDLE = "b".repeat(64);
const OTHER_BUNDLE = "c".repeat(64);
const TEST_HASH = "e".repeat(64);
const OTHER_TEST_HASH = "f".repeat(64);
const COMPLETION = "10";
const VRF_REPRO = "vrf_01arz3ndektsv4rrffq69g5fav";
const VRF_REPRO_B = "vrf_01arz3ndektsv4rrffq69g5faw";
const checks = createTicketCheckCommands();

type Ledger = ReturnType<typeof ticketFixture>;
type Condition = [kind: string, input: Record<string, unknown>];

const reproduction = (problem: string, test_hash = TEST_HASH): Condition => [
  "reproduction_test",
  { kind: "reproduction_test", problem, test_hash },
];
const human = (problem: string): Condition => [
  "human_confirmation",
  { kind: "human_confirmation", problem },
];
const closedCondition: Condition = [
  "problems_closed",
  { kind: "problems_closed" },
];

// 보고까지 끝난 repair ticket 한 장. 조건은 주어진 순서가 position이다.
function seed(
  ledger: Ledger,
  conditions: Condition[],
  problems: string[],
): void {
  const { sql } = ledger;
  sql.run(
    `INSERT INTO tickets (id, app, kind, title, what, why, inspect, preserve, problems,
       state, readiness, needs, cancel_reason, completion_seq, revision)
     VALUES (?, ?, 'repair', 't', 'w', 'y', '[]', '[]', ?, 'reported', 'ready', '[]', NULL, ?, ?)`,
    [TICKET, APP, JSON.stringify(problems), COMPLETION, "11"],
  );
  conditions.forEach(([kind, input], position) =>
    sql.run(
      `INSERT INTO ticket_conditions (ticket, position, kind, input, condition_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [TICKET, position, kind, JSON.stringify(input), "d".repeat(64)],
    )
  );
  sql.run(
    `INSERT INTO ticket_completions (ticket, seq, claim_seq, release, summary_hash, outputs,
       fix_records, verifications)
     VALUES (?, ?, '9', ?, ?, '[]', '[]', '[]')`,
    [TICKET, COMPLETION, REL, "a".repeat(64)],
  );
  sql.run(
    `INSERT INTO releases (id, app, ticket_source, bundle_hash, status, failure)
     VALUES (?, ?, NULL, ?, 'active', NULL)`,
    [REL, APP, BUNDLE],
  );
  sql.run(
    "INSERT INTO apps (id, revision, active_release) VALUES (?, '5', ?)",
    [APP, REL],
  );
  for (const problem of problems) {
    sql.run(
      "INSERT INTO problems (id, app, status, closure) VALUES (?, ?, 'open', NULL)",
      [problem, APP],
    );
  }
}

function verifyReproduction(
  ledger: Ledger,
  patch: Partial<{
    id: string;
    problem: string;
    test: string;
    after: string;
    bundle: string;
    result: string;
    seq: number;
  }> = {},
): void {
  ledger.sql.run(
    `INSERT INTO verifications (id, app, kind, result, reason, target_bundle_hash,
       recorded_seq, problem, test, after_release)
     VALUES (?, ?, 'reproduction', ?, 'replayed', ?, ?, ?, ?, ?)`,
    [
      patch.id ?? VRF_REPRO,
      APP,
      patch.result ?? "pass",
      patch.bundle ?? BUNDLE,
      String(patch.seq ?? 1),
      patch.problem ?? PRB,
      patch.test ?? TEST_HASH,
      patch.after ?? REL,
    ],
  );
}

type Closure = {
  reason: "verified" | "user_confirmed" | "recovered" | "dismissed";
  release: string | null;
  verification?: string | null;
  confirmation?: string | null;
  note?: string | null;
};

function problemSeq(ledger: Ledger, problem: string): string {
  const row = ledger.sql.get(
    "SELECT cast(max(seq) AS text) AS seq FROM events WHERE subject = ?",
    [problem],
  );
  return row?.["seq"] === null || row?.["seq"] === undefined
    ? "0"
    : String(row["seq"]);
}

function problemRow(ledger: Ledger, problem: string) {
  const row = ledger.sql.get(
    "SELECT status, closure FROM problems WHERE id = ?",
    [problem],
  )!;
  return {
    status: String(row["status"]) as "open" | "fixing" | "closed",
    closure: row["closure"] === null
      ? null
      : closureSchema.parse(JSON.parse(String(row["closure"]))),
  };
}

// problems/closing의 닫힘과 같다: 문제 seq가 basis이고 closure는 contract 모양이며
// ProblemClosed를 낸다. user_confirmed의 기본 confirmation은 사람 결정 참조다.
function close(ledger: Ledger, problem: string, input: Closure): void {
  const basis = problemSeq(ledger, problem);
  const closure: ProblemClosure = closureSchema.parse({
    basis_seq: basis,
    verification: null,
    confirmation: input.reason === "verified"
      ? null
      : `${applyProblemDecision.name}@${basis}`,
    last_report: null,
    note: input.reason === "dismissed" ? "won't fix" : null,
    ...input,
  });
  const before = problemRow(ledger, problem);
  if (before.status === "closed") reopen(ledger, problem);
  ledger.transaction((tx) => {
    tx.sql.run(
      "UPDATE problems SET status = 'closed', closure = ? WHERE id = ?",
      [JSON.stringify(closure), problem],
    );
    tx.emit(problemClosed, problem, {
      previous_status: "open",
      closure,
    });
    return ok(null);
  });
}

// 사람의 not_fixed 결정이다. 열린 문제는 ProblemConfirmationRecorded만 남고, 닫힌 문제는
// 같은 ID로 다시 열린다(ProblemReopened, problems/closing#R10).
function notFixed(ledger: Ledger, problem: string, release = REL): void {
  const decision = {
    choice: "not_fixed" as const,
    problem,
    basis_seq: problemSeq(ledger, problem),
    release,
    last_report: null,
    note: null,
  };
  const before = problemRow(ledger, problem);
  ledger.transaction((tx) => {
    if (before.closure === null) {
      tx.emit(problemConfirmationRecorded, problem, decision);
    } else {
      tx.sql.run(
        "UPDATE problems SET status = 'open', closure = NULL WHERE id = ?",
        [problem],
      );
      tx.emit(problemReopened, problem, {
        previous: before.closure,
        report: null,
        decision,
      });
    }
    return ok(null);
  });
}

// 새 live 보고로 다시 열림(ProblemReopened, report)이다.
function reopen(ledger: Ledger, problem: string): void {
  const before = problemRow(ledger, problem);
  assert(before.closure !== null);
  ledger.transaction((tx) => {
    tx.sql.run(
      "UPDATE problems SET status = 'open', closure = NULL WHERE id = ?",
      [problem],
    );
    tx.emit(problemReopened, problem, {
      previous: before.closure!,
      report: "rpt_01arz3ndektsv4rrffq69g5fav",
      decision: null,
    });
    return ok(null);
  });
}

const verified = (release: string | null = REL): Closure => ({
  reason: "verified",
  release,
  verification: VRF_REPRO,
});
const userConfirmed = (release: string | null = REL): Closure => ({
  reason: "user_confirmed",
  release,
});

function judged(ledger: Ledger) {
  const work = loadCheckWork(ledger.sql, TICKET);
  assert(work !== null);
  return { work, decisions: judgeTicket(work) };
}

// checker가 하는 한 번: ledger를 새로 읽고 판정해 record_checks로 낸다(재시작 뒤 이어하기와 같다).
function runChecker(ledger: Ledger) {
  const { work, decisions } = judged(ledger);
  return ledger.transaction((tx) =>
    checks.record_checks.handle(tx, userContext("machine"), {
      ticket: TICKET,
      completion_seq: work.completion.seq,
      base_revision: work.revision,
      checks: decisions,
    }, { base_revision: work.revision })
  );
}

function state(ledger: Ledger): string {
  return String(
    ledger.sql.get("SELECT state FROM tickets WHERE id = ?", [
      TICKET,
    ])!["state"],
  );
}

function results(ledger: Ledger): string[] {
  return ledger.sql.all(
    "SELECT result FROM ticket_check_results WHERE ticket = ? ORDER BY condition",
    [TICKET],
  ).map((row) => String(row["result"]));
}

Deno.test("coding-agent/tickets#R9: a reproduction test counts only for its problem, fixed test hash and reported release", () => {
  const ledger = ticketFixture();
  seed(ledger, [reproduction(PRB), closedCondition], [PRB]);
  verifyReproduction(ledger, { id: VRF_REPRO_B, problem: PRB_B, seq: 1 });
  verifyReproduction(ledger, {
    id: "vrf_01arz3ndektsv4rrffq69g5fax",
    test: OTHER_TEST_HASH,
    seq: 2,
  });
  verifyReproduction(ledger, {
    id: "vrf_01arz3ndektsv4rrffq69g5fay",
    after: REL_OTHER,
    seq: 3,
  });
  verifyReproduction(ledger, {
    id: "vrf_01arz3ndektsv4rrffq69g5faz",
    bundle: OTHER_BUNDLE,
    seq: 4,
  });
  // 다른 문제·다른 test hash·다른 release·다른 묶음의 통과는 이 조건의 근거가 아니다.
  const none = judged(ledger).decisions[0]!;
  assertEquals(none.result, "inconclusive");
  assertEquals(none.verification, null);
  verifyReproduction(ledger, { seq: 5 });
  const matched = judged(ledger).decisions[0]!;
  assertEquals(matched.result, "pass");
  assertEquals(matched.verification, VRF_REPRO);
  ledger.close();
});

Deno.test("coding-agent/tickets#R9: a failed reproduction test is a real failure and a late inconclusive does not hide a decision", () => {
  const ledger = ticketFixture();
  seed(ledger, [reproduction(PRB), closedCondition], [PRB]);
  verifyReproduction(ledger, { result: "fail", seq: 1 });
  verifyReproduction(ledger, {
    id: VRF_REPRO_B,
    result: "inconclusive",
    seq: 2,
  });
  const done = runChecker(ledger);
  assert(done.ok);
  assertEquals(done.value.state, "check_failed");
  assertEquals(results(ledger), ["fail", "inconclusive"]);
  ledger.close();
});

Deno.test("coding-agent/tickets#R9: a human confirmation is I-checked, not a Verification and not a test pass", () => {
  const ledger = ticketFixture();
  seed(ledger, [human(PRB), closedCondition], [PRB]);
  // 사람이 이 release를 확인해 문제가 닫혔다.
  close(ledger, PRB, userConfirmed());
  const decision = judged(ledger).decisions[0]!;
  assertEquals(decision.result, "pass");
  assertEquals(decision.verification, null);
  const done = runChecker(ledger);
  assert(done.ok);
  assertEquals(done.value.state, "confirmed");
  // 확인이 Verification 표에 행을 만들지 않는다.
  assertEquals(
    ledger.sql.all("SELECT id FROM verifications", []).length,
    0,
  );
  ledger.close();

  // 사람 확인으로 닫힌 문제는 reproduction_test 조건을 대신하지 못한다.
  const test = ticketFixture();
  seed(test, [reproduction(PRB), closedCondition], [PRB]);
  close(test, PRB, userConfirmed());
  assertEquals(judged(test).decisions[0]!.result, "inconclusive");
  test.close();

  // 다른 release를 확인했거나 확인 근거가 없는 닫힘은 이 보고의 확인이 아니다.
  const other = ticketFixture();
  seed(other, [human(PRB), closedCondition], [PRB]);
  close(other, PRB, userConfirmed(REL_OTHER));
  assertEquals(judged(other).decisions[0]!.result, "inconclusive");
  // 사람 결정 참조가 아닌 확인 값(handle 원문 등)은 사람 확인 근거가 아니다.
  close(other, PRB, {
    reason: "user_confirmed",
    release: REL,
    confirmation: "cfm_handle",
  });
  assertEquals(judged(other).decisions[0]!.result, "inconclusive");
  other.close();
});

Deno.test("coding-agent/tickets#R21: problems_closed reads the decided closure and this report's release", () => {
  const ledger = ticketFixture();
  seed(ledger, [reproduction(PRB), closedCondition], [PRB]);
  verifyReproduction(ledger);
  const closedAt = () => judged(ledger).decisions[1]!;
  // 닫힘이 없으면 test가 통과해도 이 조건은 통과하지 못한다.
  assertEquals(closedAt().result, "inconclusive");
  assert(closedAt().reason.includes("still open"));
  // 이 보고가 아닌 release로 닫힌 문제, 고치지 않고 더 다루지 않음으로 닫힌 문제도 아니다.
  close(ledger, PRB, verified(REL_OTHER));
  assert(closedAt().reason.includes(REL_OTHER));
  assertEquals(closedAt().result, "inconclusive");
  close(ledger, PRB, { reason: "dismissed", release: null });
  assertEquals(closedAt().result, "inconclusive");
  // 이 보고의 고친 release로 닫혔다.
  close(ledger, PRB, verified());
  assertEquals(closedAt().result, "pass");
  assertEquals(closedAt().targets.map((target) => target.id), [PRB]);
  ledger.close();
});

Deno.test("coding-agent/tickets#R21: reporting, confirming and checking never close a problem", () => {
  const ledger = ticketFixture();
  seed(ledger, [reproduction(PRB), closedCondition], [PRB]);
  verifyReproduction(ledger);
  // 보고돼 있고 test는 통과했지만 문제는 닫히지 않았다: reported에 남고 문제 표는 그대로다.
  const first = runChecker(ledger);
  assert(first.ok);
  assertEquals(first.value.state, "reported");
  assertEquals(results(ledger), ["pass", "inconclusive"]);
  const problem = () =>
    ledger.sql.get("SELECT status, closure FROM problems WHERE id = ?", [PRB]);
  assertEquals(problem()!["status"], "open");
  // 문제 영역이 닫은 뒤에야 통과하고, ticket 확인됨도 문제 표를 쓰지 않는다.
  close(ledger, PRB, verified());
  const before = JSON.stringify(problem());
  const done = runChecker(ledger);
  assert(done.ok);
  assertEquals(done.value.state, "confirmed");
  assertEquals(JSON.stringify(problem()), before);
  ledger.close();
});

Deno.test("coding-agent/tickets#R20: a closure and a reopening recompare the remaining conditions from the ledger", () => {
  const ledger = ticketFixture();
  seed(
    ledger,
    [reproduction(PRB), closedCondition, human(PRB_B)],
    [PRB, PRB_B],
  );
  verifyReproduction(ledger);
  close(ledger, PRB, verified());
  // 두 번째 문제는 아직 사람 확인이 없다.
  const first = runChecker(ledger);
  assert(first.ok);
  assertEquals(first.value.state, "reported");
  assertEquals(results(ledger), ["pass", "inconclusive", "inconclusive"]);
  // 같은 사실을 다시 비교해도 event가 쌓이지 않는다.
  const before = ledger.emitted.length;
  const repeat = runChecker(ledger);
  assert(repeat.ok);
  assertEquals(ledger.emitted.length, before);
  // 재발(ProblemReopened): 이미 기록된 통과가 아니라 지금 정본으로 남은 조건을 다시 비교한다.
  close(ledger, PRB_B, userConfirmed());
  reopen(ledger, PRB);
  const reopened = runChecker(ledger);
  assert(reopened.ok);
  assertEquals(reopened.value.state, "reported");
  assertEquals(results(ledger), ["pass", "inconclusive", "pass"]);
  // 다시 닫힌 뒤(ProblemClosed) 남은 조건이 맞아 확인된다.
  close(ledger, PRB, verified());
  const closed = runChecker(ledger);
  assert(closed.ok);
  assertEquals(closed.value.state, "confirmed");
  assertEquals(results(ledger), ["pass", "pass", "pass"]);
  ledger.close();
});

Deno.test("coding-agent/tickets#R9: all conditions passing does not confirm when only some problems are covered", () => {
  // 문제 둘을 고치는데 하나의 reproduction만 있다: 일부 문제만 통과해서 확인되지 않는다.
  const partial = ticketFixture();
  seed(partial, [reproduction(PRB), closedCondition], [PRB, PRB_B]);
  verifyReproduction(partial);
  close(partial, PRB, verified());
  close(partial, PRB_B, verified());
  const some = runChecker(partial);
  assert(some.ok);
  assertEquals(results(partial), ["pass", "pass"]);
  assertEquals(some.value.state, "reported");
  assertEquals(state(partial), "reported");
  assertEquals(
    partial.emitted.filter((event) => event.subject === TICKET).map((event) =>
      event.type
    ),
    ["TicketChecksRecorded"],
  );
  partial.close();

  // 대상 문제가 전부 빠졌다: 조건이 있어도 자동으로 확인되지 않는다.
  const excluded = ticketFixture();
  seed(excluded, [human(PRB), closedCondition], []);
  excluded.sql.run(
    "INSERT INTO problems (id, app, status, closure) VALUES (?, ?, 'open', NULL)",
    [PRB, APP],
  );
  close(excluded, PRB, userConfirmed());
  const none = runChecker(excluded);
  assert(none.ok);
  assertEquals(none.value.state, "reported");
  assertEquals(results(excluded), ["pass", "inconclusive"]);
  excluded.close();

  // 닫힘 조건이 없는 ticket도 확인되지 않는다.
  const open = ticketFixture();
  seed(open, [reproduction(PRB)], [PRB]);
  verifyReproduction(open);
  const noClose = runChecker(open);
  assert(noClose.ok);
  assertEquals(noClose.value.state, "reported");
  open.close();

  // 문제마다 reproduction이나 사람 확인이 있고 모두 닫히면 확인된다.
  const whole = ticketFixture();
  seed(
    whole,
    [reproduction(PRB), human(PRB_B), closedCondition],
    [PRB, PRB_B],
  );
  verifyReproduction(whole);
  close(whole, PRB, verified());
  close(whole, PRB_B, userConfirmed());
  const all = runChecker(whole);
  assert(all.ok);
  assertEquals(all.value.state, "confirmed");
  whole.close();
});

Deno.test("coding-agent/tickets#R9: record_checks takes pass or fail for the repair kinds only when the re-judgement agrees", () => {
  const ledger = ticketFixture();
  seed(
    ledger,
    [reproduction(PRB), closedCondition, human(PRB_B)],
    [PRB, PRB_B],
  );
  const { work } = judged(ledger);
  const submit = (
    condition: number,
    result: "pass" | "fail",
    verification: string | null,
  ) =>
    ledger.transaction((tx) =>
      checks.record_checks.handle(tx, userContext("machine"), {
        ticket: TICKET,
        completion_seq: work.completion.seq,
        base_revision: work.revision,
        checks: [{
          condition,
          result,
          reason: "claimed",
          verification,
          targets: [],
        }],
      }, { base_revision: work.revision })
    );
  // 근거가 없는 pass·fail은 세 kind 모두 받지 않는다.
  const claims = [[0, VRF_REPRO], [1, null], [2, null]] as const;
  for (const [condition, verification] of claims) {
    for (const result of ["pass", "fail"] as const) {
      const refused = submit(condition, result, verification);
      assert(!refused.ok);
      assertEquals(refused.error.code, "conflict");
    }
  }
  assertEquals(results(ledger), []);
  // 근거가 생기면 같은 판정만 받는다.
  verifyReproduction(ledger, { result: "fail" });
  const agreed = judged(ledger);
  assertEquals(agreed.decisions[0]!.result, "fail");
  const accepted = ledger.transaction((tx) =>
    checks.record_checks.handle(tx, userContext("machine"), {
      ticket: TICKET,
      completion_seq: agreed.work.completion.seq,
      base_revision: agreed.work.revision,
      checks: [{
        condition: 0,
        result: "fail",
        reason: agreed.decisions[0]!.reason,
        verification: agreed.decisions[0]!.verification,
        targets: agreed.decisions[0]!.targets,
      }],
    }, { base_revision: agreed.work.revision })
  );
  assert(accepted.ok);
  assertEquals(accepted.value.state, "check_failed");
  ledger.close();
});

Deno.test("coding-agent/tickets#R9 R20: the person's not_fixed decision on the reported release is a real human_confirmation failure", () => {
  // 열린 문제에 "아직입니다": 문제는 열린 채 남고(ProblemConfirmationRecorded) 조건은 fail이다.
  const open = ticketFixture();
  seed(open, [human(PRB), closedCondition], [PRB]);
  notFixed(open, PRB);
  assertEquals(problemRow(open, PRB).status, "open");
  const failed = runChecker(open);
  assert(failed.ok);
  assertEquals(failed.value.state, "check_failed");
  assertEquals(results(open), ["fail", "inconclusive"]);
  open.close();

  // 다른 release에 대한 "아직입니다"는 이번 보고의 실패가 아니다.
  const other = ticketFixture();
  seed(other, [human(PRB), closedCondition], [PRB]);
  notFixed(other, PRB, REL_OTHER);
  assertEquals(judged(other).decisions[0]!.result, "inconclusive");
  // 그 뒤 사람이 이 release를 확인해 닫으면 지난 결정은 남지 않는다.
  notFixed(other, PRB);
  close(other, PRB, userConfirmed());
  const done = runChecker(other);
  assert(done.ok);
  assertEquals(done.value.state, "confirmed");
  other.close();

  // 사람 확인으로 닫힌 문제를 같은 release에서 다시 연 not_fixed(ProblemReopened)도 실패다.
  const reopened = ticketFixture();
  seed(
    reopened,
    [human(PRB), closedCondition, human(PRB_B)],
    [PRB, PRB_B],
  );
  close(reopened, PRB, userConfirmed());
  const first = runChecker(reopened);
  assert(first.ok);
  assertEquals(results(reopened), ["pass", "inconclusive", "inconclusive"]);
  notFixed(reopened, PRB);
  assertEquals(problemRow(reopened, PRB).status, "open");
  const again = runChecker(reopened);
  assert(again.ok);
  assertEquals(again.value.state, "check_failed");
  assertEquals(results(reopened), ["fail", "inconclusive", "inconclusive"]);
  reopened.close();
});

Deno.test("coding-agent/tickets#R20: a problem target carries the problem's latest seq so record_checks takes it", () => {
  const ledger = ticketFixture();
  seed(ledger, [human(PRB), closedCondition], [PRB]);
  close(ledger, PRB, userConfirmed());
  const { decisions } = judged(ledger);
  const target = decisions[0]!.targets[0]!;
  assertEquals(target.revision, problemSeq(ledger, PRB));
  assertEquals(target.release, REL);
  for (const decision of decisions) {
    for (const item of decision.targets) {
      assert(seqSchema.safeParse(item.revision).success, item.revision);
    }
  }
  // 재발과 다시 닫힘은 revision을 바꾼다: 앞서 읽은 결과는 conflict로 최신 상태를 덮지 못한다.
  const stale = judged(ledger);
  reopen(ledger, PRB);
  close(ledger, PRB, userConfirmed());
  assert(judged(ledger).decisions[0]!.targets[0]!.revision !== target.revision);
  const late = ledger.transaction((tx) =>
    checks.record_checks.handle(tx, userContext("machine"), {
      ticket: TICKET,
      completion_seq: stale.work.completion.seq,
      base_revision: stale.work.revision,
      checks: stale.decisions,
    }, { base_revision: stale.work.revision })
  );
  assert(!late.ok);
  assertEquals(late.error.code, "conflict");
  const fresh = runChecker(ledger);
  assert(fresh.ok);
  assertEquals(fresh.value.state, "confirmed");
  ledger.close();
});
