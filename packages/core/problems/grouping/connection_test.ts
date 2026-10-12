// 제품 core가 test-runner worker에서 `problems.work` 반응기를 돌려 실제 ticket event로 문제의 work와
// status를 맞추는지 본다(problems/grouping#R8, R9, R14; plan problems T19). 임시 LOPHN_HOME의 실제
// ledger에서 문제는 RecordReport로, ticket은 실제 create·claim·만료·보고·검사·취소 command로 만든다.
// 사람의 실제 data root·keychain은 열지 않는다(fake keychain, temp home).
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../../base/mod.ts";
import { manualClock, seededRandom } from "../../../base/mod.ts";
import { createCoreClient } from "../../../coding-agent/connection/client/core.ts";
import { createTicketTool } from "../../../coding-agent/mcp-server/tools/ticket.ts";
import { resolveRoute } from "../../../coding-agent/mcp-server/registry.ts";
import {
  codingCredentialRef,
  createFakeKeychain,
  type FakeKeychain,
} from "../../secrets/mod.ts";
import { openWorld, type World } from "../../apps/runtime/world_test.ts";
import { createLedgerRegistration as createAppsRegistration } from "../../apps/register.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "../../projects/register.ts";
import { codingAgentConnectionDefinitions } from "../../server/identity/coding-connection.ts";
import {
  problemsReportDefinitions,
  problemsTestDefinitions,
} from "../register.ts";
import { ticketDefinitions } from "../../apps/tickets/register.ts";
import { startCore } from "../../main/daemon/core.ts";

const decoder = new TextDecoder();
const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const DIGEST = "a".repeat(64);
const DURATION = 3_600_000;
const SUMMARY =
  "변경: leaf redaction\n수행한 확인: deno task test\n미실행 확인: 없음\n한계: 없음\n";
const WORK_EVENTS = [
  "TicketCreated",
  "TicketClaimed",
  "TicketClaimReleased",
  "TicketCompletionReported",
  "TicketCancelled",
  "TicketCheckFailed",
  "TicketConfirmed",
];

type Reply = { status: number; body: Record<string, unknown> };

async function post(
  port: number,
  path: string,
  token: string,
  input: unknown,
  compare: unknown = {},
): Promise<Reply> {
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

async function show(port: number, token: string, ticket: string) {
  const response = await fetch(`http://127.0.0.1:${port}/v1/tickets/show`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ticket }),
  });
  const body = await response.json() as {
    ticket?: { revision?: string; state?: string };
  };
  assertEquals(response.status, 200, JSON.stringify(body));
  return body.ticket!;
}

function withDb<T>(home: string, run: (db: DatabaseSync) => T): T {
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    return run(db);
  } finally {
    db.close();
  }
}

function problemOf(home: string, problem: string) {
  return withDb(home, (db) => {
    const row = db.prepare("select status, work from problems where id = ?")
      .get(problem) as { status: string; work: string | null };
    return { status: row.status, work: row.work };
  });
}

function workEvents(home: string, problem: string) {
  return withDb(home, (db) =>
    (db.prepare(
      `select type, payload from events
        where subject = ? and type in ('ProblemWorkStarted', 'ProblemWorkEnded')
        order by seq`,
    ).all(problem) as { type: string; payload: string }[]).map((row) => ({
      type: row.type,
      payload: JSON.parse(row.payload) as Record<string, unknown>,
    })));
}

function cursorOf(home: string): bigint {
  return withDb(home, (db) => {
    const row = db.prepare(
      "select processed_through_seq as seq from subscriber_cursors where subscriber = 'problems.work'",
    ).get() as { seq: bigint | number } | undefined;
    return row === undefined ? 0n : BigInt(row.seq);
  });
}

// 이 반응기가 읽는 마지막 ticket event의 seq다.
function lastTicketEvent(home: string): bigint {
  const marks = WORK_EVENTS.map(() => "?").join(", ");
  return withDb(home, (db) => {
    const row = db.prepare(
      `select max(seq) as seq from events where type in (${marks})`,
    ).get(...WORK_EVENTS) as { seq: bigint | number | null };
    return row.seq === null ? 0n : BigInt(row.seq);
  });
}

async function waitFor(check: () => boolean, label: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  while (!check()) {
    assert(Date.now() < deadline, `시간 안에 ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
}

// event가 닿은 뒤 반응기가 그 위치까지 따라잡기를 기다린다. 처리한 위치는 ledger의 cursor다.
async function reacted(home: string, label: string): Promise<void> {
  const target = lastTicketEvent(home);
  await waitFor(() => cursorOf(home) >= target, `${label}까지 반응`);
}

const rpt = (n: number) => `rpt_01arz3ndektsv4rrffq69g5fa${n}`;
const snp = (n: number) => `snp_01arz3ndektsv4rrffq69g5fa${n}`;

// 앱 하나의 같은 문제(exception key의 discriminator는 최초 rpt)에 접수되는 보고 하나.
function reportInput(principal: string, app: string, observedMs: number) {
  const at = new Date(observedMs).toISOString();
  const origin = {
    app,
    mode: "live",
    diagnostic_scope: null,
    release: "rel_01arz3ndektsv4rrffq69g5fav",
    release_missing_reason: null,
    bundle_hash: "a".repeat(64),
  };
  return {
    report: {
      id: rpt(1),
      ...origin,
      source: "exception",
      code: "_exception",
      text: null,
      details: null,
      snapshot: snp(1),
      observed_at: at,
      principal,
      content_hash: "1".repeat(64),
    },
    snapshot: {
      id: snp(1),
      captured_at: at,
      invocation: {
        id: "inv_01arz3ndektsv4rrffq69g5fav",
        binding: "sdk_context",
        record_missing_reason: null,
      },
      invocation_missing_reason: null,
      error: {
        name: "TypeError",
        message: "boom",
        message_missing_reason: null,
        frames: [{ path: "src/f1.ts", function: null, line: 1, column: 1 }],
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
    group_key: { kind: "exception", code: "_exception", discriminator: rpt(1) },
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
        ...origin,
        binding: "sdk",
        origin: "process_observer",
      },
      report_id: rpt(1),
      content_hash: "1".repeat(64),
    },
  };
}

async function record(
  port: number,
  token: string,
  principal: string,
  app: string,
): Promise<string> {
  const sent = await post(
    port,
    "problems/record-report",
    token,
    reportInput(principal, app, Date.now() - DURATION),
    { active_release: "rel_01arz3ndektsv4rrffq69g5fav", problem_seq: null },
  );
  assertEquals(sent.status, 200, JSON.stringify(sent.body));
  return String(sent.body["problem"]);
}

const repairInput = (app: string, problem: string) => ({
  app,
  kind: "repair",
  title: "Fix the crash",
  what: "Stop the crash on save.",
  why: "Users lose data.",
  references: [],
  adoption_questions: [],
  conditions: [],
  inspect: ["src/f1.ts"],
  preserve: ["src/keep.ts"],
  problems: [problem],
  readiness: "needs_confirmation",
  needs: ["Confirm the acceptance checks."],
});

const readyInput = (ticket: string, revision: string, problem: string) => ({
  ticket,
  base_revision: revision,
  references: [{
    kind: "version",
    target: VER,
    address: {
      place: "project",
      document: "leaf-redaction",
      section: null,
      version: 1,
    },
    section: null,
  }],
  adoption_questions: [QUESTION],
  conditions: [
    { kind: "app_test" },
    {
      kind: "test_command",
      executable: "deno",
      argv: ["task", "test"],
      cwd: ".",
      timeout_ms: 60_000,
      expected_exit_code: 0,
    },
    { kind: "problems_closed" },
    { kind: "human_confirmation", problem },
  ],
  inspect: ["src/f1.ts"],
  preserve: ["src/keep.ts"],
});

// 이 claim으로 준비된 release 행이다(releases 조립은 apps 몫이라 시험이 직접 심는다).
function seedRelease(
  home: string,
  app: string,
  number: number,
  source: { ticket: string; claim_seq: string } | null,
  status = "prepared",
): string {
  const id = `rel_01arz3ndektsv4rrffq69g5fa${number}`;
  withDb(home, (db) => {
    db.prepare(
      `INSERT INTO releases (id, app, number, code_commit, bundle_hash, blueprint_hash,
         data_schema, data_changes, ticket_source, created_by, created_at, status,
         blueprint, declarations)
       VALUES (?, ?, ?, ?, ?, ?, 0, '[]', ?, 'coding_agent', ?, ?, '{}', '{}')`,
    ).run(
      id,
      app,
      number,
      "a".repeat(40),
      "b".repeat(64),
      "c".repeat(64),
      source === null ? null : JSON.stringify(source),
      new Date().toISOString(),
      status,
    );
  });
  return id;
}

function latestSeq(home: string, subject: string): string {
  return withDb(home, (db) =>
    String(
      (db.prepare(
        "select cast(max(seq) as text) as seq from events where subject = ?",
      ).get(subject) as { seq: string }).seq,
    ));
}

type Opened = {
  world: World;
  user: string;
  machine: { token: string; context: { principal: string } };
  connect(label: string): Promise<{ connection: string; token: string }>;
};

async function withWorld(run: (opened: Opened) => Promise<void>) {
  const keychain: FakeKeychain = createFakeKeychain();
  const world = await openWorld({
    approvals: true,
    extend: {
      teams: [
        { codingAgentConnectionDefinitions },
        { ticketDefinitions },
        { problemsTestDefinitions },
        { problemsReportDefinitions },
      ],
      teamModules: [
        new URL("../../server/identity/coding-connection.ts", import.meta.url)
          .href,
        new URL("../../apps/tickets/register.ts", import.meta.url).href,
        new URL("../register.ts", import.meta.url).href,
        // 문제 상태·질문 채택 port의 시험용 구현이다(제품 등록에는 아직 없다).
        new URL("../repairs/context-ports_test.ts", import.meta.url).href,
        new URL("../../apps/tickets/claim-ports_test.ts", import.meta.url).href,
      ],
      coding: { keychain, loaders: [] },
    },
  });
  try {
    await world.harness.codingCredentialsReady;
    const user = (await world.login("user", [
      "CreateCodingAgentConnection",
      "CreateTicket",
      "MakeTicketReady",
      "CancelTicket",
      "app.create",
    ])).token;
    const machine = await world.login("machine", ["RecordReport"]);
    await run({
      world,
      user,
      machine,
      async connect(label) {
        const connected = await world.harness.codingCredentials!.connect(
          { label, scope: { kind: "app", app: world.app } },
          async (submission): Promise<Result<unknown>> => {
            const sent = await post(
              world.harness.port,
              "coding_agent_connections/create",
              user,
              submission,
            );
            return sent.status === 200
              ? ok(sent.body)
              : err({ code: "conflict", message: `${sent.status}` });
          },
        );
        assert(connected.ok, connected.ok ? "" : connected.error.message);
        const { connection } = connected.value;
        return {
          connection,
          token: decoder.decode(
            keychain.stored.get(codingCredentialRef(connection)!)!,
          ),
        };
      },
    });
  } finally {
    await world.close();
  }
}

Deno.test("problems/grouping#R8 R9: 제품 core의 test-runner가 실제 ticket event로 work와 status를 맞춘다 (create → claim → 만료 → claim → 보고 → 취소)", async () => {
  await withWorld(async ({ world, user, machine, connect }) => {
    const port = world.harness.port;
    const home = world.harness.dataRoot;
    const problem = await record(
      port,
      machine.token,
      machine.context.principal,
      world.app,
    );
    assertEquals(problemOf(home, problem), { status: "open", work: null });

    // 실제 repair ticket 생성: TicketCreated로 work를 잇고 status는 open이다(질문 Q3).
    const created = await post(
      port,
      "tickets/create",
      user,
      repairInput(world.app, problem),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const ticket = String(created.body["ticket"]);
    await reacted(home, "TicketCreated");
    assertEquals(problemOf(home, problem), { status: "open", work: ticket });

    const ready = await post(
      port,
      "tickets/make_ready",
      user,
      readyInput(ticket, String(created.body["revision"]), problem),
      { base_revision: String(created.body["revision"]) },
    );
    assertEquals(ready.status, 200, JSON.stringify(ready.body));

    // 유효 claim 뒤에만 fixing이다.
    const who = await connect("claude");
    const claim = async () => {
      const revision = String((await show(port, who.token, ticket)).revision);
      const claimed = await post(
        port,
        "tickets/claim",
        who.token,
        { ticket, base_revision: revision },
        { base_revision: revision },
      );
      assertEquals(claimed.status, 200, JSON.stringify(claimed.body));
      return String(claimed.body["claim_seq"]);
    };
    await claim();
    await reacted(home, "TicketClaimed");
    assertEquals(problemOf(home, problem), { status: "fixing", work: ticket });

    // 기한이 지난 claim은 만료 정리가 TicketClaimReleased(expired)로 거두고 문제는 다시 open이다.
    world.harness.clock.advance(DURATION);
    await world.harness.sweepTicketClaims();
    await reacted(home, "TicketClaimReleased expired");
    assertEquals(problemOf(home, problem), { status: "open", work: ticket });

    // 새 claim 뒤 다시 fixing이고, 완료 보고는 닫힘 근거가 아니라 open이다.
    const second = await claim();
    await reacted(home, "second TicketClaimed");
    assertEquals(problemOf(home, problem).status, "fixing");
    const releaseId = seedRelease(home, world.app, 1, {
      ticket,
      claim_seq: second,
    });
    const before = seedRelease(home, world.app, 2, null, "active");
    // 고친 기록(repair ticket의 보고에 필수): 준비한 summary blob과 이 claim의 before·after release다.
    const principal = `coding_agent:${who.connection}`;
    const summary = new TextEncoder().encode("고친 요약");
    const prepared = await world.harness.prepareBlob({
      principal,
      purpose: "fix_summary",
      bytes: new ReadableStream({
        start(controller) {
          controller.enqueue(summary);
          controller.close();
        },
      }),
    });
    assert(prepared.ok, prepared.ok ? "" : JSON.stringify(prepared.error));
    const fix = await post(
      port,
      "problems/record-fix",
      who.token,
      {
        problem,
        idempotency_key: `fix-${crypto.randomUUID()}`,
        fix: {
          before,
          after: releaseId,
          summary: prepared.value.hash,
          verification: [],
          ticket,
          claim_seq: second,
        },
        summary_blob: {
          preparation: prepared.value.preparation,
          principal,
          purpose: "fix_summary",
          hash: prepared.value.hash,
          size_bytes: prepared.value.size_bytes,
        },
      },
      { problem_seq: latestSeq(home, problem) },
    );
    assertEquals(fix.status, 200, JSON.stringify(fix.body));
    const mcp = createTicketTool({
      client: createCoreClient({
        baseUrl: `http://127.0.0.1:${port}`,
        connection: who.connection as never,
        provider: () =>
          Promise.resolve({ ok: true, value: { token: who.token } }),
      }),
      now: () => new Date().toISOString(),
      idempotencyKey: () => `mcp-${crypto.randomUUID()}`,
    });
    const resolved = resolveRoute("lophn_ticket", "report");
    assert(resolved);
    const reported = await mcp("lophn_ticket", resolved.route, {
      op: "report",
      ticket,
      base_revision: String((await show(port, who.token, ticket)).revision),
      claim_seq: second,
      release: releaseId,
      fix_records: [String(fix.body["seq"])],
      summary: SUMMARY,
    });
    assertEquals(reported.isError, undefined, JSON.stringify(reported.data));
    await reacted(home, "TicketCompletionReported");
    assertEquals(problemOf(home, problem), { status: "open", work: ticket });

    // 사람이 ticket을 취소하면 open이고 ticket 연결이 풀린다.
    const revision = String((await show(port, who.token, ticket)).revision);
    const cancelled = await post(
      port,
      "tickets/cancel",
      user,
      { ticket, base_revision: revision, reason: "no longer needed" },
      { base_revision: revision },
    );
    assertEquals(cancelled.status, 200, JSON.stringify(cancelled.body));
    await reacted(home, "TicketCancelled");
    assertEquals(problemOf(home, problem), { status: "open", work: null });

    // 문제 상태 전환마다 근거 ticket event가 ProblemWork event에 남았다.
    const events = workEvents(home, problem);
    assertEquals(events.map((event) => event.type), [
      "ProblemWorkStarted", // create: ticket을 이음
      "ProblemWorkStarted", // claim: fixing
      "ProblemWorkEnded", // expired
      "ProblemWorkStarted",
      "ProblemWorkEnded", // completion_reported
      "ProblemWorkEnded", // cancelled
    ]);
    assertEquals(
      events.filter((event) => event.type === "ProblemWorkEnded").map((event) =>
        event.payload["reason"]
      ),
      ["expired", "completion_reported", "cancelled"],
    );
    assertEquals(events[0]!.payload["claim_seq"], null);
  });
});

Deno.test("problems/grouping#R9: core를 껐다 켜면 반응기가 저장된 seq 뒤 ticket event를 따라잡는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-problems-work-" });
  const teams = [
    { createLedgerRegistration: createDocumentsRegistration },
    { createLedgerRegistration: createAppsRegistration },
    { codingAgentConnectionDefinitions },
    { ticketDefinitions },
    { problemsTestDefinitions },
    { problemsReportDefinitions },
  ];
  const teamModules = [
    new URL("../../projects/register.ts", import.meta.url).href,
    new URL("../../apps/register.ts", import.meta.url).href,
    new URL("../../server/identity/coding-connection.ts", import.meta.url).href,
    new URL("../../apps/tickets/register.ts", import.meta.url).href,
    new URL("../register.ts", import.meta.url).href,
    new URL("../repairs/context-ports_test.ts", import.meta.url).href,
    new URL("../../apps/tickets/claim-ports_test.ts", import.meta.url).href,
  ];
  try {
    // 첫 기동은 감독 worker 없이 뜬다: ticket event는 쌓이지만 반응기가 없다.
    const first = await startCore({
      lophnHome: home,
      port: 0,
      teams,
      teamModules,
      clock: manualClock(Date.now()),
      random: seededRandom(1),
      testCredentials: true,
      superviseIo: false,
    });
    assert(first.ok, first.ok ? undefined : JSON.stringify(first.error));
    let problem = "";
    let ticket = "";
    try {
      const core = first.value;
      assert(core.acceptTestCredential);
      let sequence = 0;
      const issue = async (
        actor: string,
        principal: string,
        operations: string[],
      ) => {
        const context = {
          principal,
          actor: actor as never,
          scope: { operations, targets: {} },
          conditions: {},
          credential_ref: `restart-${++sequence}`,
        };
        const token = `${sequence}`.repeat(43).slice(0, 43);
        const accepted = await core.acceptTestCredential!(context, token);
        assert(accepted.ok);
        assert((await core.record(context)).ok);
        return token;
      };
      const user = await issue("user", "user-1", [
        "app.create",
        "CreateCodingAgentConnection",
        "CreateTicket",
        "MakeTicketReady",
      ]);
      const machine = await issue("machine", "machine-1", ["RecordReport"]);
      const agent = await issue(`coding_agent:${CAC}`, `coding_agent:${CAC}`, [
        "ClaimTicket",
        "ShowTicket",
      ]);
      const app = await post(core.port, "apps/create", user, {
        slug: "notes",
        name: "Notes",
        description: "notes app",
      });
      assertEquals(app.status, 200, JSON.stringify(app.body));
      const appId = String(app.body["id"]);
      const connection = await post(
        core.port,
        "coding_agent_connections/create",
        user,
        {
          id: CAC,
          label: "claude",
          scope: { kind: "all", app: null },
          token_digest: DIGEST,
        },
      );
      assertEquals(connection.status, 200, JSON.stringify(connection.body));
      problem = await record(core.port, machine, "machine-1", appId);
      const created = await post(
        core.port,
        "tickets/create",
        user,
        repairInput(appId, problem),
      );
      assertEquals(created.status, 200, JSON.stringify(created.body));
      ticket = String(created.body["ticket"]);
      const ready = await post(
        core.port,
        "tickets/make_ready",
        user,
        readyInput(ticket, String(created.body["revision"]), problem),
        { base_revision: String(created.body["revision"]) },
      );
      assertEquals(ready.status, 200, JSON.stringify(ready.body));
      const revision = String((await show(core.port, agent, ticket)).revision);
      const claimed = await post(
        core.port,
        "tickets/claim",
        agent,
        { ticket, base_revision: revision },
        { base_revision: revision },
      );
      assertEquals(claimed.status, 200, JSON.stringify(claimed.body));
      // 반응기가 없으니 문제는 그대로고 cursor도 없다.
      assertEquals(problemOf(home, problem), { status: "open", work: null });
      assertEquals(cursorOf(home), 0n);
    } finally {
      await first.value.shutdown();
    }

    // 다시 켜면 worker가 저장된 위치(없음) 뒤 event를 따라잡아 claim된 ticket을 fixing으로 잇는다.
    const second = await startCore({
      lophnHome: home,
      port: 0,
      teams,
      teamModules,
      clock: manualClock(Date.now()),
      random: seededRandom(2),
      testCredentials: true,
    });
    assert(second.ok, second.ok ? undefined : JSON.stringify(second.error));
    try {
      await reacted(home, "재시작 뒤 ticket event");
      assertEquals(problemOf(home, problem), {
        status: "fixing",
        work: ticket,
      });
      const caught = cursorOf(home);
      assert(caught >= lastTicketEvent(home));
      // 이미 반응한 event는 다시 반응하지 않는다: 위치는 줄지 않고 ProblemWork event도 늘지 않는다.
      const before = workEvents(home, problem).length;
      await new Promise((resolve) => setTimeout(resolve, 500));
      assertEquals(workEvents(home, problem).length, before);
      assert(cursorOf(home) >= caught);
    } finally {
      await second.value.shutdown();
    }
    // 세 번째 기동도 같은 위치에서 이어 받고 결과를 바꾸지 않는다.
    const third = await startCore({
      lophnHome: home,
      port: 0,
      teams,
      teamModules,
      clock: manualClock(Date.now()),
      random: seededRandom(3),
      testCredentials: true,
    });
    assert(third.ok, third.ok ? undefined : JSON.stringify(third.error));
    try {
      await new Promise((resolve) => setTimeout(resolve, 1_500));
      assertEquals(problemOf(home, problem), {
        status: "fixing",
        work: ticket,
      });
      assertEquals(workEvents(home, problem).length, 1);
    } finally {
      await third.value.shutdown();
    }
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
