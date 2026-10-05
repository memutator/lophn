// ticket command 테스트2(coding-agent/tickets#R6, R3, R2). make_ready의 ready
// 전환·근거 채움과 worksheet 불변을 fixture transaction으로 본다.
import { assert, assertEquals } from "@std/assert";
import { createTicketCommands } from "./commands.ts";
import {
  APP,
  DOC,
  QUESTION,
  ticketFixture,
  userContext,
  VER,
} from "./fixture.ts";
import { createTicketReads } from "./reads.ts";

const commands = createTicketCommands();
const reads = createTicketReads();

function code(
  result: { ok: boolean; error?: { code: string } },
  expected: string,
): void {
  assert(!result.ok);
  assertEquals(result.error?.code, expected);
}

function readyInput(patch: Record<string, unknown> = {}) {
  return {
    ticket: "",
    base_revision: "1",
    references: [{
      kind: "version" as const,
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
      { kind: "app_test" as const },
      {
        kind: "test_command" as const,
        executable: "deno",
        argv: ["task", "test"],
        cwd: ".",
        timeout_ms: 60_000,
        expected_exit_code: 0,
      },
    ],
    inspect: ["src/leaf.ts"],
    preserve: ["docs/leaf.md"],
    ...patch,
  };
}

function createReadyCandidate(ledger: ReturnType<typeof ticketFixture>): {
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
  return { ticket: created.value.ticket, revision: created.value.revision };
}

Deno.test("coding-agent/tickets#R6: make_ready fills references, adoption questions, and conditions and bumps the revision", () => {
  const ledger = ticketFixture({
    adoptions: new Map([[QUESTION, { document: DOC, version: VER }]]),
  });
  try {
    const candidate = createReadyCandidate(ledger);
    const madeReady = ledger.transaction((tx) =>
      commands.make_ready.handle(
        tx,
        userContext(),
        readyInput({
          ticket: candidate.ticket,
          base_revision: candidate.revision,
        }),
        { base_revision: candidate.revision },
      )
    );
    assert(madeReady.ok);
    if (!madeReady.ok) return;
    assertEquals(madeReady.value.readiness, "ready");
    const referenceCount = ledger.sql.get(
      "SELECT COUNT(*) AS count FROM ticket_references",
      [],
    );
    assertEquals(Number(referenceCount?.count), 1);
    const conditionCount = ledger.sql.get(
      "SELECT COUNT(*) AS count FROM ticket_conditions",
      [],
    );
    assertEquals(Number(conditionCount?.count), 2);
    const questionCount = ledger.sql.get(
      "SELECT COUNT(*) AS count FROM ticket_adoption_questions",
      [],
    );
    assertEquals(Number(questionCount?.count), 1);
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R6: make_ready rejects a changed revision and an already ready ticket", () => {
  const ledger = ticketFixture({
    adoptions: new Map([[QUESTION, { document: DOC, version: VER }]]),
  });
  try {
    const candidate = createReadyCandidate(ledger);
    const madeReady = ledger.transaction((tx) =>
      commands.make_ready.handle(
        tx,
        userContext(),
        readyInput({
          ticket: candidate.ticket,
          base_revision: candidate.revision,
        }),
        { base_revision: candidate.revision },
      )
    );
    assert(madeReady.ok);
    if (!madeReady.ok) return;
    const again = ledger.transaction((tx) =>
      commands.make_ready.handle(
        tx,
        userContext(),
        readyInput({
          ticket: candidate.ticket,
          base_revision: madeReady.value.revision,
        }),
        { base_revision: madeReady.value.revision },
      )
    );
    code(again, "conflict");
    const stale = ledger.transaction((tx) =>
      commands.make_ready.handle(
        tx,
        userContext(),
        readyInput({
          ticket: candidate.ticket,
          base_revision: candidate.revision,
        }),
        { base_revision: candidate.revision },
      )
    );
    code(stale, "conflict");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R3: make_ready rejects a reference no answered question adopts", () => {
  const ledger = ticketFixture({
    // 질문 답이 adoption이 없다(document "".).
    adoptions: new Map([[QUESTION, { document: "", version: "" }]]),
  });
  try {
    const candidate = createReadyCandidate(ledger);
    const denied = ledger.transaction((tx) =>
      commands.make_ready.handle(
        tx,
        userContext(),
        readyInput({
          ticket: candidate.ticket,
          base_revision: candidate.revision,
        }),
        { base_revision: candidate.revision },
      )
    );
    code(denied, "invalid_input");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R2: list gives summaries without bodies, show gives every condition hash, checks reports the latest completion", () => {
  const ledger = ticketFixture({
    adoptions: new Map([[QUESTION, { document: DOC, version: VER }]]),
  });
  try {
    const candidate = createReadyCandidate(ledger);
    const madeReady = ledger.transaction((tx) =>
      commands.make_ready.handle(
        tx,
        userContext(),
        readyInput({
          ticket: candidate.ticket,
          base_revision: candidate.revision,
        }),
        { base_revision: candidate.revision },
      )
    );
    assert(madeReady.ok);
    if (!madeReady.ok) return;
    const list = reads.list.handle(
      ledger.snapshot("2"),
      userContext(),
      { app: APP },
    );
    assert(list.ok);
    if (!list.ok) return;
    assertEquals(list.value.tickets.length, 1);
    assertEquals(list.value.next_cursor, null);
    assertEquals(JSON.stringify(list.value.tickets[0]).includes("what"), false);
    const shown = reads.show.handle(
      ledger.snapshot("2"),
      userContext(),
      { ticket: candidate.ticket },
    );
    assert(shown.ok);
    if (!shown.ok) return;
    assertEquals(shown.value.ticket.readiness, "ready");
    assertEquals(shown.value.ticket.conditions.length, 2);
    assertEquals(shown.value.ticket.conditions[0].condition_hash.length, 64);
    assertEquals(shown.value.ticket.references.length, 1);
    assertEquals(shown.value.ticket.adoption_questions, [QUESTION]);
    const checks = reads.checks.handle(
      ledger.snapshot("2"),
      userContext(),
      { ticket: candidate.ticket },
    );
    assert(checks.ok);
    if (!checks.ok) return;
    assertEquals(checks.value.completion_seq, null);
    assertEquals(checks.value.checks, []);
  } finally {
    ledger.close();
  }
});
