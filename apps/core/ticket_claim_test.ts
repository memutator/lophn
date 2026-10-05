// 제품 core 경로의 ticket claim(coding-agent/tickets#R11–R14).
// 실제 connection 표와 sync auth port로 claim·갱신·반납을 보고, 기동 때 기록한
// machine credential이 만료 claim을 expire_claim으로 정리하는지 본다.
import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../packages/base/mod.ts";
import { createCoreHarness } from "./testing/core.ts";
import { codingAgentConnectionDefinitions } from "./coding-agent.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";
import { createLedgerRegistration as createDocumentsRegistration } from "./documents.ts";
import { ticketDefinitions } from "./tickets.ts";

const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const DIGEST = "a".repeat(64);
const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";
const START = Date.parse("2026-10-05T00:00:00.000Z");
const DURATION = 3_600_000;

type Body = {
  error?: { code?: string };
  ticket?: string;
  revision?: string;
  claim_seq?: string;
  expires_at?: string;
  state?: string;
};

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

async function revisionOf(
  port: number,
  token: string,
  ticket: string,
): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${port}/v1/tickets/show`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ ticket }),
  });
  const body = await response.json();
  if (response.status !== 200) {
    throw new Error(`show ${response.status} ${JSON.stringify(body)}`);
  }
  return String(
    (body as { ticket?: { revision?: string } }).ticket?.revision,
  );
}

function value(result: Result<{ token: string }>): string {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value.token;
}

Deno.test("coding-agent/tickets#R11 #R12: a real connection claims, renews, and releases through core", async () => {
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
      new URL("./ticket-claim-ports_test.ts", import.meta.url).href,
    ],
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
    const appId = (app.body as { id?: string }).id;
    assert(typeof appId === "string");
    const connection = await post(
      core.port,
      "/v1/coding_agent_connections/create",
      user,
      {
        id: CAC,
        label: "claude",
        scope: { kind: "all", app: null },
        token_digest: DIGEST,
      },
    );
    assertEquals(connection.status, 200, JSON.stringify(connection.body));
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
      preserve: ["docs/leaf.md"],
      problems: [],
      readiness: "needs_confirmation",
      needs: ["confirm the redaction"],
    });
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const ticket = created.body.ticket!;
    const revision = created.body.revision!;
    const ready = await post(core.port, "/v1/tickets/make_ready", user, {
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
      ],
      inspect: ["src/leaf.ts"],
      preserve: ["docs/leaf.md"],
    }, { base_revision: revision });
    assertEquals(ready.status, 200, JSON.stringify(ready.body));
    const claimed = await post(core.port, "/v1/tickets/claim", agent, {
      ticket,
      base_revision: ready.body.revision,
    }, { base_revision: ready.body.revision });
    assertEquals(claimed.status, 200, JSON.stringify(claimed.body));
    assertEquals(
      Date.parse(String(claimed.body.expires_at)),
      START + DURATION,
    );
    const current = await revisionOf(core.port, agent, ticket);
    const renewed = await post(core.port, "/v1/tickets/renew_claim", agent, {
      ticket,
      claim_seq: claimed.body.claim_seq,
      base_revision: current,
    }, { base_revision: current });
    assertEquals(renewed.status, 200, JSON.stringify(renewed.body));
    assertEquals(renewed.body.claim_seq, claimed.body.claim_seq);
    const releasedFrom = await revisionOf(core.port, agent, ticket);
    const released = await post(core.port, "/v1/tickets/release_claim", agent, {
      ticket,
      claim_seq: claimed.body.claim_seq,
      base_revision: releasedFrom,
    }, { base_revision: releasedFrom });
    assertEquals(released.status, 200, JSON.stringify(released.body));
    assertEquals(released.body.state, "open");
  } finally {
    await core.close();
  }
});

Deno.test("coding-agent/tickets#R13: startup records the machine credential that expires a claim", async () => {
  const harness = await createCoreHarness({
    nowMs: START,
    teams: [{ ticketDefinitions }],
    teamModules: [new URL("./tickets.ts", import.meta.url).href],
  });
  assert(harness.ok, harness.ok ? undefined : JSON.stringify(harness.error));
  const core = harness.value;
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(`${core.dataRoot}/lophn.db`, {
      readOnly: true,
    });
    const row = db.prepare(
      "SELECT context, state FROM credentials WHERE credential_ref = ?",
    ).get("machine:ticket-claims") as
      | { context: string; state: string }
      | undefined;
    db.close();
    assert(row, "sweep credential was not recorded");
    assertEquals(row.state, "active");
    const stored = JSON.parse(row.context) as { principal: string };
    assertEquals(stored.principal, "machine:ticket-claims");
  } finally {
    await core.close();
  }
});

Deno.test("coding-agent/tickets#R13: the sweep removes a claim once its time has passed", async () => {
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
      new URL("./ticket-claim-ports_test.ts", import.meta.url).href,
    ],
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
        scope: { operations: ["ClaimTicket"], targets: {} },
        conditions: {},
      }),
    );
    const app = await post(core.port, "/v1/apps/create", user, {
      slug: "notes",
      name: "Notes",
      description: "notes app",
    });
    assertEquals(app.status, 200, JSON.stringify(app.body));
    const connection = await post(
      core.port,
      "/v1/coding_agent_connections/create",
      user,
      {
        id: CAC,
        label: "claude",
        scope: { kind: "all", app: null },
        token_digest: DIGEST,
      },
    );
    assertEquals(connection.status, 200, JSON.stringify(connection.body));
    const created = await post(core.port, "/v1/tickets/create", user, {
      app: (app.body as { id?: string }).id,
      kind: "implementation",
      title: "fix leaf redaction",
      what: "redact leaf before snapshot",
      why: "snapshot shows the raw leaf",
      references: [],
      adoption_questions: [],
      conditions: [],
      inspect: ["src/leaf.ts"],
      preserve: ["docs/leaf.md"],
      problems: [],
      readiness: "needs_confirmation",
      needs: ["confirm the redaction"],
    });
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const ticket = created.body.ticket!;
    const ready = await post(core.port, "/v1/tickets/make_ready", user, {
      ticket,
      base_revision: created.body.revision,
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
      preserve: ["docs/leaf.md"],
    }, { base_revision: created.body.revision });
    assertEquals(ready.status, 200, JSON.stringify(ready.body));
    const claimed = await post(core.port, "/v1/tickets/claim", agent, {
      ticket,
      base_revision: ready.body.revision,
    }, { base_revision: ready.body.revision });
    assertEquals(claimed.status, 200, JSON.stringify(claimed.body));
    // 경계는 만료다. 60초 timer를 기다리지 않고 시계를 기한까지 민 뒤 한 번 정리한다.
    core.clock.advance(DURATION);
    await core.sweepTicketClaims();
    const { DatabaseSync } = await import("node:sqlite");
    const db = new DatabaseSync(`${core.dataRoot}/lophn.db`, {
      readOnly: true,
    });
    const row = db.prepare("SELECT state FROM tickets WHERE id = ?").get(
      ticket,
    ) as { state: string } | undefined;
    const claim = db.prepare(
      "SELECT ticket FROM ticket_claims WHERE ticket = ?",
    ).get(ticket);
    db.close();
    assertEquals(row?.state, "open");
    assertEquals(claim, undefined);
  } finally {
    await core.close();
  }
});
