// 제품처럼 띄운 core가 coding-agent/checker worker를 감독해 보고된 ticket의 조건을 실제
// Verification 행으로 판정하는지 본다(coding-agent/tickets#R18, R19, R20; plan coding-agent T26).
// 임시 LOPHN_HOME의 실제 ledger에 ticket·release·Verification 행을 심고(test-only seeding,
// problems-repair-blob_test.ts와 같은 자리) core를 껐다 켠다: 재시작 뒤 worker가 누락 검사를
// 이어 하고, 나중에 도착한 Verification은 깨움 하나로 남은 조건만 다시 비교된다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, seededRandom } from "../../../../base/mod.ts";
import { createLedgerRegistration as createAppsRegistration } from "../../register.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "../../../projects/register.ts";
import { codingAgentConnectionDefinitions } from "../../../server/identity/coding-connection.ts";
import {
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "../../../problems/register.ts";
import { ticketDefinitions } from "../register.ts";
import { createCoreRegistration as createTicketPortsRegistration } from "../ports.ts";
import { startCore } from "../../../main/daemon/core.ts";

const START = Date.parse("2026-10-07T00:00:00.000Z");
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const CMD_HASH = "d".repeat(64);

// 세 장: 모두 통과(release_active 포함) / 실제 실패 / 근거가 아직 없음.
const CONFIRMED = {
  ticket: "tkt_01arz3ndektsv4rrffq69g5fa1",
  seq: "1",
  release: "rel_01arz3ndektsv4rrffq69g5fa1",
  bundle: "a1".repeat(32),
};
const FAILED = {
  ticket: "tkt_01arz3ndektsv4rrffq69g5fa2",
  seq: "2",
  release: "rel_01arz3ndektsv4rrffq69g5fa2",
  bundle: "a2".repeat(32),
};
const WAITING = {
  ticket: "tkt_01arz3ndektsv4rrffq69g5fa3",
  seq: "3",
  release: "rel_01arz3ndektsv4rrffq69g5fa3",
  bundle: "a3".repeat(32),
};

// 기동마다 발급하는 credential ref가 겹치지 않게 seed를 다르게 준다.
async function boot(home: string, seed: number) {
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [
      { createLedgerRegistration: createAppsRegistration },
      { codingAgentConnectionDefinitions },
      { problemsTestDefinitions },
      { problemsReportDefinitions },
      { ticketDefinitions },
    ],
    teamModules: [
      new URL("../../register.ts", import.meta.url).href,
      new URL("../../../server/identity/coding-connection.ts", import.meta.url)
        .href,
      new URL("../../../problems/register.ts", import.meta.url).href,
      new URL("../register.ts", import.meta.url).href,
    ],
    clock: manualClock(START),
    random: seededRandom(seed),
  });
  assert(started.ok, started.ok ? undefined : JSON.stringify(started.error));
  return started.value;
}

function withDb<T>(home: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    return run(db);
  } finally {
    db.close();
  }
}

function seedApp(home: string): void {
  withDb(home, (db) => {
    db.prepare(
      `insert into apps (id, slug, name, description, planning_version, source_path,
         active_release, run_enabled, revision, status)
       values (?, 'notes', 'Notes', 'notes app', NULL, NULL, ?, 0, '3', 'active')`,
    ).run(APP, CONFIRMED.release);
  });
}

type Seed = typeof CONFIRMED;

// 보고까지 끝난 ticket: app_test와 test_command(와 선택한 release_active) 조건.
function seedReported(
  home: string,
  item: Seed,
  options: { activation: boolean; status: string; number: number },
): void {
  withDb(home, (db) => {
    db.prepare(
      `insert into releases (id, app, number, code_commit, bundle_hash, blueprint_hash,
         data_schema, data_changes, ticket_source, created_by, created_at, status,
         activation, failure, blueprint, declarations)
       values (?, ?, ?, ?, ?, ?, 0, '[]', NULL, 'machine:releaser',
         '2026-10-07T00:00:00.000Z', ?, NULL, NULL, '{}', '[]')`,
    ).run(
      item.release,
      APP,
      options.number,
      "c".repeat(40),
      item.bundle,
      "e".repeat(64),
      options.status,
    );
    db.prepare(
      `insert into tickets (id, app, kind, title, what, why, inspect, preserve, problems,
         state, readiness, needs, cancel_reason, completion_seq, revision)
       values (?, ?, 'implementation', 't', 'w', 'y', '[]', '[]', '[]', 'reported',
         'ready', '[]', NULL, ?, ?)`,
    ).run(item.ticket, APP, item.seq, item.seq);
    const condition = db.prepare(
      `insert into ticket_conditions (ticket, position, kind, input, condition_hash)
       values (?, ?, ?, ?, ?)`,
    );
    condition.run(item.ticket, 0, "app_test", '{"kind":"app_test"}', CMD_HASH);
    condition.run(
      item.ticket,
      1,
      "test_command",
      JSON.stringify({
        kind: "test_command",
        executable: "deno",
        argv: ["task", "test"],
        cwd: ".",
        timeout_ms: 60000,
        expected_exit_code: 0,
      }),
      CMD_HASH,
    );
    if (options.activation) {
      condition.run(
        item.ticket,
        2,
        "release_active",
        '{"kind":"release_active"}',
        CMD_HASH,
      );
    }
    db.prepare(
      `insert into ticket_completions (ticket, seq, claim_seq, release, summary_hash,
         outputs, fix_records, verifications)
       values (?, ?, ?, ?, ?, '[]', '[]', '[]')`,
    ).run(item.ticket, item.seq, item.seq, item.release, "f".repeat(64));
  });
}

// 실제 runner가 남기는 Verification 행(problems/tests의 표)을 심는다.
function seedVerification(
  home: string,
  input: {
    id: string;
    kind: "app_test" | "test_command";
    result: "pass" | "fail";
    bundle: string;
    ticket?: Seed;
    index?: number;
  },
): void {
  withDb(home, (db) => {
    db.prepare(
      `insert into verifications (id, request_principal, request_key, request_hash, kind, app,
         target_bundle_hash, target_release, problem, basis_seq, before_release, after_release,
         ticket, ticket_check_index, ticket_check_hash, ticket_completion_seq, test, execution,
         result, reason, observations, recorded_seq, verification_canonical)
       values (?, 'user-1', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, ?, ?, ?, '{}', '{}',
         ?, 'ran', '[]', '1', '{}')`,
    ).run(
      input.id,
      `key-${input.id}`,
      "f".repeat(64),
      input.kind,
      APP,
      input.bundle,
      input.ticket?.ticket ?? null,
      input.ticket === undefined ? null : input.index ?? 1,
      input.ticket === undefined ? null : CMD_HASH,
      input.ticket?.seq ?? null,
      input.result,
    );
  });
}

function stateOf(home: string, ticket: string): string {
  return withDb(home, (db) => {
    const row = db.prepare("select state from tickets where id = ?").get(
      ticket,
    ) as { state: string };
    return row.state;
  });
}

function resultsOf(home: string, ticket: string): string[] {
  return withDb(home, (db) =>
    (db.prepare(
      "select result from ticket_check_results where ticket = ? order by condition",
    ).all(ticket) as { result: string }[]).map((row) => row.result));
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (!check()) {
    assert(Date.now() < deadline, `시간 안에 ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

// worker가 감독으로 뜨기 전에는 unavailable이다. 뜬 뒤 한 번 깨워 비교하게 한다.
async function wakeChecker(
  core: Awaited<ReturnType<typeof boot>>,
): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    const woken = await core.sweepTicketChecks();
    if (woken.ok) return;
    assert(Date.now() < deadline, "checker worker가 뜨지 않았다");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

Deno.test("coding-agent/tickets#R18 R19 R20: 제품 core의 checker worker가 실제 Verification 행으로 보고된 ticket을 confirmed·check_failed·reported로 가른다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-ticket-checker-" });
  try {
    // 첫 기동은 ledger와 schema를 만든다. 그 위에 보고된 ticket을 심고 core를 끈다.
    const first = await boot(home, 1);
    try {
      seedApp(home);
      seedReported(home, CONFIRMED, {
        activation: true,
        status: "active",
        number: 1,
      });
      seedReported(home, FAILED, {
        activation: false,
        status: "prepared",
        number: 2,
      });
      seedReported(home, WAITING, {
        activation: false,
        status: "prepared",
        number: 3,
      });
      // CONFIRMED: 같은 묶음의 app test와 이번 completion에 연결된 test command가 통과했다.
      seedVerification(home, {
        id: "vrf_01arz3ndektsv4rrffq69g5fa1",
        kind: "app_test",
        result: "pass",
        bundle: CONFIRMED.bundle,
      });
      seedVerification(home, {
        id: "vrf_01arz3ndektsv4rrffq69g5fa2",
        kind: "test_command",
        result: "pass",
        bundle: CONFIRMED.bundle,
        ticket: CONFIRMED,
      });
      // FAILED: 같은 묶음의 app test가 실제로 실패했다.
      seedVerification(home, {
        id: "vrf_01arz3ndektsv4rrffq69g5fa3",
        kind: "app_test",
        result: "fail",
        bundle: FAILED.bundle,
      });
      seedVerification(home, {
        id: "vrf_01arz3ndektsv4rrffq69g5fa4",
        kind: "test_command",
        result: "pass",
        bundle: FAILED.bundle,
        ticket: FAILED,
      });
      // WAITING: 다른 묶음의 통과만 있다. 이 묶음의 근거가 아니다(R18).
      seedVerification(home, {
        id: "vrf_01arz3ndektsv4rrffq69g5fa5",
        kind: "app_test",
        result: "pass",
        bundle: CONFIRMED.bundle,
      });
    } finally {
      await first.shutdown();
    }

    // 재시작: 깨움 없이도 worker가 보고된 ticket의 누락 검사를 이어 한다(R20).
    const second = await boot(home, 2);
    try {
      await waitFor(
        () => stateOf(home, CONFIRMED.ticket) === "confirmed",
        "CONFIRMED가 confirmed가 되는 것",
      );
      await waitFor(
        () => stateOf(home, FAILED.ticket) === "check_failed",
        "FAILED가 check_failed가 되는 것",
      );
      assertEquals(resultsOf(home, CONFIRMED.ticket), ["pass", "pass", "pass"]);
      assertEquals(resultsOf(home, FAILED.ticket), ["fail", "pass"]);
      // 근거가 없는 ticket은 확인되지도 실패하지도 않고 이유와 함께 reported로 남는다.
      assertEquals(stateOf(home, WAITING.ticket), "reported");
      await waitFor(
        () => resultsOf(home, WAITING.ticket).length === 2,
        "WAITING의 조건별 결과 기록",
      );
      assertEquals(resultsOf(home, WAITING.ticket), [
        "inconclusive",
        "inconclusive",
      ]);
      const events = withDb(home, (db) =>
        db.prepare(
          `select type, subject, actor from events
           where type in ('TicketChecksRecorded', 'TicketConfirmed', 'TicketCheckFailed')
           order by seq`,
        ).all() as { type: string; subject: string; actor: string }[]);
      assert(
        events.some((event) =>
          event.type === "TicketConfirmed" &&
          event.subject === CONFIRMED.ticket
        ),
      );
      assert(
        events.some((event) =>
          event.type === "TicketCheckFailed" && event.subject === FAILED.ticket
        ),
      );
      assert(
        !events.some((event) =>
          event.subject === WAITING.ticket &&
          event.type !== "TicketChecksRecorded"
        ),
      );
      assert(events.every((event) => event.actor.startsWith("machine")));

      // 늦게 도착한 test command 결과(VerificationRecorded 뒤 깨움)는 남은 조건만 바꾼다.
      seedVerification(home, {
        id: "vrf_01arz3ndektsv4rrffq69g5fa6",
        kind: "app_test",
        result: "pass",
        bundle: WAITING.bundle,
      });
      seedVerification(home, {
        id: "vrf_01arz3ndektsv4rrffq69g5fa7",
        kind: "test_command",
        result: "pass",
        bundle: WAITING.bundle,
        ticket: WAITING,
      });
      await wakeChecker(second);
      await waitFor(
        () => stateOf(home, WAITING.ticket) === "confirmed",
        "WAITING이 confirmed가 되는 것",
      );
      assertEquals(resultsOf(home, WAITING.ticket), ["pass", "pass"]);
      // 이미 끝난 ticket은 다시 쓰이지 않는다.
      assertEquals(stateOf(home, FAILED.ticket), "check_failed");
    } finally {
      await second.shutdown();
    }
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});

// ---- coding-agent#T45: repair 조건을 실제 problems 경로로 잇는다 ----
// 문제는 실제 problems/record-report로 만들고, 닫힘은 problems.closing 반응기가 실제 reproduction
// Verification 행(problems/tests 표의 열 그대로, T18)과 VerificationRecorded event를 읽어 내는
// CloseProblemVerified·ProblemClosed다. 그 뒤 checker가 같은 ledger에서 reproduction_test와
// problems_closed를 다시 비교하고, 문제 대상의 revision(문제 최신 seq)을 record_checks가 받는다.
const REPAIR = {
  ticket: "tkt_01arz3ndektsv4rrffq69g5fr1",
  release: "rel_01arz3ndektsv4rrffq69g5fr1",
  before: "rel_01arz3ndektsv4rrffq69g5fr0",
  bundle: "b1".repeat(32),
  frozen: "d1".repeat(32),
  execution: "e1".repeat(32),
};

async function bootWithCredentials(home: string) {
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [
      { createLedgerRegistration: createDocumentsRegistration },
      { createLedgerRegistration: createAppsRegistration },
      { codingAgentConnectionDefinitions },
      { problemsTestDefinitions },
      { problemsReportDefinitions },
      { ticketDefinitions },
      // 제품 main.ts와 같은 ticket port 등록(PROBLEM_STATUSES_PORT의 실제 구현)이다.
      { createCoreRegistration: createTicketPortsRegistration },
    ],
    teamModules: [
      new URL("../../../projects/register.ts", import.meta.url).href,
      new URL("../../register.ts", import.meta.url).href,
      new URL("../../../server/identity/coding-connection.ts", import.meta.url)
        .href,
      new URL("../../../problems/register.ts", import.meta.url).href,
      new URL("../register.ts", import.meta.url).href,
      new URL("../ports.ts", import.meta.url).href,
    ],
    clock: manualClock(START),
    random: seededRandom(7),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? undefined : JSON.stringify(started.error));
  return started.value;
}

// 시험용 credential(testCredentials)을 발급한다. 사람 data root·keychain은 열지 않는다.
function issuer(core: Awaited<ReturnType<typeof bootWithCredentials>>) {
  let serial = 0;
  return async (
    actor: string,
    principal: string,
    operations: string[],
  ): Promise<string> => {
    const context = {
      principal,
      actor: actor as never,
      scope: { operations, targets: {} },
      conditions: {},
      credential_ref: `t45-${++serial}`,
    };
    const token = `${serial}`.repeat(43).slice(0, 43);
    assert(core.acceptTestCredential);
    const accepted = await core.acceptTestCredential!(context, token);
    assert(accepted.ok, accepted.ok ? "" : JSON.stringify(accepted.error));
    assert((await core.record(context)).ok);
    return token;
  };
}

async function post(
  port: number,
  path: string,
  token: string,
  input: unknown,
  compare: unknown = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      input,
      idempotency_key: `k-${crypto.randomUUID()}`,
      compare,
      prepared: [],
    }),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

// collector가 접수하는 최소 보고(problems-closing_test.ts와 같은 모양)다.
function repairReport(app: string, principal: string): Record<string, unknown> {
  const rpt = "rpt_01arz3ndektsv4rrffq69g5fr1";
  const snp = "snp_01arz3ndektsv4rrffq69g5fr1";
  const at = new Date(START + 1_000_000).toISOString();
  return {
    report: {
      id: rpt,
      app,
      mode: "live",
      diagnostic_scope: null,
      release: REPAIR.release,
      release_missing_reason: null,
      bundle_hash: REPAIR.bundle,
      source: "exception",
      code: "_exception",
      text: null,
      details: null,
      snapshot: snp,
      observed_at: at,
      principal,
      content_hash: "1".repeat(64),
    },
    snapshot: {
      id: snp,
      captured_at: at,
      invocation: null,
      invocation_missing_reason: { reason: "no invocation" },
      error: {
        name: "TypeError",
        message: "boom",
        message_missing_reason: null,
        frames: [{ path: "src/f.ts", function: null, line: 1, column: 1 }],
        source_missing_reason: null,
        stack: null,
        stack_missing_reason: { reason: "stack unavailable" },
        truncation_notes: [],
      },
      error_missing_reason: null,
      logs: null,
      logs_missing_reason: { reason: "log not collected" },
      screen: null,
      screen_missing_reason: { reason: "not collected" },
    },
    group_key: { kind: "exception", code: "_exception", discriminator: rpt },
    existing_problem: null,
    blobs: [],
    origin: {
      context: {
        authentication: {
          principal,
          actor: "machine",
          scope: { operations: ["RecordReport"], targets: {} },
          conditions: {},
          credential_ref: "cred-1",
        },
        app,
        mode: "live",
        diagnostic_scope: null,
        release: REPAIR.release,
        release_missing_reason: null,
        bundle_hash: REPAIR.bundle,
        binding: "sdk",
        origin: "process_observer",
      },
      report_id: rpt,
      content_hash: "1".repeat(64),
    },
  };
}

function seedRepairWork(home: string, app: string, problem: string): void {
  withDb(home, (db) => {
    const release = db.prepare(
      `insert into releases (id, app, number, code_commit, bundle_hash, blueprint_hash,
         data_schema, data_changes, ticket_source, created_by, created_at, status,
         blueprint, declarations)
       values (?, ?, ?, ?, ?, ?, 0, '[]', NULL, 'coding_agent', ?, ?, '{}', '[]')`,
    );
    release.run(
      REPAIR.before,
      app,
      1,
      "b".repeat(40),
      "c".repeat(64),
      "e".repeat(64),
      "2026-10-05T00:00:00.000Z",
      "superseded",
    );
    release.run(
      REPAIR.release,
      app,
      2,
      "b".repeat(40),
      REPAIR.bundle,
      "e".repeat(64),
      "2026-10-06T00:00:00.000Z",
      "active",
    );
    db.prepare(
      `insert into tickets (id, app, kind, title, what, why, inspect, preserve, problems,
         state, readiness, needs, cancel_reason, completion_seq, revision)
       values (?, ?, 'repair', 't', 'w', 'y', '[]', '[]', ?, 'reported',
         'ready', '[]', NULL, '1', '1')`,
    ).run(REPAIR.ticket, app, JSON.stringify([problem]));
    const condition = db.prepare(
      `insert into ticket_conditions (ticket, position, kind, input, condition_hash)
       values (?, ?, ?, ?, ?)`,
    );
    condition.run(
      REPAIR.ticket,
      0,
      "reproduction_test",
      JSON.stringify({
        kind: "reproduction_test",
        problem,
        test_hash: REPAIR.frozen,
      }),
      CMD_HASH,
    );
    condition.run(
      REPAIR.ticket,
      1,
      "problems_closed",
      '{"kind":"problems_closed"}',
      CMD_HASH,
    );
    db.prepare(
      `insert into ticket_completions (ticket, seq, claim_seq, release, summary_hash,
         outputs, fix_records, verifications)
       values (?, '1', '1', ?, ?, '[]', '[]', '[]')`,
    ).run(REPAIR.ticket, REPAIR.release, "f".repeat(64));
  });
}

// runner가 남기는 reproduction Verification 행과 그 event다(T18의 행 모양: 고정 test hash는
// test, 보고 뒤 release는 after_release, 같은 묶음은 target_bundle_hash).
function seedReproduction(
  home: string,
  app: string,
  problem: string,
  basis: string,
): void {
  const id = "vrf_01arz3ndektsv4rrffq69g5fr1";
  withDb(home, (db) => {
    db.exec("PRAGMA busy_timeout = 5000");
    db.prepare(
      `insert into verifications (id, request_principal, request_key, request_hash, kind, app,
         target_bundle_hash, target_release, problem, basis_seq,
         before_release, after_release, ticket, ticket_check_index,
         ticket_check_hash, ticket_completion_seq, test, execution, result,
         reason, observations, recorded_seq, verification_canonical)
       values (?, 'runner-1', ?, ?, 'reproduction', ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL,
         NULL, ?, ?, 'pass', 'ran', '[]', '1', '{}')`,
    ).run(
      id,
      `key-${id}`,
      "f".repeat(64),
      app,
      REPAIR.bundle,
      REPAIR.release,
      problem,
      basis,
      REPAIR.before,
      REPAIR.release,
      REPAIR.frozen,
      REPAIR.execution,
    );
    db.prepare(
      `insert into events (type, subject, actor, run, payload, at)
       values ('VerificationRecorded', ?, 'machine', NULL, ?, '2026-10-07T00:00:01.000Z')`,
    ).run(
      id,
      JSON.stringify({
        kind: "reproduction",
        app,
        target: { bundle_hash: REPAIR.bundle, release: REPAIR.release },
        problem,
        basis_seq: basis,
        result: "pass",
        test: REPAIR.frozen,
        execution: REPAIR.execution,
      }),
    );
  });
}

Deno.test("coding-agent/tickets#R9 R20 R21: 실제 reproduction 행과 problems.closing의 ProblemClosed로 repair ticket이 confirmed가 된다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-ticket-repair-" });
  const core = await bootWithCredentials(home);
  try {
    const issue = issuer(core);
    const machine = await issue("machine", "machine-1", ["RecordReport"]);
    const user = await issue("user", "user-1", ["app.create"]);
    const created = await post(core.port, "apps/create", user, {
      slug: "notes",
      name: "Notes",
      description: "notes app",
    });
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const app = String(created.body["id"]);
    const recorded = await post(
      core.port,
      "problems/record-report",
      machine,
      repairReport(app, "machine-1"),
      { active_release: null, problem_seq: null },
    );
    assertEquals(recorded.status, 200, JSON.stringify(recorded.body));
    const problem = String(recorded.body["problem"]);
    seedRepairWork(home, app, problem);
    const basis = withDb(home, (db) =>
      String(
        (db.prepare(
          "select cast(max(seq) as text) as seq from events where subject = ?",
        ).get(problem) as { seq: string }).seq,
      ));
    seedReproduction(home, app, problem, basis);

    // problems.closing 반응기가 실제로 닫고, checker는 ProblemClosed 뒤 남은 조건을 다시 비교한다.
    const deadline = Date.now() + 60_000;
    while (stateOf(home, REPAIR.ticket) !== "confirmed") {
      await core.sweepProblemsClosing();
      await core.sweepTicketChecks();
      assert(
        Date.now() < deadline,
        `시간 안에 confirmed가 되지 않았다: ${
          JSON.stringify(resultsOf(home, REPAIR.ticket))
        }`,
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    assertEquals(resultsOf(home, REPAIR.ticket), ["pass", "pass"]);
    const closure = withDb(home, (db) =>
      JSON.parse(
        (db.prepare("select closure from problems where id = ?").get(
          problem,
        ) as { closure: string }).closure,
      ) as Record<string, unknown>);
    assertEquals(closure["reason"], "verified");
    assertEquals(closure["release"], REPAIR.release);
    // confirmed까지 왔다는 것은 record_checks가 문제 대상(revision = 문제 최신 seq)을
    // invalid_input 없이 받았다는 뜻이다(T19 이어받음).
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("coding-agent/tickets#R3 R4: 제품 core의 PROBLEM_STATUSES_PORT로 실제 문제에 repair ticket을 만들고 없는 문제는 거절한다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-ticket-repair-port-" });
  const core = await bootWithCredentials(home);
  try {
    const issue = issuer(core);
    const machine = await issue("machine", "machine-1", ["RecordReport"]);
    const user = await issue("user", "user-1", ["app.create", "CreateTicket"]);
    const created = await post(core.port, "apps/create", user, {
      slug: "notes",
      name: "Notes",
      description: "notes app",
    });
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const app = String(created.body["id"]);
    const recorded = await post(
      core.port,
      "problems/record-report",
      machine,
      repairReport(app, "machine-1"),
      { active_release: null, problem_seq: null },
    );
    assertEquals(recorded.status, 200, JSON.stringify(recorded.body));
    const problem = String(recorded.body["problem"]);
    const repair = (problems: string[]) =>
      post(core.port, "tickets/create", user, {
        app,
        kind: "repair",
        title: "Fix crash",
        what: "Stop the crash on save.",
        why: "Users lose data.",
        references: [],
        adoption_questions: [],
        conditions: [],
        inspect: [],
        preserve: [],
        problems,
        readiness: "needs_confirmation",
        needs: ["Confirm the acceptance checks."],
      });
    // problems 표를 읽는 실제 port가 열린 문제로 답해 repair ticket이 만들어진다.
    const made = await repair([problem]);
    assertEquals(made.status, 200, JSON.stringify(made.body));
    const stored = withDb(
      home,
      (db) =>
        db.prepare("select kind, problems from tickets where id = ?").get(
          String(made.body["ticket"]),
        ) as { kind: string; problems: string },
    );
    assertEquals(stored.kind, "repair");
    assertEquals(JSON.parse(stored.problems), [problem]);
    // ledger에 없는 문제는 같은 port가 not_found로 막는다(fail-closed).
    const missing = await repair(["prb_01arz3ndektsv4rrffq69g5fzz"]);
    assert(missing.status !== 200, JSON.stringify(missing.body));
    assert(
      JSON.stringify(missing.body).includes("not_found"),
      JSON.stringify(missing.body),
    );
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
