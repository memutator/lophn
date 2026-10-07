// 제품처럼 띄운 core가 coding-agent/checker worker를 감독해 보고된 ticket의 조건을 실제
// Verification 행으로 판정하는지 본다(coding-agent/tickets#R18, R19, R20; plan coding-agent T26).
// 임시 LOPHN_HOME의 실제 ledger에 ticket·release·Verification 행을 심고(test-only seeding,
// problems-repair-blob_test.ts와 같은 자리) core를 껐다 켠다: 재시작 뒤 worker가 누락 검사를
// 이어 하고, 나중에 도착한 Verification은 깨움 하나로 남은 조건만 다시 비교된다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import {
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "./problems.ts";
import { ticketDefinitions } from "./tickets.ts";
import { startCore } from "./core.ts";

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
      new URL("./apps.ts", import.meta.url).href,
      new URL("./coding-agent.ts", import.meta.url).href,
      new URL("./problems.ts", import.meta.url).href,
      new URL("./tickets.ts", import.meta.url).href,
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
    ).all(ticket) as { result: string }[]).map((row) => row.result)
  );
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
          event.subject === WAITING.ticket && event.type !== "TicketChecksRecorded"
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
