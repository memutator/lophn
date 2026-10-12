import { assert, assertThrows } from "@std/assert";
import { APP, CAC, connectionLedger, DIGEST } from "./sqlite.ts";

Deno.test("coding-agent/connection#R2: the table rejects a mismatched scope pair, principal, and delete", () => {
  const ledger = connectionLedger();
  try {
    assertThrows(() =>
      ledger.sql.run(
        `INSERT INTO coding_agent_connections
          (id, label, scope_kind, scope_app, principal, token_hash, state, revision)
         VALUES (?, 'claude', 'all', ?, ?, ?, 'active', '1')`,
        [CAC, APP, `coding_agent:${CAC}`, DIGEST],
      )
    );
    assertThrows(() =>
      ledger.sql.run(
        `INSERT INTO coding_agent_connections
          (id, label, scope_kind, scope_app, principal, token_hash, state, revision)
         VALUES (?, 'claude', 'app', NULL, ?, ?, 'active', '1')`,
        [CAC, `coding_agent:${CAC}`, DIGEST],
      )
    );
    assertThrows(() =>
      ledger.sql.run(
        `INSERT INTO coding_agent_connections
          (id, label, scope_kind, scope_app, principal, token_hash, state, revision)
         VALUES (?, 'claude', 'all', NULL, 'coding_agent:other', ?, 'active', '1')`,
        [CAC, DIGEST],
      )
    );
    ledger.sql.run(
      `INSERT INTO coding_agent_connections
        (id, label, scope_kind, scope_app, principal, token_hash, state, revision)
       VALUES (?, 'claude', 'all', NULL, ?, ?, 'active', '1')`,
      [CAC, `coding_agent:${CAC}`, DIGEST],
    );
    assertThrows(() =>
      ledger.sql.run(
        "UPDATE coding_agent_connections SET scope_kind = 'app', scope_app = ? WHERE id = ?",
        [APP, CAC],
      )
    );
    ledger.sql.run(
      "UPDATE coding_agent_connections SET state = 'revoked', revision = '2' WHERE id = ?",
      [CAC],
    );
    assertThrows(() =>
      ledger.sql.run(
        "UPDATE coding_agent_connections SET state = 'active', revision = '3' WHERE id = ?",
        [CAC],
      )
    );
    assertThrows(() =>
      ledger.sql.run("DELETE FROM coding_agent_connections WHERE id = ?", [CAC])
    );
    const row = ledger.sql.get(
      "SELECT state FROM coding_agent_connections WHERE id = ?",
      [CAC],
    );
    assert(row?.state === "revoked");
  } finally {
    ledger.close();
  }
});
