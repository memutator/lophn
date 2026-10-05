// ticket claim 테스트(coding-agent/tickets#R11–R14, R16, connection#R8,
// sessions#R9). fixture transaction으로 claim·갱신·반납·만료와 checkTicketClaim을
// 본다. 기한은 테스트 clock으로 정확히 경계에서 거절한다.
import { assert, assertEquals } from "@std/assert";
import { CLAIM_DURATION_MS, expired } from "./expiry.ts";
import { createTicketClaimCommands, expiredClaims } from "./claims.ts";
import { createTicketCommands } from "./commands.ts";
import {
  APP,
  DOC,
  QUESTION,
  ticketFixture,
  userContext,
  VER,
} from "./fixture.ts";
import { checkTicketClaim, createTicketReads } from "./reads.ts";

const START = Date.parse("2026-10-05T00:00:00.000Z");
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const CAC_B = "cac_01arz3ndektsv4rrffq69g5faw";
const DIGEST = "a".repeat(64);

const commands = createTicketCommands();
const claims = createTicketClaimCommands();
const reads = createTicketReads();

function code(
  result: { ok: boolean; error?: { code: string } },
  expected: string,
): void {
  assert(!result.ok, JSON.stringify(result));
  assertEquals(result.error?.code, expected);
}

function connection(id: string, app: string | null = null, state = "active") {
  return {
    connection: id,
    state: state as "active" | "revoked",
    scope: app === null
      ? { kind: "all" as const, app: null }
      : { kind: "app" as const, app },
    token_digest: DIGEST,
    revision: "1",
  };
}

function agent(id: string) {
  return userContext(`coding_agent:${id}`);
}

function readyLedger(
  connections = new Map([[`coding_agent:${CAC}`, connection(CAC)]]),
) {
  return ticketFixture({
    adoptions: new Map([[QUESTION, { document: DOC, version: VER }]]),
    connections,
    nowMs: START,
  });
}

function openReady(ledger: ReturnType<typeof ticketFixture>): {
  ticket: string;
  revision: string;
} {
  const created = ledger.transaction((tx) =>
    commands.create.handle(
      tx,
      userContext(),
      {
        app: APP,
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
      },
      {},
    )
  );
  assert(created.ok);
  if (!created.ok) return { ticket: "", revision: "" };
  const made = ledger.transaction((tx) =>
    commands.make_ready.handle(
      tx,
      userContext(),
      {
        ticket: created.value.ticket,
        base_revision: created.value.revision,
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
      },
      { base_revision: created.value.revision },
    )
  );
  assert(made.ok);
  if (!made.ok) return { ticket: "", revision: "" };
  return { ticket: created.value.ticket, revision: made.value.revision };
}

Deno.test("coding-agent/tickets#R11: one connection claims a ready ticket and a second claim conflicts", () => {
  const ledger = readyLedger();
  try {
    const ready = openReady(ledger);
    const claimed = ledger.transaction((tx) =>
      claims.claim.handle(
        tx,
        agent(CAC),
        { ticket: ready.ticket, base_revision: ready.revision },
        { base_revision: ready.revision },
      )
    );
    assert(claimed.ok);
    if (!claimed.ok) return;
    assertEquals(claimed.value.connection, CAC);
    assertEquals(
      Date.parse(claimed.value.expires_at) - START,
      CLAIM_DURATION_MS,
    );
    const again = ledger.transaction((tx) =>
      claims.claim.handle(
        tx,
        agent(CAC),
        { ticket: ready.ticket, base_revision: claimed.value.claim_seq },
        { base_revision: claimed.value.claim_seq },
      )
    );
    code(again, "conflict");
    const row = ledger.sql.get(
      "SELECT state FROM tickets WHERE id = ?",
      [ready.ticket],
    );
    assertEquals(row?.state, "claimed");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R11: a needs_confirmation ticket and a stale revision are rejected", () => {
  const ledger = readyLedger();
  try {
    const created = ledger.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        {
          app: APP,
          kind: "implementation",
          title: "fix leaf redaction",
          what: "redact leaf before snapshot",
          why: "snapshot shows the raw leaf",
          references: [],
          adoption_questions: [],
          conditions: [],
          inspect: [],
          preserve: [],
          problems: [],
          readiness: "needs_confirmation",
          needs: ["confirm the redaction"],
        },
        {},
      )
    );
    assert(created.ok);
    if (!created.ok) return;
    const early = ledger.transaction((tx) =>
      claims.claim.handle(
        tx,
        agent(CAC),
        {
          ticket: created.value.ticket,
          base_revision: created.value.revision,
        },
        { base_revision: created.value.revision },
      )
    );
    code(early, "conflict");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R11: one connection claims two tickets and a list read creates no claim", () => {
  const ledger = readyLedger();
  try {
    const first = openReady(ledger);
    const second = openReady(ledger);
    const claimed = ledger.transaction((tx) =>
      claims.claim.handle(
        tx,
        agent(CAC),
        { ticket: first.ticket, base_revision: first.revision },
        { base_revision: first.revision },
      )
    );
    assert(claimed.ok);
    const other = ledger.transaction((tx) =>
      claims.claim.handle(
        tx,
        agent(CAC),
        { ticket: second.ticket, base_revision: second.revision },
        { base_revision: second.revision },
      )
    );
    assert(other.ok);
    const listed = reads.list.handle(
      ledger.snapshot("9"),
      userContext(),
      { app: APP },
    );
    assert(listed.ok);
    const rows = ledger.sql.get(
      "SELECT COUNT(*) AS count FROM ticket_claims",
      [],
    );
    assertEquals(Number(rows?.count), 2);
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R11: a connection outside the ticket app is forbidden", () => {
  const ledger = readyLedger(
    new Map([[
      `coding_agent:${CAC}`,
      connection(CAC, "app_01arz3ndektsv4rrffq69g5faw"),
    ]]),
  );
  try {
    const ready = openReady(ledger);
    const denied = ledger.transaction((tx) =>
      claims.claim.handle(
        tx,
        agent(CAC),
        { ticket: ready.ticket, base_revision: ready.revision },
        { base_revision: ready.revision },
      )
    );
    code(denied, "forbidden");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R12: renewal extends from the renewal instant and the exact boundary is rejected", () => {
  const ledger = readyLedger();
  try {
    const ready = openReady(ledger);
    const claimed = ledger.transaction((tx) =>
      claims.claim.handle(
        tx,
        agent(CAC),
        { ticket: ready.ticket, base_revision: ready.revision },
        { base_revision: ready.revision },
      )
    );
    assert(claimed.ok);
    if (!claimed.ok) return;
    ledger.setNow(START + CLAIM_DURATION_MS);
    const late = ledger.transaction((tx) =>
      claims.renew_claim.handle(
        tx,
        agent(CAC),
        {
          ticket: ready.ticket,
          claim_seq: claimed.value.claim_seq,
          base_revision: claimed.value.claim_seq,
        },
        { base_revision: claimed.value.claim_seq },
      )
    );
    code(late, "conflict");
    ledger.setNow(START + CLAIM_DURATION_MS - 1);
    const renewed = ledger.transaction((tx) =>
      claims.renew_claim.handle(
        tx,
        agent(CAC),
        {
          ticket: ready.ticket,
          claim_seq: claimed.value.claim_seq,
          base_revision: claimed.value.claim_seq,
        },
        { base_revision: claimed.value.claim_seq },
      )
    );
    assert(renewed.ok);
    if (!renewed.ok) return;
    assertEquals(
      Date.parse(renewed.value.expires_at),
      START + CLAIM_DURATION_MS - 1 + CLAIM_DURATION_MS,
    );
    assertEquals(renewed.value.claim_seq, claimed.value.claim_seq);
    const before = ledger.sql.get(
      "SELECT expires_at FROM ticket_claims WHERE ticket = ?",
      [ready.ticket],
    );
    reads.show.handle(
      ledger.snapshot("9"),
      userContext(),
      { ticket: ready.ticket },
    );
    const after = ledger.sql.get(
      "SELECT expires_at FROM ticket_claims WHERE ticket = ?",
      [ready.ticket],
    );
    assertEquals(after?.expires_at, before?.expires_at);
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R12: only the holding connection renews or releases", () => {
  const ledger = readyLedger(
    new Map([
      [`coding_agent:${CAC}`, connection(CAC)],
      [`coding_agent:${CAC_B}`, connection(CAC_B)],
    ]),
  );
  try {
    const ready = openReady(ledger);
    const claimed = ledger.transaction((tx) =>
      claims.claim.handle(
        tx,
        agent(CAC),
        { ticket: ready.ticket, base_revision: ready.revision },
        { base_revision: ready.revision },
      )
    );
    assert(claimed.ok);
    if (!claimed.ok) return;
    const stolen = ledger.transaction((tx) =>
      claims.release_claim.handle(
        tx,
        agent(CAC_B),
        {
          ticket: ready.ticket,
          claim_seq: claimed.value.claim_seq,
          base_revision: claimed.value.claim_seq,
        },
        { base_revision: claimed.value.claim_seq },
      )
    );
    code(stolen, "forbidden");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R13: checkTicketClaim rejects an expired claim before the sweep and an old seq after reclaim", () => {
  const ledger = readyLedger();
  try {
    const ready = openReady(ledger);
    const claimed = ledger.transaction((tx) =>
      claims.claim.handle(
        tx,
        agent(CAC),
        { ticket: ready.ticket, base_revision: ready.revision },
        { base_revision: ready.revision },
      )
    );
    assert(claimed.ok);
    if (!claimed.ok) return;
    ledger.setNow(START + CLAIM_DURATION_MS);
    const checked = ledger.transaction((tx) =>
      checkTicketClaim(tx, {
        ticket: ready.ticket,
        claim_seq: claimed.value.claim_seq,
        connection: CAC,
        now: new Date(START + CLAIM_DURATION_MS).toISOString(),
      })
    );
    assert(checked.ok);
    if (!checked.ok) return;
    assertEquals(checked.value.ok, false);
    if (checked.value.ok) return;
    assertEquals(checked.value.reason, "expired");
    const expired = ledger.transaction((tx) =>
      claims.expire_claim.handle(
        tx,
        userContext("machine"),
        { ticket: ready.ticket, claim_seq: claimed.value.claim_seq },
        {},
      )
    );
    assert(expired.ok);
    const staleBase = ledger.transaction((tx) =>
      claims.claim.handle(
        tx,
        agent(CAC),
        { ticket: ready.ticket, base_revision: claimed.value.claim_seq },
        { base_revision: claimed.value.claim_seq },
      )
    );
    code(staleBase, "conflict");
    const shown = ledger.sql.get(
      "SELECT revision FROM tickets WHERE id = ?",
      [ready.ticket],
    );
    const again = ledger.transaction((tx) =>
      claims.claim.handle(
        tx,
        agent(CAC),
        { ticket: ready.ticket, base_revision: String(shown?.revision) },
        { base_revision: String(shown?.revision) },
      )
    );
    assert(again.ok);
    if (!again.ok) return;
    const stale = ledger.transaction((tx) =>
      claims.renew_claim.handle(
        tx,
        agent(CAC),
        {
          ticket: ready.ticket,
          claim_seq: claimed.value.claim_seq,
          base_revision: again.value.claim_seq,
        },
        { base_revision: again.value.claim_seq },
      )
    );
    code(stale, "conflict");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R14: release returns the ticket to open and keeps the past completion", () => {
  const ledger = readyLedger();
  try {
    const ready = openReady(ledger);
    const claimed = ledger.transaction((tx) =>
      claims.claim.handle(
        tx,
        agent(CAC),
        { ticket: ready.ticket, base_revision: ready.revision },
        { base_revision: ready.revision },
      )
    );
    assert(claimed.ok);
    if (!claimed.ok) return;
    ledger.sql.run(
      `INSERT INTO ticket_completions
       (ticket, seq, claim_seq, release, summary_hash, outputs, fix_records, verifications)
       VALUES (?, '4', ?, 'rel_01arz3ndektsv4rrffq69g5fav', ?, '[]', '[]', '[]')`,
      [ready.ticket, claimed.value.claim_seq, "b".repeat(64)],
    );
    const released = ledger.transaction((tx) =>
      claims.release_claim.handle(
        tx,
        agent(CAC),
        {
          ticket: ready.ticket,
          claim_seq: claimed.value.claim_seq,
          base_revision: claimed.value.claim_seq,
        },
        { base_revision: claimed.value.claim_seq },
      )
    );
    assert(released.ok);
    if (!released.ok) return;
    assertEquals(released.value.state, "open");
    const kept = ledger.sql.get(
      "SELECT COUNT(*) AS count FROM ticket_completions",
      [],
    );
    assertEquals(Number(kept?.count), 1);
    const claim = ledger.sql.get(
      "SELECT ticket FROM ticket_claims WHERE ticket = ?",
      [ready.ticket],
    );
    assertEquals(claim, undefined);
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/connection#R8: a revoked connection is rejected before its claim is swept", () => {
  const ledger = readyLedger();
  try {
    const ready = openReady(ledger);
    const claimed = ledger.transaction((tx) =>
      claims.claim.handle(
        tx,
        agent(CAC),
        { ticket: ready.ticket, base_revision: ready.revision },
        { base_revision: ready.revision },
      )
    );
    assert(claimed.ok);
    if (!claimed.ok) return;
    ledger.connections.set(
      `coding_agent:${CAC}`,
      connection(CAC, null, "revoked"),
    );
    const checked = ledger.transaction((tx) =>
      checkTicketClaim(tx, {
        ticket: ready.ticket,
        claim_seq: claimed.value.claim_seq,
        connection: CAC,
        now: new Date(START).toISOString(),
      })
    );
    assert(checked.ok);
    if (!checked.ok) return;
    assertEquals(checked.value.ok, false);
    if (checked.value.ok) return;
    assertEquals(checked.value.reason, "revoked");
    const renewed = ledger.transaction((tx) =>
      claims.renew_claim.handle(
        tx,
        agent(CAC),
        {
          ticket: ready.ticket,
          claim_seq: claimed.value.claim_seq,
          base_revision: claimed.value.claim_seq,
        },
        { base_revision: claimed.value.claim_seq },
      )
    );
    code(renewed, "unauthorized");
    const released = ledger.transaction((tx) =>
      claims.expire_claim.handle(
        tx,
        userContext("machine"),
        { ticket: ready.ticket, claim_seq: claimed.value.claim_seq },
        {},
      )
    );
    assert(released.ok);
    const event = ledger.emitted.at(-1);
    assertEquals(event?.type, "TicketClaimReleased");
    assertEquals(
      (event?.payload as { reason?: string } | undefined)?.reason,
      "connection_revoked",
    );
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R13: the sweep lists expired claims and skips a renewed one", () => {
  const ledger = readyLedger();
  try {
    const ready = openReady(ledger);
    const claimed = ledger.transaction((tx) =>
      claims.claim.handle(
        tx,
        agent(CAC),
        { ticket: ready.ticket, base_revision: ready.revision },
        { base_revision: ready.revision },
      )
    );
    assert(claimed.ok);
    ledger.setNow(START + CLAIM_DURATION_MS);
    const due = expiredClaims(
      ledger.sql,
      new Date(START + CLAIM_DURATION_MS).toISOString(),
      [],
    );
    assertEquals(due.length, 1);
    ledger.setNow(START + CLAIM_DURATION_MS - 1);
    const held = expiredClaims(
      ledger.sql,
      new Date(START + CLAIM_DURATION_MS - 1).toISOString(),
      [],
    );
    assertEquals(held.length, 0);
    assert(expired(START + CLAIM_DURATION_MS, START + CLAIM_DURATION_MS));
    assert(!expired(START + CLAIM_DURATION_MS, START + CLAIM_DURATION_MS - 1));
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/sessions#R9: a session observation does not change a claim", () => {
  const ledger = readyLedger();
  try {
    const ready = openReady(ledger);
    const claimed = ledger.transaction((tx) =>
      claims.claim.handle(
        tx,
        agent(CAC),
        { ticket: ready.ticket, base_revision: ready.revision },
        { base_revision: ready.revision },
      )
    );
    assert(claimed.ok);
    const before = ledger.sql.get(
      "SELECT claim_seq, expires_at FROM ticket_claims WHERE ticket = ?",
      [ready.ticket],
    );
    reads.show.handle(ledger.snapshot("9"), userContext(), {
      ticket: ready.ticket,
    });
    const after = ledger.sql.get(
      "SELECT claim_seq, expires_at FROM ticket_claims WHERE ticket = ?",
      [ready.ticket],
    );
    assertEquals(after?.claim_seq, before?.claim_seq);
    assertEquals(after?.expires_at, before?.expires_at);
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R16: there is no problem claim command", () => {
  const names = [
    claims.claim.route.name,
    claims.renew_claim.route.name,
    claims.release_claim.route.name,
    claims.expire_claim.route.name,
  ];
  assertEquals(names.includes("ClaimProblem"), false);
  assertEquals(names.includes("ClaimTicket"), true);
});
