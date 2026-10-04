import { assert, assertEquals } from "@std/assert";
import { connectionCreateInputSchema } from "../../contracts/coding-agent/mod.ts";
import { createConnectionCommands, revokeConnection } from "./commands.ts";
import { lookupConnectionAuth } from "./auth.ts";
import { createConnectionReads } from "./reads.ts";
import {
  APP,
  CAC,
  CAC_B,
  CONFIRMATION,
  connectionLedger,
  DIGEST,
  DIGEST_B,
  userContext,
} from "./sqlite.ts";

const commands = createConnectionCommands();
const reads = createConnectionReads();

function code(
  result: { ok: boolean; error?: { code: string } },
  expected: string,
) {
  assert(!result.ok);
  assertEquals(result.error?.code, expected);
}

function createInput(patch: Record<string, unknown> = {}) {
  return {
    id: CAC,
    label: "claude",
    scope: { kind: "all" as const, app: null },
    token_digest: DIGEST,
    ...patch,
  };
}

Deno.test("coding-agent/connection#R2 #R3: create accepts only a user, a prepared digest, and no confirmation", () => {
  const ledger = connectionLedger();
  try {
    const created = ledger.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        createInput(),
        {},
      )
    );
    assert(created.ok);
    if (!created.ok) return;
    assertEquals(created.value.connection.state, "active");
    assertEquals(created.value.connection.principal, `coding_agent:${CAC}`);
    assertEquals("token_digest" in created.value.connection, false);
    assertEquals("token_hash" in created.value.connection, false);
    assertEquals(ledger.events[0]?.payload, {
      label: "claude",
      scope: { kind: "all", app: null },
      principal: `coding_agent:${CAC}`,
    });
    const shown = reads.show.handle(
      ledger.snapshot("1"),
      userContext(),
      { connection: CAC },
    );
    assert(shown.ok);
    if (shown.ok) {
      assertEquals("token_digest" in shown.value.connection, false);
      assertEquals(JSON.stringify(shown.value).includes(DIGEST), false);
    }
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/connection#R2 #R3: create rejects a missing app, a blank label, and a coding_agent actor", () => {
  const missing = connectionLedger([]);
  try {
    code(
      missing.transaction((tx) =>
        commands.create.handle(
          tx,
          userContext(),
          createInput({
            scope: { kind: "app", app: APP },
          }),
          {},
        )
      ),
      "invalid_input",
    );
  } finally {
    missing.close();
  }

  assert(
    !connectionCreateInputSchema.safeParse(createInput({ label: "   " }))
      .success,
  );
  assert(
    !connectionCreateInputSchema.safeParse(createInput({ label: "" }))
      .success,
  );
  const shape = connectionCreateInputSchema.shape;
  assertEquals("token" in shape, false);
  assertEquals("token_digest" in shape, true);

  const ledger = connectionLedger();
  try {
    code(
      ledger.transaction((tx) =>
        commands.create.handle(
          tx,
          userContext(`coding_agent:${CAC}`, `coding_agent:${CAC}`),
          createInput(),
          {},
        )
      ),
      "forbidden",
    );
    assertEquals(
      ledger.sql.get("SELECT count(*) AS n FROM coding_agent_connections", []),
      { n: 0n },
    );
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/connection#R2 #R8: revoke needs a user, confirmation evidence, and base_revision, then auth reads revoked", () => {
  const ledger = connectionLedger();
  try {
    const created = ledger.transaction((tx) =>
      commands.create.handle(tx, userContext(), createInput(), {})
    );
    assert(created.ok);
    if (!created.ok) return;
    const revision = created.value.connection.revision;
    code(
      ledger.transaction((tx) =>
        revokeConnection(
          tx,
          userContext(`coding_agent:${CAC}`, `coding_agent:${CAC}`),
          { connection: CAC, base_revision: revision },
          { base_revision: revision },
          CONFIRMATION,
        )
      ),
      "forbidden",
    );
    code(
      ledger.transaction((tx) =>
        revokeConnection(
          tx,
          userContext(),
          { connection: CAC, base_revision: revision },
          { base_revision: revision },
          undefined,
        )
      ),
      "forbidden",
    );
    code(
      ledger.transaction((tx) =>
        revokeConnection(
          tx,
          userContext(),
          { connection: CAC, base_revision: "9" },
          { base_revision: "9" },
          CONFIRMATION,
        )
      ),
      "conflict",
    );
    const revoked = ledger.transaction((tx) =>
      revokeConnection(
        tx,
        userContext(),
        { connection: CAC, base_revision: revision },
        { base_revision: revision },
        CONFIRMATION,
      )
    );
    assert(revoked.ok);
    if (!revoked.ok) return;
    assertEquals(revoked.value.connection.state, "revoked");
    const auth = lookupConnectionAuth(ledger.sql, `coding_agent:${CAC}`);
    assertEquals(auth?.state, "revoked");
    assertEquals(auth?.token_digest, DIGEST);
    assertEquals(auth?.connection, CAC);
    const again = ledger.transaction((tx) =>
      revokeConnection(
        tx,
        userContext(),
        { connection: CAC, base_revision: revoked.value.connection.revision },
        { base_revision: revoked.value.connection.revision },
        CONFIRMATION,
      )
    );
    code(again, "conflict");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/connection#R3: the same label is two principals, and label or folder does not widen scope", () => {
  const ledger = connectionLedger();
  try {
    const first = ledger.transaction((tx) =>
      commands.create.handle(tx, userContext(), createInput(), {})
    );
    const second = ledger.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        createInput({
          id: CAC_B,
          label: "claude",
          token_digest: DIGEST_B,
          scope: { kind: "app", app: APP },
        }),
        {},
      )
    );
    assert(first.ok && second.ok);
    if (!first.ok || !second.ok) return;
    assert(
      first.value.connection.principal !== second.value.connection.principal,
    );
    assertEquals(first.value.connection.scope, { kind: "all", app: null });
    assertEquals(second.value.connection.scope, { kind: "app", app: APP });
    const self = reads.show.handle(
      ledger.snapshot("2"),
      userContext(`coding_agent:${CAC_B}`, `coding_agent:${CAC_B}`),
      { connection: CAC },
    );
    code(self, "not_found");
    const own = reads.show.handle(
      ledger.snapshot("2"),
      userContext(`coding_agent:${CAC_B}`, `coding_agent:${CAC_B}`),
      { connection: CAC_B },
    );
    assert(own.ok);
    if (own.ok) {
      assertEquals(own.value.connection.scope.kind, "app");
    }
  } finally {
    ledger.close();
  }
});
