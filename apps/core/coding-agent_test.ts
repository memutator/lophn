import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import {
  type CommandEnvelope,
  createLedgerHarness,
  type LedgerHarness,
} from "./testing/ledger.ts";

const registration = new URL("./coding-agent.ts", import.meta.url);
const APP = "app_01arz3ndektsv4rrffq69g5fav";
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const DIGEST = "a".repeat(64);
const CONFIRMATION = "A".repeat(43);

function user(operations: string[], ref = "cred-user"): AuthenticatedContext {
  return {
    principal: "user-1",
    actor: "user",
    scope: { operations, targets: {} },
    conditions: {},
    credential_ref: ref,
  };
}

const creator = user([
  "CreateCodingAgentConnection",
  "coding_agent_connections.set_apps",
]);
const revoker = user([
  "RevokeCodingAgentConnection",
  "coding_agent_connections.revoke_with_evidence",
  "coding_agent_connections.read_auth",
], "cred-revoke");
const reader = user([
  "ListCodingAgentConnections",
  "ShowCodingAgentConnection",
], "cred-read");
const agent: AuthenticatedContext = {
  principal: `coding_agent:${CAC}`,
  actor: `coding_agent:${CAC}`,
  scope: {
    operations: ["CreateCodingAgentConnection"],
    targets: {},
  },
  conditions: {},
  credential_ref: "cred-agent",
};

function envelope(
  command: string,
  key: string,
  input: unknown,
  compare: unknown = {},
): CommandEnvelope {
  return { command, input, compare, idempotency_key: key, prepared: [] };
}

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function code(result: Result<unknown>, expected: string) {
  assert(!result.ok, "expected failure");
  assertEquals(result.error.code, expected);
}

async function open(): Promise<LedgerHarness> {
  return value(
    await createLedgerHarness({
      registrationModules: [registration],
      credentials: [creator, revoker, reader, agent],
    }),
  );
}

Deno.test("coding-agent/connection#R2 #R3: user create is listed and shown without a token or digest", async () => {
  const harness = await open();
  try {
    const created = value(
      await harness.command(
        creator,
        envelope("CreateCodingAgentConnection", "create-1", {
          id: CAC,
          label: "claude",
          scope: { kind: "all", app: null },
          token_digest: DIGEST,
        }),
      ),
    );
    const connection = (created.result as { connection: { state: string } })
      .connection;
    assertEquals(connection.state, "active");
    assertEquals(JSON.stringify(created.result).includes(DIGEST), false);
    assertEquals(JSON.stringify(created.result).includes("token"), false);
    const listed = value(
      await harness.read(
        { resource: "coding_agent_connections", method: "list" },
        reader,
        {},
      ),
    ) as { connections: { id: string }[] };
    assertEquals(listed.connections.map((item) => item.id), [CAC]);
    assertEquals(JSON.stringify(listed).includes(DIGEST), false);
    const shown = value(
      await harness.read(
        { resource: "coding_agent_connections", method: "show" },
        reader,
        { connection: CAC },
      ),
    );
    assertEquals(JSON.stringify(shown).includes(DIGEST), false);
  } finally {
    await harness.close();
  }
});

Deno.test("coding-agent/connection#R2: a coding_agent actor cannot create a connection", async () => {
  const harness = await open();
  try {
    code(
      await harness.command(
        agent,
        envelope("CreateCodingAgentConnection", "create-agent", {
          id: CAC,
          label: "claude",
          scope: { kind: "all", app: null },
          token_digest: DIGEST,
        }),
      ),
      "forbidden",
    );
  } finally {
    await harness.close();
  }
});

Deno.test("coding-agent/connection#R2 #R8: revoke with confirmation evidence makes the auth port report revoked, and a stale revision conflicts", async () => {
  const harness = await open();
  try {
    const created = value(
      await harness.command(
        creator,
        envelope("CreateCodingAgentConnection", "create-2", {
          id: CAC,
          label: "claude",
          scope: { kind: "all", app: null },
          token_digest: DIGEST,
        }),
      ),
    );
    const revision = (created.result as { connection: { revision: string } })
      .connection.revision;
    code(
      await harness.command(
        revoker,
        envelope("coding_agent_connections.revoke_with_evidence", "stale", {
          connection: CAC,
          base_revision: "9",
          confirmation: CONFIRMATION,
        }, { base_revision: "9" }),
      ),
      "conflict",
    );
    value(
      await harness.command(
        revoker,
        envelope("coding_agent_connections.revoke_with_evidence", "revoke-1", {
          connection: CAC,
          base_revision: revision,
          confirmation: CONFIRMATION,
        }, { base_revision: revision }),
      ),
    );
    const auth = value(
      await harness.command(
        revoker,
        envelope("coding_agent_connections.read_auth", "auth-1", {
          principal: `coding_agent:${CAC}`,
        }),
      ),
    ).result as { found: boolean; state: string; token_digest: string };
    assertEquals(auth, { found: true, state: "revoked", token_digest: DIGEST });
    const direct = await harness.command(
      revoker,
      envelope("RevokeCodingAgentConnection", "direct", {
        connection: CAC,
        base_revision: revision,
      }, { base_revision: revision }),
    );
    code(direct, "unavailable");
  } finally {
    await harness.close();
  }
});

Deno.test("coding-agent/connection#R2: app scope create rejects an unknown app", async () => {
  const harness = await open();
  try {
    code(
      await harness.command(
        creator,
        envelope("CreateCodingAgentConnection", "missing-app", {
          id: CAC,
          label: "claude",
          scope: { kind: "app", app: APP },
          token_digest: DIGEST,
        }),
      ),
      "invalid_input",
    );
    value(
      await harness.command(
        creator,
        envelope("coding_agent_connections.set_apps", "apps", {
          apps: [{ id: APP, status: "active" }],
        }),
      ),
    );
    const created = value(
      await harness.command(
        creator,
        envelope("CreateCodingAgentConnection", "with-app", {
          id: CAC,
          label: "claude",
          scope: { kind: "app", app: APP },
          token_digest: DIGEST,
        }),
      ),
    );
    assertEquals(
      (created.result as { connection: { scope: { kind: string } } }).connection
        .scope.kind,
      "app",
    );
  } finally {
    await harness.close();
  }
});
