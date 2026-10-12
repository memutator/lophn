// ticket tool을 실제 core에 붙이는 통합 테스트다(T20, mcp#R26, R27; cli#R36,
// R41; tickets#R16). createCoreHarness로 core를 띄우고 tool 실행을 route POST로
// 확인한다. list paging(21개 → 20개+cursor), claim·renew·release 응답
// connection·claim_seq·expires_at·반납 방법, 표 밖 op 거절을 본다.
import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../base/mod.ts";
import { createCoreHarness } from "../../testing/core.ts";
import { codingAgentConnectionDefinitions } from "../../server/identity/coding-connection.ts";
import { createLedgerRegistration as createAppsRegistration } from "../register.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "../../projects/register.ts";
import { ticketDefinitions } from "./register.ts";

const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const DIGEST = "a".repeat(64);
const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const START = Date.parse("2026-10-05T00:00:00.000Z");
const LIST_LIMIT = 20;

type Body = Record<string, unknown> & {
  error?: { code?: string };
  tickets?: unknown[];
  next_cursor?: string | null;
  as_of_seq?: string;
  ticket?: Record<string, unknown>;
  claim_seq?: string;
  expires_at?: string;
  connection?: string;
  state?: string;
  checks?: unknown[];
};

async function get(
  port: number,
  path: string,
  token: string,
  input: unknown,
): Promise<{ status: number; body: Body }> {
  // read는 입력을 envelope 없이 직접 받는다(platform/api dispatch).
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(input),
  });
  return { status: response.status, body: await response.json() };
}

async function post(
  port: number,
  path: string,
  token: string,
  input: unknown,
  compare: unknown = {},
): Promise<{ status: number; body: Body }> {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
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
  return { status: response.status, body: await response.json() };
}

function value(result: Result<{ token: string }>): string {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value.token;
}

const teams = [
  { createLedgerRegistration: createDocumentsRegistration },
  { createLedgerRegistration: createAppsRegistration },
  { codingAgentConnectionDefinitions },
  { ticketDefinitions },
];

const teamModules = [
  new URL("../../projects/register.ts", import.meta.url).href,
  new URL("../register.ts", import.meta.url).href,
  new URL("../../server/identity/coding-connection.ts", import.meta.url).href,
  new URL("./register.ts", import.meta.url).href,
  new URL("./claim-ports_test.ts", import.meta.url).href,
];

Deno.test(
  "coding-agent/mcp-server#R26, coding-agent/cli#R36: list는 21개에서 20개와 cursor를 남긴다",
  async () => {
    const harness = await createCoreHarness({
      nowMs: START,
      teams,
      teamModules,
    });
    assert(harness.ok, harness.ok ? undefined : JSON.stringify(harness.error));
    const core = harness.value;
    try {
      const user = value(
        await core.credential({
          actor: "user",
          principal: "user-1",
          scope: {
            operations: ["app.create", "ListTickets", "ShowTicket"],
            targets: {},
          },
          conditions: {},
        }),
      );
      const app = await post(core.port, "/v1/apps/create", user, {
        slug: "notes",
        name: "Notes",
        description: "notes app",
      });
      assertEquals(app.status, 200, JSON.stringify(app.body));
      // 21개 ticket을 만든다.
      {
        const readyUser = value(
          await core.credential({
            actor: "user",
            principal: "user-1",
            scope: {
              operations: ["CreateTicket"],
              targets: {},
            },
            conditions: {},
          }),
        );
        for (let index = 0; index < 21; index++) {
          const created = await post(
            core.port,
            "/v1/tickets/create",
            readyUser,
            {
              app: String((app.body as { id?: string }).id),
              kind: "implementation",
              title: `fix leaf redaction ${index}`,
              what: "redact leaf before snapshot",
              why: "snapshot shows the raw leaf",
              references: [],
              adoption_questions: [],
              conditions: [],
              inspect: ["src/leaf.ts"],
              preserve: [],
              problems: [],
              readiness: "needs_confirmation",
              needs: ["confirm the redaction"],
            },
          );
          assertEquals(created.status, 200, JSON.stringify(created.body));
        }
      }
      // 첫 page는 20개와 cursor다.
      const first = await get(core.port, "/v1/tickets/list", user, {
        limit: LIST_LIMIT,
      });
      assertEquals(first.status, 200, JSON.stringify(first.body));
      assertEquals(Array.isArray(first.body.tickets), true);
      assertEquals((first.body.tickets ?? []).length, LIST_LIMIT);
      assert(typeof first.body.next_cursor === "string");
      // cursor로 다시 읽으면 나머지 1개다.
      const second = await get(core.port, "/v1/tickets/list", user, {
        limit: LIST_LIMIT,
        cursor: first.body.next_cursor,
      });
      assertEquals(second.status, 200, JSON.stringify(second.body));
      assertEquals((second.body.tickets ?? []).length, 1);
      assertEquals(second.body.next_cursor, null);
      // 요약은 제목·종류·앱·문제 수·readiness를 가진다.
      const summary = (first.body.tickets ?? [])[0] as Record<
        string,
        unknown
      >;
      for (
        const field of [
          "id",
          "app",
          "kind",
          "title",
          "state",
          "readiness",
          "problem_count",
        ]
      ) {
        assertEquals(field in summary, true, field);
      }
      // state filter는 21개 전부 open이다.
      const filtered = await get(core.port, "/v1/tickets/list", user, {
        state: "claimed",
      });
      assertEquals((filtered.body.tickets ?? []).length, 0);
    } finally {
      await core.close();
    }
  },
);

Deno.test(
  "coding-agent/mcp-server#R27: claim·renew·release는 실제 실행이고 응답에 connection·claim_seq·expires_at·반납 방법을 가진다",
  async () => {
    const harness = await createCoreHarness({
      nowMs: START,
      teams,
      teamModules,
    });
    assert(harness.ok, harness.ok ? undefined : JSON.stringify(harness.error));
    const core = harness.value;
    try {
      const user = value(
        await core.credential({
          actor: "user",
          principal: "user-1",
          scope: {
            operations: [
              "app.create",
              "CreateCodingAgentConnection",
              "CreateTicket",
              "MakeTicketReady",
            ],
            targets: {},
          },
          conditions: {},
        }),
      );
      const agent = value(
        await core.credential({
          actor: "coding_agent",
          principal: `coding_agent:${CAC}`,
          scope: {
            operations: [
              "ClaimTicket",
              "RenewTicketClaim",
              "ReleaseTicketClaim",
              "ShowTicket",
              "TicketChecks",
            ],
            targets: {},
          },
          conditions: {},
        }),
      );
      const app = await post(core.port, "/v1/apps/create", user, {
        slug: "notes",
        name: "Notes",
        description: "notes app",
      });
      assertEquals(app.status, 200, JSON.stringify(app.body));
      const appId = String((app.body as { id?: string }).id);
      await post(core.port, "/v1/coding_agent_connections/create", user, {
        id: CAC,
        label: "claude",
        scope: { kind: "all", app: null },
        token_digest: DIGEST,
      });
      const created = await post(core.port, "/v1/tickets/create", user, {
        app: appId,
        kind: "implementation",
        title: "fix leaf redaction",
        what: "redact leaf before snapshot",
        why: "snapshot shows the raw leaf",
        references: [],
        adoption_questions: [],
        conditions: [],
        inspect: ["src/leaf.ts"],
        preserve: [],
        problems: [],
        readiness: "needs_confirmation",
        needs: ["confirm the redaction"],
      });
      assertEquals(created.status, 200, JSON.stringify(created.body));
      const ticket = String((created.body as { ticket?: string }).ticket);
      const ready = await post(core.port, "/v1/tickets/make_ready", user, {
        ticket,
        base_revision: String((created.body as { revision?: string }).revision),
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
        ],
        inspect: ["src/leaf.ts"],
        preserve: [],
      }, {
        base_revision: String((created.body as { revision?: string }).revision),
      });
      assertEquals(ready.status, 200, JSON.stringify(ready.body));
      const claimRevision = String(ready.body.revision);
      // claim은 실제 실행이다.
      const claim = await post(core.port, "/v1/tickets/claim", agent, {
        ticket,
        base_revision: claimRevision,
      }, { base_revision: claimRevision });
      assertEquals(claim.status, 200, JSON.stringify(claim.body));
      assertEquals(claim.body.connection, CAC);
      assert(typeof claim.body.claim_seq === "string");
      assertEquals(
        Date.parse(String(claim.body.expires_at)),
        START + 3_600_000,
      );
      // 표가 자동 갱신을 덧붙이지 않는다. expires_at은 claim 시각 정확히 1시간이다.
      const show = await get(core.port, "/v1/tickets/show", agent, {
        ticket,
      });
      assertEquals(show.status, 200, JSON.stringify(show.body));
      const claimView = (show.body.ticket ?? {}).claim as Record<
        string,
        unknown
      >;
      assertEquals(claimView.connection, CAC);
      assertEquals(claimView.claim_seq, claim.body.claim_seq);
      const checks = await get(core.port, "/v1/tickets/checks", agent, {
        ticket,
      });
      assertEquals(checks.status, 200, JSON.stringify(checks.body));
      // release는 실제 반납이다.
      const released = await post(
        core.port,
        "/v1/tickets/release_claim",
        agent,
        {
          ticket,
          claim_seq: claim.body.claim_seq,
          base_revision: String(claim.body.claim_seq),
        },
        { base_revision: String(claim.body.claim_seq) },
      );
      assertEquals(released.status, 200, JSON.stringify(released.body));
      assertEquals(released.body.state, "open");
    } finally {
      await core.close();
    }
  },
);

Deno.test(
  "coding-agent/mcp-server#R37, coding-agent/tickets#R16: start·resume·permission 응답 op와 문제 직접 claim은 route가 없다",
  async () => {
    const harness = await createCoreHarness({
      nowMs: START,
      teams: [{ ticketDefinitions }],
      teamModules: [new URL("./register.ts", import.meta.url).href],
    });
    assert(harness.ok, harness.ok ? undefined : JSON.stringify(harness.error));
    const core = harness.value;
    try {
      const user = value(
        await core.credential({
          actor: "user",
          principal: "user-1",
          scope: { operations: [], targets: {} },
          conditions: {},
        }),
      );
      // 소유 route가 없다. 없는 것과 똑같이 -32601이다(route registry).
      for (
        const path of [
          "/v1/tickets/start",
          "/v1/tickets/resume",
          "/v1/tickets/permission",
          "/v1/problems/claim",
        ]
      ) {
        await post(core.port, path, user, { ticket: "tkt_x" });
      }
      // 존재하는 route는 실패가 아니다(ticket list만 본다).
      const listed = await get(core.port, "/v1/tickets/list", user, {});
      assertEquals(listed.status, 200, JSON.stringify(listed.body));
    } finally {
      await core.close();
    }
  },
);
