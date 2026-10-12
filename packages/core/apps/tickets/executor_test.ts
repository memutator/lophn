// ticket claim·완료 보고·취소의 실제 executor 경로(coding-agent/tickets#R11–R14,
// R15, R17, R22). 임시 파일 SQLite/WAL, writer Worker, executor를 그대로 쓴다.
import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../base/mod.ts";
import type {
  AuthenticatedContext,
  SqlRow,
} from "../../../protocol/server/mod.ts";
type CommandEnvelope = {
  command: string;
  input: unknown;
  idempotency_key: string;
  compare: unknown;
  prepared: readonly string[];
};
type CommandSuccess = { result: unknown; replayed: boolean };
type LedgerHarness = {
  command(
    ctx: AuthenticatedContext,
    envelope: CommandEnvelope,
  ): Promise<Result<CommandSuccess>>;
  inspect(
    query: string,
    params?: readonly unknown[],
  ): Promise<Result<SqlRow[]>>;
  close(): Promise<void>;
};

async function createLedgerHarness(options: {
  registrationModules: readonly URL[];
  credentials: readonly AuthenticatedContext[];
  nowMs?: number;
}): Promise<Result<LedgerHarness>> {
  const harness = await import("../../../../apps/core/testing/ledger.ts");
  return harness.createLedgerHarness(options);
}

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const CAC_B = "cac_01arz3ndektsv4rrffq69g5faw";
const START = Date.parse("2026-10-05T00:00:00.000Z");
const DURATION = 3_600_000;

const operations = [
  "CreateTicket",
  "MakeTicketReady",
  "ClaimTicket",
  "RenewTicketClaim",
  "ReleaseTicketClaim",
  "ExpireTicketClaim",
  "ReportTicketCompletion",
  "CancelTicket",
  "coding-agent.tickets.seed",
];

function credential(
  actor: string,
  principal: string,
): AuthenticatedContext {
  return {
    actor: actor as AuthenticatedContext["actor"],
    principal,
    credential_ref: `test:${principal}`,
    scope: { operations, targets: {} },
    conditions: {},
  };
}

const user = credential("user", "user-1");
const agent = credential(`coding_agent:${CAC}`, `coding_agent:${CAC}`);
const agentB = credential(`coding_agent:${CAC_B}`, `coding_agent:${CAC_B}`);
const machine = credential("machine", "machine:ticket-claims");

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function code(result: Result<unknown>, expected: string): void {
  assert(!result.ok, JSON.stringify(result));
  assertEquals(result.error.code, expected);
}

function envelope(
  command: string,
  key: string,
  input: unknown,
  compare: unknown = {},
): CommandEnvelope {
  return { command, input, compare, idempotency_key: key, prepared: [] };
}

function claimResult(success: CommandSuccess): {
  claim_seq: string;
  expires_at: string;
} {
  return success.result as { claim_seq: string; expires_at: string };
}

async function harness(): Promise<LedgerHarness> {
  return value(
    await createLedgerHarness({
      registrationModules: [
        new URL("./harness-registration_test.ts", import.meta.url),
      ],
      credentials: [user, agent, agentB, machine],
      nowMs: START,
    }),
  );
}

const VER = "ver_01arz3ndektsv4rrffq69g5fav";
const QUESTION = "qst_01arz3ndektsv4rrffq69g5fav";

// claim 경계만 본다. ready는 실제 MakeTicketReady가 근거·조건과 함께 만든다.
async function readyTicket(ledger: LedgerHarness): Promise<{
  ticket: string;
  revision: string;
}> {
  const created = value(
    await ledger.command(
      user,
      envelope("CreateTicket", `create-${crypto.randomUUID()}`, {
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
      }),
    ),
  );
  const made = created.result as { ticket: string; revision: string };
  const ready = value(
    await ledger.command(
      user,
      envelope("MakeTicketReady", `ready-${made.ticket}`, {
        ticket: made.ticket,
        base_revision: made.revision,
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
      }, { base_revision: made.revision }),
    ),
  );
  return ready.result as { ticket: string; revision: string };
}

Deno.test("coding-agent/tickets#R11: the executor lets only one of two simultaneous claims succeed", async () => {
  const ledger = await harness();
  try {
    const ready = await readyTicket(ledger);
    const [first, second] = await Promise.all([
      ledger.command(
        agent,
        envelope("ClaimTicket", "claim-a", {
          ticket: ready.ticket,
          base_revision: ready.revision,
        }, { base_revision: ready.revision }),
      ),
      ledger.command(
        agentB,
        envelope("ClaimTicket", "claim-b", {
          ticket: ready.ticket,
          base_revision: ready.revision,
        }, { base_revision: ready.revision }),
      ),
    ]);
    const results = [first, second];
    assertEquals(results.filter((result) => result.ok).length, 1);
    assertEquals(results.filter((result) => !result.ok).length, 1);
    const rows = value(
      await ledger.inspect(
        "SELECT connection, claim_seq, expires_at FROM ticket_claims WHERE ticket = ?",
        [ready.ticket],
      ),
    );
    assertEquals(rows.length, 1);
    const held = claimResult(value(results.find((result) => result.ok)!));
    assertEquals(rows[0]?.claim_seq, held.claim_seq);
    assertEquals(
      Date.parse(String(rows[0]?.expires_at)),
      START + DURATION,
    );
    const events = value(
      await ledger.inspect(
        "SELECT seq, type FROM events WHERE type = 'TicketClaimed'",
        [],
      ),
    );
    assertEquals(String(events[0]?.seq), held.claim_seq);
  } finally {
    await ledger.close();
  }
});

Deno.test("coding-agent/tickets#R12: only the holding connection releases through the executor", async () => {
  const ledger = await harness();
  try {
    const ready = await readyTicket(ledger);
    const claimed = value(
      await ledger.command(
        agent,
        envelope("ClaimTicket", "claim", {
          ticket: ready.ticket,
          base_revision: ready.revision,
        }, { base_revision: ready.revision }),
      ),
    );
    const held = claimResult(claimed);
    const stolen = await ledger.command(
      agentB,
      envelope("ReleaseTicketClaim", "release-other", {
        ticket: ready.ticket,
        claim_seq: held.claim_seq,
        base_revision: held.claim_seq,
      }, { base_revision: held.claim_seq }),
    );
    code(stolen, "forbidden");
    const released = value(
      await ledger.command(
        agent,
        envelope("ReleaseTicketClaim", "release", {
          ticket: ready.ticket,
          claim_seq: held.claim_seq,
          base_revision: held.claim_seq,
        }, { base_revision: held.claim_seq }),
      ),
    );
    assertEquals(
      (released.result as { state: string }).state,
      "open",
    );
    const rows = value(
      await ledger.inspect(
        "SELECT ticket FROM ticket_claims WHERE ticket = ?",
        [ready.ticket],
      ),
    );
    assertEquals(rows.length, 0);
  } finally {
    await ledger.close();
  }
});

Deno.test("coding-agent/tickets#R14: the executor does not release a claim when the command is not called", async () => {
  const ledger = await harness();
  try {
    const ready = await readyTicket(ledger);
    value(
      await ledger.command(
        agent,
        envelope("ClaimTicket", "claim", {
          ticket: ready.ticket,
          base_revision: ready.revision,
        }, { base_revision: ready.revision }),
      ),
    );
    const rows = value(
      await ledger.inspect(
        "SELECT claim_seq FROM ticket_claims WHERE ticket = ?",
        [ready.ticket],
      ),
    );
    assertEquals(rows.length, 1);
  } finally {
    await ledger.close();
  }
});

const HASH = "ab".repeat(32);
const SUMMARY_BYTES = 64;

// R15·R17. agent는 같은 claim으로 release 근거와 summary 준비와 함께 보고한다.
// release가 ticket_source로 이 ticket을 역조회하는지 실제 표로 본다.
Deno.test("coding-agent/tickets#R15: the executor reports a completion for the same claim and release", async () => {
  const ledger = await harness();
  try {
    const ready = await readyTicket(ledger);
    const claimed = value(
      await ledger.command(
        agent,
        envelope("ClaimTicket", "claim", {
          ticket: ready.ticket,
          base_revision: ready.revision,
        }, { base_revision: ready.revision }),
      ),
    );
    const hold = claimResult(claimed);
    value(
      await ledger.command(
        machine,
        envelope("coding-agent.tickets.seed", "seed", {
          app: APP,
          release: "rel_01arz3ndektsv4rrffq69g5fav",
          release_app: APP,
          ticket_source: JSON.stringify({
            ticket: ready.ticket,
            claim_seq: hold.claim_seq,
          }),
          versions: [VER],
        }),
      ),
    );
    const blob = {
      preparation: "finish-preparation-1",
      principal: `coding_agent:${CAC}`,
      purpose: "ticket_summary",
      hash: HASH,
      size_bytes: SUMMARY_BYTES,
    };
    const reported = await ledger.command(
      agent,
      envelope("ReportTicketCompletion", "report", {
        ticket: ready.ticket,
        claim_seq: hold.claim_seq,
        base_revision: hold.claim_seq,
        completion: {
          release: "rel_01arz3ndektsv4rrffq69g5fav",
          summary_hash: HASH,
          outputs: [],
          fix_records: [],
          verifications: [],
        },
        summary_blob: blob,
      }, { base_revision: hold.claim_seq }),
    );
    const report = value(reported);
    assertEquals((report.result as { state: string }).state, "reported");
    // claim 접수 때 끝나고 state는 reported다. confirmed는 보고만으로 되지 않는다(R17).
    const rows = value(
      await ledger.inspect(
        "SELECT state, completion_seq FROM tickets WHERE id = ?",
        [ready.ticket],
      ),
    );
    assertEquals(rows[0]?.state, "reported");
    assert(rows[0]?.completion_seq !== null);
    const claims_ = value(
      await ledger.inspect(
        "SELECT claim_seq FROM ticket_claims WHERE ticket = ?",
        [ready.ticket],
      ),
    );
    assertEquals(claims_.length, 0);
    const refs = value(
      await ledger.inspect(
        "SELECT hash, registered_seq FROM blob_refs WHERE owner_kind = 'ticket' AND owner_key = ? AND field = 'summary'",
        [ready.ticket],
      ),
    );
    assertEquals(refs.length, 1);
    assertEquals(refs[0]?.hash, HASH);
  } finally {
    await ledger.close();
  }
});

// R22. machine은 외부 claim·보고·결과가 한 번도 없는 ticket만 취소한다.
Deno.test("coding-agent/tickets#R22: the executor cancels a ticket without history through a machine actor", async () => {
  const ledger = await harness();
  try {
    const ready = await readyTicket(ledger);
    const cancelled = await ledger.command(
      machine,
      envelope("CancelTicket", "cancel", {
        ticket: ready.ticket,
        base_revision: ready.revision,
        reason: "scope moved",
      }, { base_revision: ready.revision }),
    );
    assertEquals(
      (value(cancelled).result as { state: string }).state,
      "cancelled",
    );
    const rows = value(
      await ledger.inspect(
        "SELECT state, cancel_reason FROM tickets WHERE id = ?",
        [ready.ticket],
      ),
    );
    assertEquals(rows[0]?.state, "cancelled");
    assertEquals(rows[0]?.cancel_reason, "scope moved");
  } finally {
    await ledger.close();
  }
});
