// 사람 화면용 ticket read를 실제 core(임시 LOPHN_HOME)에 붙여 본다(coding-agent/tickets#R27,
// plan coding-agent T27). 사용자가 일곱 화면 상태 ticket의 목록과 상세를 읽고, 기본 data에는 claim·기한·
// 연결 ID·전체 조건·보고·test 원문이 없으며, 앱 범위 coding credential은 다른 앱의 ticket을 없는
// ticket과 같은 답으로 받는다. ticket 행은 test-only seeding이다(ticket-checker_test.ts와 같은 자리).
import { DatabaseSync } from "node:sqlite";
import { assert, assertEquals, assertFalse } from "@std/assert";
import { err, ok, type Result } from "../../packages/base/mod.ts";
import {
  codingCredentialRef,
  createFakeKeychain,
} from "../../packages/platform/secrets/mod.ts";
import { createCoreHarness } from "./testing/core.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "./documents.ts";
import { ticketDefinitions } from "./tickets.ts";

const START = Date.parse("2026-10-07T00:00:00.000Z");
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const REL = "rel_01arz3ndektsv4rrffq69g5fav";
const VRF = "vrf_01arz3ndektsv4rrffq69g5fav";
const HASH = "d".repeat(64);
const decoder = new TextDecoder();

const ID = {
  needs: "tkt_01arz3ndektsv4rrffq69g5fa1",
  ready: "tkt_01arz3ndektsv4rrffq69g5fa2",
  working: "tkt_01arz3ndektsv4rrffq69g5fa3",
  reported: "tkt_01arz3ndektsv4rrffq69g5fa4",
  confirmed: "tkt_01arz3ndektsv4rrffq69g5fa5",
  failed: "tkt_01arz3ndektsv4rrffq69g5fa6",
  cancelled: "tkt_01arz3ndektsv4rrffq69g5fa7",
  otherApp: "tkt_01arz3ndektsv4rrffq69g5fa8",
  absent: "tkt_01arz3ndektsv4rrffq69g5fb9",
};

type Reply = { status: number; body: Record<string, unknown> };
type Summary = {
  id: string;
  screen_state: string;
  next_action: string | null;
  request: string;
};

async function call(
  port: number,
  path: string,
  token: string,
  body: unknown,
): Promise<Reply> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    body: await response.json() as Record<string, unknown>,
  };
}

function token(result: Result<{ token: string }>): string {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value.token;
}

function seed(
  dataRoot: string,
  appA: string,
  appB: string,
): void {
  const db = new DatabaseSync(`${dataRoot}/lophn.db`);
  try {
    db.exec("PRAGMA busy_timeout = 5000");
    const ticket = db.prepare(
      `INSERT INTO tickets (id, app, kind, title, what, why, inspect, preserve, problems,
         state, readiness, needs, cancel_reason, completion_seq, revision)
       VALUES (?, ?, 'implementation', ?, ?, 'because', '["src/a.ts"]', '[]', '[]',
         ?, ?, ?, ?, ?, ?)`,
    );
    const rows: [
      string,
      string,
      string,
      string,
      string,
      string,
      string | null,
      string | null,
    ][] = [
      [
        ID.needs,
        appA,
        "needs",
        "state",
        "open",
        "needs_confirmation",
        null,
        null,
      ],
      [ID.ready, appA, "ready", "state", "open", "ready", null, null],
      [ID.working, appA, "working", "state", "claimed", "ready", null, null],
      [ID.reported, appA, "reported", "state", "reported", "ready", null, "11"],
      [
        ID.confirmed,
        appA,
        "confirmed",
        "state",
        "confirmed",
        "ready",
        null,
        "12",
      ],
      [ID.failed, appA, "failed", "state", "check_failed", "ready", null, "13"],
      [
        ID.cancelled,
        appA,
        "cancelled",
        "state",
        "cancelled",
        "ready",
        "stop",
        null,
      ],
      [ID.otherApp, appB, "other", "state", "open", "ready", null, null],
    ];
    for (
      const [id, app, title, what, state, readiness, cancel, completion] of rows
    ) {
      ticket.run(
        id,
        app,
        `title ${title}`,
        `${what} ${title} request`,
        state,
        readiness,
        readiness === "ready" ? "[]" : '["confirm the redaction"]',
        cancel,
        completion,
        "5",
      );
    }
    db.prepare(
      `INSERT INTO ticket_claims (ticket, connection, claim_seq, expires_at)
       VALUES (?, ?, '7', '2026-10-07T01:00:00.000Z')`,
    ).run(ID.working, CAC);
    const condition = db.prepare(
      `INSERT INTO ticket_conditions (ticket, position, kind, input, condition_hash)
       VALUES (?, ?, ?, ?, ?)`,
    );
    const completion = db.prepare(
      `INSERT INTO ticket_completions (ticket, seq, claim_seq, release, summary_hash,
         outputs, fix_records, verifications)
       VALUES (?, ?, '7', ?, ?, '[]', '[]', ?)`,
    );
    const result = db.prepare(
      `INSERT INTO ticket_check_results (ticket, completion_seq, condition, result, reason, verification)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const finished: [string, string, string, string][] = [
      [ID.reported, "11", "pass", "inconclusive"],
      [ID.confirmed, "12", "pass", "pass"],
      [ID.failed, "13", "fail", "pass"],
    ];
    for (const [id, seq, first, second] of finished) {
      condition.run(id, 0, "app_test", '{"kind":"app_test"}', HASH);
      condition.run(
        id,
        1,
        "test_command",
        JSON.stringify({
          kind: "test_command",
          executable: "deno",
          argv: ["task", "secret-test-text"],
          cwd: ".",
          timeout_ms: 60000,
          expected_exit_code: 0,
        }),
        HASH,
      );
      completion.run(id, seq, REL, HASH, JSON.stringify([VRF]));
      result.run(
        id,
        seq,
        0,
        first,
        `${first} reason`,
        first === "pass" ? VRF : null,
      );
      result.run(
        id,
        seq,
        1,
        second,
        `${second} reason`,
        second === "pass" ? VRF : null,
      );
    }
  } finally {
    db.close();
  }
}

Deno.test("coding-agent/tickets#R27: 사용자가 일곱 화면 상태 ticket의 목록과 상세를 읽고 기본 data에는 안쪽 계약이 없으며 범위 밖 ticket은 없는 ticket과 같은 답이다", async () => {
  const keychain = createFakeKeychain();
  const harness = await createCoreHarness({
    nowMs: START,
    teams: [
      { createLedgerRegistration: createDocumentsRegistration },
      { createLedgerRegistration: createAppsRegistration },
      { codingAgentConnectionDefinitions },
      { ticketDefinitions },
    ],
    teamModules: [
      new URL("./documents.ts", import.meta.url).href,
      new URL("./apps.ts", import.meta.url).href,
      new URL("./coding-agent.ts", import.meta.url).href,
      new URL("./tickets.ts", import.meta.url).href,
    ],
    coding: { keychain, loaders: [] },
  });
  assert(harness.ok, harness.ok ? undefined : JSON.stringify(harness.error));
  const core = harness.value;
  try {
    await core.codingCredentialsReady;
    const user = token(
      await core.credential({
        actor: "user",
        principal: "user-1",
        scope: {
          operations: [
            "app.create",
            "CreateCodingAgentConnection",
            "ListTicketScreen",
            "ShowTicketScreen",
          ],
          targets: {},
        },
        conditions: {},
      }),
    );
    const apps: string[] = [];
    for (const slug of ["notes", "other"]) {
      const created = await call(core.port, "apps/create", user, {
        input: { slug, name: slug, description: `${slug} app` },
        idempotency_key: `k-${crypto.randomUUID()}`,
        compare: {},
        prepared: [],
      });
      assertEquals(created.status, 200, JSON.stringify(created.body));
      apps.push(String(created.body["id"]));
    }
    const [appA, appB] = apps as [string, string];
    seed(core.dataRoot, appA, appB);

    // 사용자 목록: 일곱 상태가 서로 다른 값이고 다음 행동은 정해진 하나다.
    const listed = await call(core.port, "tickets/screen_list", user, {});
    assertEquals(listed.status, 200, JSON.stringify(listed.body));
    const tickets = listed.body["tickets"] as Summary[];
    const byId = new Map(tickets.map((item) => [item.id, item]));
    const expected: [string, string, string | null][] = [
      [ID.needs, "needs_confirmation", "needs_confirmation"],
      [ID.ready, "ready", "start"],
      [ID.working, "in_progress", null],
      [ID.reported, "reported", "waiting_for_approval"],
      [ID.confirmed, "confirmed", "check_result"],
      [ID.failed, "check_failed", "start"],
      [ID.cancelled, "cancelled", null],
      [ID.otherApp, "ready", "start"],
    ];
    assertEquals(tickets.length, expected.length);
    for (const [id, screen, next] of expected) {
      assertEquals(byId.get(id)?.screen_state, screen, id);
      assertEquals(byId.get(id)?.next_action, next, id);
    }
    assertEquals(byId.get(ID.needs)?.request, "state needs request");
    assertEquals(
      new Set(tickets.slice(0, 7).map((item) => item.screen_state)).size,
      7,
    );

    // 기본 data에는 claim이라는 말·기한·연결 ID·조건·보고·test 원문이 없다.
    const text = JSON.stringify(listed.body).toLowerCase();
    for (
      const hidden of [
        "claim",
        "expires",
        "cac_",
        "executable",
        "secret-test-text",
        "summary_hash",
        "conditions",
        "reason",
      ]
    ) assertFalse(text.includes(hidden), hidden);

    // 필터와 paging.
    const filtered = await call(core.port, "tickets/screen_list", user, {
      app: appA,
      screen_state: "ready",
    });
    assertEquals(
      (filtered.body["tickets"] as Summary[]).map((item) => item.id),
      [ID.ready],
    );
    const first = await call(core.port, "tickets/screen_list", user, {
      limit: 3,
    });
    assertEquals((first.body["tickets"] as Summary[]).length, 3);
    const second = await call(core.port, "tickets/screen_list", user, {
      limit: 20,
      cursor: first.body["next_cursor"],
    });
    assertEquals((second.body["tickets"] as Summary[]).length, 5);

    // 상세에서만 기한·연결·조건·검사·남은 조건이 나온다.
    const working = await call(core.port, "tickets/screen_detail", user, {
      ticket: ID.working,
    });
    assertEquals(working.status, 200, JSON.stringify(working.body));
    const workingTicket = working.body["ticket"] as Record<string, unknown>;
    assertEquals(workingTicket["screen_state"], "in_progress");
    assertEquals(workingTicket["claim"], {
      connection: CAC,
      claim_seq: "7",
      expires_at: "2026-10-07T01:00:00.000Z",
    });
    const reported = await call(core.port, "tickets/screen_detail", user, {
      ticket: ID.reported,
    });
    const reportedTicket = reported.body["ticket"] as {
      conditions: { input: { executable?: string } }[];
      checks: { result: string }[];
      remaining: number[];
      completion: { release: string } | null;
      claim: unknown;
    };
    assertEquals(reportedTicket.conditions.length, 2);
    assertEquals(reportedTicket.conditions[1]?.input.executable, "deno");
    assertEquals(reportedTicket.checks.map((check) => check.result), [
      "pass",
      "inconclusive",
    ]);
    assertEquals(reportedTicket.remaining, [1]);
    assertEquals(reportedTicket.completion?.release, REL);
    assertEquals(reportedTicket.claim, null);
    const failed = await call(core.port, "tickets/screen_detail", user, {
      ticket: ID.failed,
    });
    assertEquals(
      (failed.body["ticket"] as { remaining: number[] }).remaining,
      [0],
    );
    const confirmed = await call(core.port, "tickets/screen_detail", user, {
      ticket: ID.confirmed,
    });
    assertEquals(
      (confirmed.body["ticket"] as { remaining: number[] }).remaining,
      [],
    );
    const needs = await call(core.port, "tickets/screen_detail", user, {
      ticket: ID.needs,
    });
    assertEquals((needs.body["ticket"] as { needs: string[] }).needs, [
      "confirm the redaction",
    ]);
    const absentForUser = await call(core.port, "tickets/screen_detail", user, {
      ticket: ID.absent,
    });
    assertEquals(absentForUser.status, 404);

    // 앱 하나로 좁힌 coding credential은 다른 앱의 ticket을 없는 ticket처럼 받는다.
    const connected = await core.codingCredentials!.connect(
      { label: "claude", scope: { kind: "app", app: appA } },
      async (submission): Promise<Result<unknown>> => {
        const sent = await call(
          core.port,
          "coding_agent_connections/create",
          user,
          {
            input: submission,
            idempotency_key: `k-${crypto.randomUUID()}`,
            compare: {},
            prepared: [],
          },
        );
        return sent.status === 200 ? ok(sent.body) : err({
          code: "conflict",
          message: `${sent.status}`,
        });
      },
    );
    assert(connected.ok, connected.ok ? "" : connected.error.message);
    const agent = decoder.decode(
      keychain.stored.get(codingCredentialRef(connected.value.connection)!)!,
    );
    const agentList = await call(core.port, "tickets/screen_list", agent, {});
    assertEquals(agentList.status, 200, JSON.stringify(agentList.body));
    assertEquals(
      (agentList.body["tickets"] as Summary[]).map((item) => item.id).sort(),
      [
        ID.needs,
        ID.ready,
        ID.working,
        ID.reported,
        ID.confirmed,
        ID.failed,
        ID.cancelled,
      ],
    );
    const own = await call(core.port, "tickets/screen_detail", agent, {
      ticket: ID.ready,
    });
    assertEquals(own.status, 200, JSON.stringify(own.body));
    const other = await call(core.port, "tickets/screen_detail", agent, {
      ticket: ID.otherApp,
    });
    const absent = await call(core.port, "tickets/screen_detail", agent, {
      ticket: ID.absent,
    });
    assertEquals(other.status, absent.status);
    assertEquals(other.body, absent.body);
    assertEquals(other.status, 404);
  } finally {
    await core.close();
  }
});
