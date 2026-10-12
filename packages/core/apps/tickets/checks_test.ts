// ticket machine check 테스트(coding-agent/tickets#R7, R8, R18, R19, R20). fixture
// transaction으로 조건별 판정과 record_checks의 CAS·재판정을 본다. 실제 core 경로는
// packages/core/apps/tickets/checker/connection_test.ts다.
import { assert, assertEquals } from "@std/assert";
import { createTicketCheckCommands, loadCheckWork } from "./checks.ts";
import { judgeTicket } from "./checker/mod.ts";
import { APP, ticketFixture, userContext } from "./fixture.ts";

const TICKET = "tkt_01arz3ndektsv4rrffq69g5fav";
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const REL_NEXT = "rel_01arz3ndektsv4rrffq69g5faw";
const BUNDLE = "b".repeat(64);
const OTHER_BUNDLE = "c".repeat(64);
const CMD_HASH = "d".repeat(64);
const COMPLETION = "10";
const checks = createTicketCheckCommands();

type Ledger = ReturnType<typeof ticketFixture>;
type Verification = {
  id: string;
  kind?: "app_test" | "test_command";
  result?: "pass" | "fail" | "inconclusive";
  bundle?: string;
  link?: { check_index: number; check_hash: string; completion_seq: string };
  seq?: number;
};
type Release = { status: string; bundle?: string; failure?: string };

// 완료 보고까지 끝난 ticket 한 장. 조건은 위치 0 app_test, 1 test_command, 2 release_active(선택).
function seed(
  ledger: Ledger,
  options: {
    activation?: boolean;
    release?: Release;
    active?: string | null;
    verifications?: Verification[];
    problems?: string[];
  } = {},
): void {
  const { sql } = ledger;
  sql.run(
    `INSERT INTO tickets (id, app, kind, title, what, why, inspect, preserve, problems,
       state, readiness, needs, cancel_reason, completion_seq, revision)
     VALUES (?, ?, 'implementation', 't', 'w', 'y', '[]', '[]', ?, 'reported', 'ready', '[]', NULL, ?, ?)`,
    [TICKET, APP, JSON.stringify(options.problems ?? []), COMPLETION, "11"],
  );
  const conditions: [string, unknown][] = [
    ["app_test", { kind: "app_test" }],
    ["test_command", {
      kind: "test_command",
      executable: "deno",
      argv: ["task", "test"],
      cwd: ".",
      timeout_ms: 60_000,
      expected_exit_code: 0,
    }],
  ];
  if (options.activation) {
    conditions.push(["release_active", { kind: "release_active" }]);
  }
  conditions.forEach(([kind, input], position) =>
    sql.run(
      `INSERT INTO ticket_conditions (ticket, position, kind, input, condition_hash)
       VALUES (?, ?, ?, ?, ?)`,
      [TICKET, position, kind, JSON.stringify(input), CMD_HASH],
    )
  );
  sql.run(
    `INSERT INTO ticket_completions (ticket, seq, claim_seq, release, summary_hash, outputs,
       fix_records, verifications)
     VALUES (?, ?, '9', ?, ?, '[]', '[]', '[]')`,
    [TICKET, COMPLETION, REL, "a".repeat(64)],
  );
  const release = options.release ?? { status: "prepared" };
  sql.run(
    `INSERT INTO releases (id, app, ticket_source, bundle_hash, status, failure)
     VALUES (?, ?, NULL, ?, ?, ?)`,
    [
      REL,
      APP,
      release.bundle ?? BUNDLE,
      release.status,
      release.failure === undefined
        ? null
        : JSON.stringify({ code: "x", summary: release.failure }),
    ],
  );
  sql.run(
    "INSERT INTO apps (id, revision, active_release) VALUES (?, '5', ?)",
    [
      APP,
      options.active ?? null,
    ],
  );
  for (const item of options.verifications ?? []) verify(ledger, item);
}

function verify(ledger: Ledger, item: Verification): void {
  ledger.sql.run(
    `INSERT INTO verifications (id, app, kind, result, reason, target_bundle_hash, ticket,
       ticket_check_index, ticket_check_hash, ticket_completion_seq, recorded_seq)
     VALUES (?, ?, ?, ?, 'ran', ?, ?, ?, ?, ?, ?)`,
    [
      item.id,
      APP,
      item.kind ?? "app_test",
      item.result ?? "pass",
      item.bundle ?? BUNDLE,
      item.link === undefined ? null : TICKET,
      item.link?.check_index ?? null,
      item.link?.check_hash ?? null,
      item.link?.completion_seq ?? null,
      String(item.seq ?? 1),
    ],
  );
}

const VRF_APP = "vrf_01arz3ndektsv4rrffq69g5fav";
const VRF_CMD = "vrf_01arz3ndektsv4rrffq69g5faw";
const link = (patch: Partial<{
  check_index: number;
  check_hash: string;
  completion_seq: string;
}> = {}) => ({
  check_index: 1,
  check_hash: CMD_HASH,
  completion_seq: COMPLETION,
  ...patch,
});

function judged(ledger: Ledger) {
  const work = loadCheckWork(ledger.sql, TICKET);
  assert(work !== null);
  return { work, decisions: judgeTicket(work) };
}

// checker가 하는 한 번: 읽고 판정하고 record_checks로 낸다.
function runChecker(ledger: Ledger) {
  const { work, decisions } = judged(ledger);
  return ledger.transaction((tx) =>
    checks.record_checks.handle(
      tx,
      userContext("machine"),
      {
        ticket: TICKET,
        completion_seq: work.completion.seq,
        base_revision: work.revision,
        checks: decisions,
      },
      { base_revision: work.revision },
    )
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

Deno.test("coding-agent/tickets#R18: app test evidence counts only from the same app and bundle hash", () => {
  const ledger = ticketFixture();
  seed(ledger, {
    verifications: [
      { id: VRF_APP, result: "pass", bundle: OTHER_BUNDLE },
    ],
  });
  const first = judged(ledger).decisions[0]!;
  // 다른 묶음의 통과는 근거가 아니다.
  assertEquals(first.result, "inconclusive");
  assertEquals(first.verification, null);
  verify(ledger, {
    id: "vrf_01arz3ndektsv4rrffq69g5fax",
    result: "pass",
    bundle: BUNDLE,
    seq: 2,
  });
  const second = judged(ledger).decisions[0]!;
  assertEquals(second.result, "pass");
  assertEquals(second.verification, "vrf_01arz3ndektsv4rrffq69g5fax");
  ledger.close();
});

Deno.test("coding-agent/tickets#R18: without a Verification a condition is inconclusive and a made-up pass is refused", () => {
  const ledger = ticketFixture();
  seed(ledger);
  const { work, decisions } = judged(ledger);
  assertEquals(decisions.map((item) => item.result), [
    "inconclusive",
    "inconclusive",
  ]);
  assert(decisions.every((item) => item.reason.length > 0));
  // shell 성공 문장은 근거가 아니다: 근거 없이 pass를 내는 machine 입력은 받지 않는다.
  const forged = ledger.transaction((tx) =>
    checks.record_checks.handle(tx, userContext("machine"), {
      ticket: TICKET,
      completion_seq: work.completion.seq,
      base_revision: work.revision,
      checks: [{
        condition: 0,
        result: "pass",
        reason: "all tests passed in the shell",
        verification: null,
        targets: [],
      }],
    }, { base_revision: work.revision })
  );
  assert(!forged.ok);
  assertEquals(forged.error.code, "conflict");
  assertEquals(results(ledger), []);
  assertEquals(state(ledger), "reported");
  ledger.close();
});

Deno.test("coding-agent/tickets#R18: a test command counts only when its TicketTestLink matches", () => {
  const ledger = ticketFixture();
  seed(ledger, {
    verifications: [
      {
        id: VRF_APP,
        kind: "test_command",
        link: link({ completion_seq: "9" }),
      },
      {
        id: "vrf_01arz3ndektsv4rrffq69g5fax",
        kind: "test_command",
        link: link({ check_index: 0 }),
        seq: 2,
      },
      {
        id: "vrf_01arz3ndektsv4rrffq69g5fay",
        kind: "test_command",
        link: link({ check_hash: "e".repeat(64) }),
        seq: 3,
      },
      {
        id: "vrf_01arz3ndektsv4rrffq69g5faz",
        kind: "test_command",
        link: link(),
        bundle: OTHER_BUNDLE,
        seq: 4,
      },
    ],
  });
  // 낡은 completion·다른 조건 번호·다른 조건 hash·다른 묶음은 모두 이 조건의 근거가 아니다.
  assertEquals(judged(ledger).decisions[1]!.result, "inconclusive");
  verify(ledger, {
    id: VRF_CMD,
    kind: "test_command",
    link: link(),
    seq: 5,
  });
  const matched = judged(ledger).decisions[1]!;
  assertEquals(matched.result, "pass");
  assertEquals(matched.verification, VRF_CMD);
  ledger.close();
});

Deno.test("coding-agent/tickets#R19: every condition passing confirms the ticket", () => {
  const ledger = ticketFixture();
  seed(ledger, {
    problems: [],
    verifications: [
      { id: VRF_APP },
      { id: VRF_CMD, kind: "test_command", link: link(), seq: 2 },
    ],
  });
  const done = runChecker(ledger);
  assert(done.ok);
  assertEquals(done.value.state, "confirmed");
  assertEquals(state(ledger), "confirmed");
  assertEquals(results(ledger), ["pass", "pass"]);
  assertEquals(
    ledger.emitted.map((event) => event.type),
    ["TicketChecksRecorded", "TicketConfirmed"],
  );
  // implementation ticket은 activation 조건이 없으니 승인 대기로 막히지 않는다(R8).
  ledger.close();
});

Deno.test("coding-agent/tickets#R19: one real failure makes the ticket check_failed", () => {
  const ledger = ticketFixture();
  seed(ledger, {
    verifications: [
      { id: VRF_APP, result: "fail" },
      { id: VRF_CMD, kind: "test_command", link: link(), seq: 2 },
    ],
  });
  const done = runChecker(ledger);
  assert(done.ok);
  assertEquals(done.value.state, "check_failed");
  assertEquals(state(ledger), "check_failed");
  assertEquals(results(ledger), ["fail", "pass"]);
  const failed = ledger.emitted.find((event) =>
    event.type === "TicketCheckFailed"
  );
  assert(failed);
  assertEquals(
    (failed.payload as { failed_conditions: number[] }).failed_conditions,
    [0],
  );
  ledger.close();
});

Deno.test("coding-agent/tickets#R19: not-run and approval waits keep the ticket reported with the remaining conditions", () => {
  const ledger = ticketFixture();
  seed(ledger, {
    activation: true,
    release: { status: "prepared" },
    verifications: [{ id: VRF_APP }],
  });
  const done = runChecker(ledger);
  assert(done.ok);
  assertEquals(done.value.state, "reported");
  assertEquals(state(ledger), "reported");
  // 통과한 조건과 남은 조건이 각각 이유를 가진 채 남는다.
  assertEquals(results(ledger), ["pass", "inconclusive", "inconclusive"]);
  const rows = ledger.sql.all(
    "SELECT condition, reason FROM ticket_check_results WHERE result = 'inconclusive' ORDER BY condition",
    [],
  );
  assertEquals(rows.map((row) => Number(row["condition"])), [1, 2]);
  assert(String(rows[1]!["reason"]).includes("activation approval"));
  assertEquals(
    ledger.emitted.map((event) => event.type),
    ["TicketChecksRecorded"],
  );
  ledger.close();
});

Deno.test("coding-agent/tickets#R8: release_active is judged against the real active release", () => {
  const ledger = ticketFixture();
  seed(ledger, {
    activation: true,
    release: { status: "active" },
    active: REL,
    verifications: [
      { id: VRF_APP },
      { id: VRF_CMD, kind: "test_command", link: link(), seq: 2 },
    ],
  });
  const decision = judged(ledger).decisions[2]!;
  assertEquals(decision.result, "pass");
  assertEquals(decision.targets, [{
    concern: "apps",
    id: APP,
    revision: "5",
    release: REL,
  }]);
  const done = runChecker(ledger);
  assert(done.ok);
  assertEquals(done.value.state, "confirmed");
  ledger.close();
});

Deno.test("coding-agent/tickets#R8: a different active release or a failed activation is never a pass", () => {
  const replaced = ticketFixture();
  seed(replaced, {
    activation: true,
    release: { status: "superseded" },
    active: REL_NEXT,
  });
  const gone = judged(replaced).decisions[2]!;
  assertEquals(gone.result, "inconclusive");
  assert(gone.reason.includes(REL_NEXT));
  replaced.close();

  const mismatch = ticketFixture();
  seed(mismatch, {
    activation: true,
    release: { status: "active" },
    active: REL_NEXT,
  });
  assertEquals(judged(mismatch).decisions[2]!.result, "inconclusive");
  mismatch.close();

  const failed = ticketFixture();
  seed(failed, {
    activation: true,
    release: { status: "failed", failure: "health check failed" },
    verifications: [
      { id: VRF_APP },
      { id: VRF_CMD, kind: "test_command", link: link(), seq: 2 },
    ],
  });
  const done = runChecker(failed);
  assert(done.ok);
  assertEquals(done.value.state, "check_failed");
  assertEquals(results(failed), ["pass", "pass", "fail"]);
  failed.close();
});

Deno.test("coding-agent/tickets#R20: a late result for an old completion, an old revision, or an old target revision does not apply", () => {
  const ledger = ticketFixture();
  seed(ledger, {
    activation: true,
    release: { status: "active" },
    active: REL,
    verifications: [
      { id: VRF_APP },
      { id: VRF_CMD, kind: "test_command", link: link(), seq: 2 },
    ],
  });
  const { work, decisions } = judged(ledger);
  const submit = (patch: Record<string, unknown>) =>
    ledger.transaction((tx) =>
      checks.record_checks.handle(tx, userContext("machine"), {
        ticket: TICKET,
        completion_seq: work.completion.seq,
        base_revision: work.revision,
        checks: decisions,
        ...patch,
      }, { base_revision: String(patch["base_revision"] ?? work.revision) })
    );
  // 더 오래된 completion의 검사.
  const old = submit({ completion_seq: "8" });
  assert(!old.ok);
  assertEquals(old.error.code, "conflict");
  // 읽은 뒤 ticket revision이 바뀐 검사.
  const stale = submit({ base_revision: "10" });
  assert(!stale.ok);
  assertEquals(stale.error.code, "conflict");
  // 읽은 뒤 앱의 active release 정본이 바뀌었다: 읽은 대상 revision이 낡았다.
  ledger.sql.run(
    "UPDATE apps SET revision = '6', active_release = ? WHERE id = ?",
    [
      REL_NEXT,
      APP,
    ],
  );
  const late = submit({});
  assert(!late.ok);
  assertEquals(late.error.code, "conflict");
  assertEquals(state(ledger), "reported");
  assertEquals(results(ledger), []);
  // 새 사실로 다시 비교하면 active가 달라졌으므로 확인되지 않는다.
  const again = runChecker(ledger);
  assert(again.ok);
  assertEquals(again.value.state, "reported");
  ledger.close();
});

Deno.test("coding-agent/tickets#R20: the comparison resumes when a missing Verification arrives and repeats without new events", () => {
  const ledger = ticketFixture();
  seed(ledger, { verifications: [{ id: VRF_APP }] });
  const first = runChecker(ledger);
  assert(first.ok);
  assertEquals(first.value.state, "reported");
  const before = ledger.emitted.length;
  // 같은 사실을 다시 비교해도 event가 쌓이지 않는다.
  const repeat = runChecker(ledger);
  assert(repeat.ok);
  assertEquals(ledger.emitted.length, before);
  // 누락됐던 test command 결과가 오면(VerificationRecorded 뒤) 남은 조건만 바뀐다.
  verify(ledger, {
    id: VRF_CMD,
    kind: "test_command",
    link: link(),
    seq: 2,
  });
  const resumed = runChecker(ledger);
  assert(resumed.ok);
  assertEquals(resumed.value.state, "confirmed");
  assertEquals(results(ledger), ["pass", "pass"]);
  // 확인된 ticket은 다시 검사받지 않는다.
  const closed = ledger.transaction((tx) =>
    checks.record_checks.handle(tx, userContext("machine"), {
      ticket: TICKET,
      completion_seq: COMPLETION,
      base_revision: "99",
      checks: [{
        condition: 0,
        result: "inconclusive",
        reason: "x",
        verification: null,
        targets: [],
      }],
    }, { base_revision: "99" })
  );
  assert(!closed.ok);
  assertEquals(closed.error.code, "conflict");
  ledger.close();
});

Deno.test("coding-agent/tickets#R18: only the machine actor records checks", () => {
  const ledger = ticketFixture();
  seed(ledger);
  const { work, decisions } = judged(ledger);
  const refused = ledger.transaction((tx) =>
    checks.record_checks.handle(tx, userContext("user"), {
      ticket: TICKET,
      completion_seq: work.completion.seq,
      base_revision: work.revision,
      checks: decisions,
    }, { base_revision: work.revision })
  );
  assert(!refused.ok);
  assertEquals(refused.error.code, "forbidden");
  ledger.close();
});
