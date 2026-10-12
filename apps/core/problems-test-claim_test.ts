// coding agent의 reproduction RequestTest는 그 연결이 지금 쥔 repair ticket의 claim에 기대야 한다(problems/tests#R1,
// coding-agent/mcp-server#R25, cli#R34). 도구를 거르는 것과 별개로 core가 접수 때 다시 확인한다. 제품과 같은 감독으로
// core를 temp LOPHN_HOME에 띄우고(사람 데이터 root는 열지 않는다) 실제 route로 보낸다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import type { AuthenticatedContext } from "../../packages/protocol/server/mod.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { type Core, startCore } from "./core.ts";
import { problemsTestDefinitions } from "./problems.ts";
import { ticketDefinitions } from "./tickets.ts";

const CODING = "k".repeat(43);
const HUMAN = "h".repeat(43);
const CONNECTION = "cac_01arz3ndektsv4rrffq69g5fav";
const OTHER_CONNECTION = "cac_01ary8h2z3n4p5q6r7s8t9v0wa";
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const TICKET = "tkt_01arz3ndektsv4rrffq69g5fav";
const OTHER_TICKET = "tkt_01ary8h2z3n4p5q6r7s8t9v0wa";
const PROBLEM = "prb_01arz3ndektsv4rrffq69g5fav";
const OTHER_PROBLEM = "prb_01ary8h2z3n4p5q6r7s8t9v0wa";
const BEFORE = "rel_01arz3ndektsv4rrffq69g5fav";
const AFTER = "rel_01ary8h2z3n4p5q6r7s8t9v0wa";

const TEAMS = [
  { createLedgerRegistration: createAppsRegistration },
  { codingAgentConnectionDefinitions },
  { problemsTestDefinitions },
  { ticketDefinitions },
];
const MODULES = [
  new URL("./apps.ts", import.meta.url).href,
  new URL("./coding-agent.ts", import.meta.url).href,
  new URL("./problems.ts", import.meta.url).href,
  new URL("./tickets.ts", import.meta.url).href,
];

async function open(home: string): Promise<Core> {
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: TEAMS,
    teamModules: MODULES,
    writerClock: "system",
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  return started.value;
}

async function accept(
  core: Core,
  context: AuthenticatedContext,
  token: string,
): Promise<void> {
  const accepted = await core.acceptTestCredential?.(context, token);
  assert(accepted?.ok);
  const recorded = await core.record(context);
  assert(recorded.ok);
}

async function post(
  core: Core,
  path: string,
  body: unknown,
  token: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`http://127.0.0.1:${core.port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let json: Record<string, unknown> = {};
  try {
    json = JSON.parse(text) as Record<string, unknown>;
  } catch { /* JSON이 아니다 */ }
  return { status: response.status, body: json };
}

// 앱·보고된 repair ticket·그 claim을 ledger에 심는다(각 소유 command의 결과 모양 그대로다).
function seed(home: string): void {
  const db = new DatabaseSync(`${home}/lophn.db`);
  try {
    db.prepare(
      `insert into apps (id, slug, name, description, planning_version, source_path,
         active_release, run_enabled, revision, status)
       values (?, 'notes', 'Notes', 'notes app', NULL, NULL, NULL, 0, '1', 'active')`,
    ).run(APP);
    const ticket = db.prepare(
      `insert into tickets (id, app, kind, title, what, why, inspect, preserve, problems,
         state, readiness, needs, cancel_reason, completion_seq, revision)
       values (?, ?, 'repair', 't', 'w', 'y', '[]', '[]', ?, 'claimed', 'ready', '[]',
         NULL, NULL, '1')`,
    );
    ticket.run(TICKET, APP, JSON.stringify([PROBLEM]));
    ticket.run(OTHER_TICKET, APP, JSON.stringify([OTHER_PROBLEM]));
    const claim = db.prepare(
      `insert into ticket_claims (ticket, connection, claim_seq, expires_at)
       values (?, ?, ?, '2099-01-01T00:00:00.000Z')`,
    );
    claim.run(TICKET, CONNECTION, "5");
    claim.run(OTHER_TICKET, OTHER_CONNECTION, "6");
    const linked = db.prepare(
      `insert into ticket_problems (ticket, position, problem) values (?, 0, ?)`,
    );
    linked.run(TICKET, PROBLEM);
    linked.run(OTHER_TICKET, OTHER_PROBLEM);
  } finally {
    db.close();
  }
}

const reproduction = (key: string, patch: Record<string, unknown> = {}) => ({
  request_key: key,
  kind: "reproduction",
  app: APP,
  target: { bundle_hash: "b".repeat(64), release: AFTER },
  problem: PROBLEM,
  basis_seq: "1",
  reports: ["rpt_01arz3ndektsv4rrffq69g5fav"],
  before: BEFORE,
  after: AFTER,
  ticket: null,
  test: "c".repeat(64),
  ...patch,
});

const command = (input: unknown, key: string) => ({
  input,
  idempotency_key: key,
  compare: {},
  prepared: [],
});

Deno.test("problems/tests#R1 coding-agent/mcp-server#R25 cli#R34: coding agent의 reproduction 요청은 그 연결의 현재 claim과 맞는 repair ticket 없이는 접수하지 않는다", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-test-claim-" });
  // 첫 기동은 ledger 표를 만든다. 멈춘 뒤 심고 다시 띄운다.
  await (await open(home)).shutdown();
  seed(home);
  const core = await open(home);
  try {
    await accept(core, {
      principal: "coding-agent-1",
      actor: `coding_agent:${CONNECTION}`,
      scope: { operations: ["RequestTest"], targets: { app: APP } },
      conditions: { app: APP },
      credential_ref: "cred-coding",
    }, CODING);
    await accept(core, {
      principal: "user-1",
      actor: "user",
      scope: { operations: ["RequestTest"], targets: { app: APP } },
      conditions: { app: APP },
      credential_ref: "cred-human",
    }, HUMAN);
    const send = (
      token: string,
      key: string,
      patch?: Record<string, unknown>,
    ) =>
      post(
        core,
        "problems/request-test",
        command(reproduction(key, patch), `send-${key}`),
        token,
      );
    const message = (body: Record<string, unknown>) =>
      String((body.error as { message?: string } | undefined)?.message ?? "");

    // claim을 싣지 않은 coding agent 요청은 거절한다.
    const none = await send(CODING, "claim-none");
    assertEquals(none.status, 409, JSON.stringify(none.body));
    assert(message(none.body).includes("ticket_source"));
    // 다른 연결이 쥔 claim은 이 연결의 것이 아니다.
    const other = await send(CODING, "claim-other", {
      ticket_source: { ticket: OTHER_TICKET, claim_seq: "6" },
    });
    assertEquals(other.status, 409, JSON.stringify(other.body));
    assert(message(other.body).includes("wrong_connection"));
    // claim_seq가 현재가 아니다.
    const stale = await send(CODING, "claim-stale", {
      ticket_source: { ticket: TICKET, claim_seq: "4" },
    });
    assertEquals(stale.status, 409, JSON.stringify(stale.body));
    // 현재 claim이어도 그 ticket이 이 문제의 repair ticket이어야 한다.
    const wrongProblem = await send(CODING, "claim-problem", {
      ticket_source: { ticket: TICKET, claim_seq: "5" },
      problem: OTHER_PROBLEM,
    });
    assertEquals(wrongProblem.status, 409, JSON.stringify(wrongProblem.body));
    assert(message(wrongProblem.body).includes("repair ticket"));
    // 현재 claim과 맞으면 claim 검사를 지난다. release·problem·report 참조는 따로 보며 이 ledger에는 없다.
    const current = await send(CODING, "claim-current", {
      ticket_source: { ticket: TICKET, claim_seq: "5" },
    });
    assertEquals(current.status, 404, JSON.stringify(current.body));
    // 사람의 reproduction 요청에는 이 규칙이 없다(참조만 본다).
    const human = await send(HUMAN, "claim-human");
    assertEquals(human.status, 404, JSON.stringify(human.body));
    // 같은 coding agent의 app test 요청에는 claim 규칙이 없다.
    const appTest = await post(
      core,
      "problems/request-test",
      command({
        request_key: "claim-app-test",
        kind: "app_test",
        app: APP,
        target: { bundle_hash: "b".repeat(64), release: null },
        problem: null,
        basis_seq: null,
        reports: [],
        before: null,
        after: null,
        ticket: null,
        test: "c".repeat(64),
      }, "send-claim-app-test"),
      CODING,
    );
    assertEquals(appTest.status, 200, JSON.stringify(appTest.body));
    assertEquals(appTest.body.accepted, true);
  } finally {
    await core.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
