// 사람 화면 repair 준비(coding-agent/tickets#R24, R26).
import { assert, assertEquals } from "@std/assert";
import type { ReadSnapshot } from "../../contracts/platform/mod.ts";
import {
  repairPrepareInputSchema,
  repairPrepareOutputSchema,
  ticketCreateInputSchema,
} from "../../contracts/coding-agent/mod.ts";
import { createTicketCommands } from "./commands.ts";
import {
  APP,
  DOC,
  PRB,
  QUESTION,
  ticketFixture,
  userContext,
  VER,
} from "./fixture.ts";
import {
  adoptionMatches,
  conditionInputsValid,
  humanConfirmationCoupled,
  uniqueConditions,
} from "./model.ts";
import {
  prepareRepairTicket,
  REPAIR_PREPARE_SOURCE,
  type RepairPrepareFacts,
} from "./prepare.ts";
import { createTicketReads } from "./reads.ts";

const HASH = "ab".repeat(32);
const ASG = "asg_01arz3ndektsv4rrffq69g5fav";
const commands = createTicketCommands();
const reads = createTicketReads();

function facts(
  patch: Partial<RepairPrepareFacts> = {},
): RepairPrepareFacts {
  return {
    problem: { id: PRB, app: APP, status: "open" },
    symptom: "Save drops the last line",
    snapshot: "the editor buffer length is 1 short",
    version: {
      target: VER,
      address: {
        place: "notes",
        document: "plan",
        section: null,
        version: 1,
      },
      section: "cause",
      adopted_questions: [QUESTION],
    },
    reproduction_test_hash: HASH,
    app_engineer: { assignment: ASG },
    inspect: ["src/editor.ts"],
    ...patch,
  };
}

function code(
  result: { ok: boolean; error?: { code: string } },
  expected: string,
): void {
  assert(!result.ok);
  assertEquals(result.error?.code, expected);
}

Deno.test("coding-agent/tickets#R26: one open problem prepares title, what, why, fixed basis, and acceptance from existing material without relaxing create checks", () => {
  const prepared = prepareRepairTicket(facts(), { request: "repair" });
  assert(prepared.ok);
  if (!prepared.ok || prepared.value.kind !== "ticket") return;
  const create = prepared.value.create;
  assert(ticketCreateInputSchema.safeParse(create).success);
  assertEquals(create, {
    app: APP,
    kind: "repair",
    title: "Save drops the last line",
    what: "Save drops the last line",
    why: "the editor buffer length is 1 short",
    references: [
      {
        kind: "version",
        target: VER,
        address: {
          place: "notes",
          document: "plan",
          section: null,
          version: 1,
        },
        section: "cause",
      },
      { kind: "problem", target: PRB, address: null, section: null },
    ],
    adoption_questions: [QUESTION],
    conditions: [
      { kind: "app_test" },
      { kind: "reproduction_test", problem: PRB, test_hash: HASH },
      { kind: "problems_closed" },
    ],
    inspect: ["src/editor.ts"],
    preserve: [],
    problems: [PRB],
    readiness: "needs_confirmation",
    needs: ["App Engineer confirms the prepared repair"],
  });
  assertEquals(prepared.value.app_engineer, null);
  assertEquals(prepared.value.started, false);
  assertEquals(prepared.value.approval, null);
  const ready = { ...create, readiness: "ready" as const, needs: [] };
  assert(ticketCreateInputSchema.safeParse(ready).success);
  assert(conditionInputsValid(create.conditions).ok);
  assert(uniqueConditions(create.conditions).ok);
  assert(humanConfirmationCoupled(create.conditions).ok);
  assert(
    adoptionMatches(
      create.references,
      new Map([[QUESTION, { document: DOC, version: VER }]]),
    ).ok,
  );
  assert(!JSON.stringify(create.conditions).includes("test_command"));
  const long = prepareRepairTicket(
    facts({ symptom: "가".repeat(2500), snapshot: "why " + "나".repeat(3000) }),
    { request: "repair" },
  );
  assert(long.ok);
  if (!long.ok || long.value.kind !== "ticket") return;
  assertEquals([...long.value.create.title].length, 120);
  assertEquals([...long.value.create.what].length, 2000);
  assertEquals([...long.value.create.why].length, 2000);
  assert(ticketCreateInputSchema.safeParse(long.value.create).success);

  const ledger = ticketFixture({
    problems: [{ id: PRB, status: "open" }],
    adoptions: new Map([[QUESTION, { document: DOC, version: VER }]]),
  });
  try {
    const created = ledger.transaction((tx) =>
      commands.create.handle(tx, userContext(), create, {})
    );
    assert(created.ok);
    if (!created.ok) return;
    assertEquals(created.value.readiness, "needs_confirmation");
    assertEquals(created.value.state, "open");
    assertEquals(
      ledger.emitted.map((event) => event.type),
      ["TicketCreated"],
    );
    assertEquals(
      ledger.sql.get("SELECT ticket FROM ticket_claims", []),
      undefined,
    );
    const shown = reads.show.handle(ledger.snapshot(), userContext(), {
      ticket: created.value.ticket,
    });
    assert(shown.ok);
    if (!shown.ok) return;
    assertEquals(shown.value.ticket.claim, null);
    assertEquals(shown.value.ticket.readiness, "needs_confirmation");
    assertEquals(shown.value.ticket.problems, [PRB]);
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R26: a missing reproduction test is only human_confirmation and does not invent a basis or an adopted answer", () => {
  const prepared = prepareRepairTicket(
    facts({
      reproduction_test_hash: null,
      version: {
        target: VER,
        address: {
          place: "notes",
          document: "plan",
          section: null,
          version: 1,
        },
        section: "cause",
        adopted_questions: [QUESTION],
      },
    }),
    { request: "repair" },
  );
  assert(prepared.ok);
  if (!prepared.ok || prepared.value.kind !== "ticket") return;
  const create = prepared.value.create;
  assertEquals(create.conditions, [
    { kind: "human_confirmation", problem: PRB },
  ]);
  assertEquals(create.adoption_questions, [QUESTION]);
  assertEquals(create.readiness, "needs_confirmation");
  assertEquals(create.needs, ["reproduction test cannot be built"]);
  assertEquals(prepared.value.app_engineer, null);
  assert(!JSON.stringify(create).includes("reproduction_test"));
  assert(!JSON.stringify(create).includes(HASH));
  const invented = prepareRepairTicket(
    facts({
      reproduction_test_hash: "not-a-hash",
      version: {
        target: VER,
        address: {
          place: "notes",
          document: "plan",
          section: null,
          version: 1,
        },
        section: null,
        adopted_questions: [],
      },
    }),
    { request: "repair" },
  );
  assert(invented.ok);
  if (!invented.ok || invented.value.kind !== "ticket") return;
  assertEquals(invented.value.create.conditions, [
    { kind: "human_confirmation", problem: PRB },
  ]);
  assertEquals(invented.value.create.adoption_questions, []);
  assert(!JSON.stringify(invented.value.create).includes("qst_"));
  const ledger = ticketFixture({ problems: [{ id: PRB, status: "open" }] });
  try {
    const created = ledger.transaction((tx) =>
      commands.create.handle(tx, userContext(), create, {})
    );
    assert(created.ok);
    if (!created.ok) return;
    assertEquals(created.value.readiness, "needs_confirmation");
    assertEquals(ledger.emitted.map((event) => event.type), ["TicketCreated"]);
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R26: insufficient basis opens a needs_confirmation ticket linked to the assigned App Engineer, and a new implementation request is a conversation", () => {
  const prepared = prepareRepairTicket(
    facts({
      version: {
        target: VER,
        address: {
          place: "notes",
          document: "plan",
          section: null,
          version: 1,
        },
        section: "cause",
        adopted_questions: [],
      },
    }),
    { request: "repair" },
  );
  assert(prepared.ok);
  if (!prepared.ok || prepared.value.kind !== "ticket") return;
  assertEquals(prepared.value.create.readiness, "needs_confirmation");
  assertEquals(prepared.value.create.adoption_questions, []);
  assertEquals(prepared.value.create.needs, ["adopted answer is missing"]);
  assertEquals(prepared.value.app_engineer, {
    assignment: ASG,
    role: "app_engineer",
  });
  assert(
    prepared.value.create.conditions.some((condition) =>
      condition.kind === "reproduction_test" && condition.test_hash === HASH
    ),
  );
  const unlinked = prepareRepairTicket(
    facts({
      app_engineer: null,
      version: null,
    }),
    { request: "repair" },
  );
  assert(unlinked.ok);
  if (!unlinked.ok || unlinked.value.kind !== "ticket") return;
  assertEquals(unlinked.value.app_engineer, null);
  assertEquals(unlinked.value.create.adoption_questions, []);
  assert(!JSON.stringify(unlinked.value).includes(ASG));
  const ledger = ticketFixture({ problems: [{ id: PRB, status: "open" }] });
  try {
    const input = prepared.value.create;
    const created = ledger.transaction((tx) =>
      commands.create.handle(tx, userContext(), input, {})
    );
    assert(created.ok);
    if (!created.ok) return;
    assertEquals(created.value.readiness, "needs_confirmation");
    assertEquals(created.value.state, "open");
  } finally {
    ledger.close();
  }

  const conversation = prepareRepairTicket(facts(), {
    request: "implementation",
    priority: "urgent",
    requested: true,
  });
  assert(conversation.ok);
  if (!conversation.ok) return;
  assertEquals(conversation.value, {
    kind: "conversation",
    app: APP,
    app_engineer: { assignment: ASG, role: "app_engineer" },
    reason: "implementation_request",
    started: false,
    approval: null,
  });
  assertEquals("create" in conversation.value, false);
  code(
    prepareRepairTicket(
      facts({
        problem: { id: PRB, app: APP, status: "closed" },
      }),
      { request: "repair" },
    ),
    "invalid_input",
  );
  code(
    prepareRepairTicket(
      facts({
        problem: { id: PRB, app: APP, status: "fixing" },
      }),
      { request: "repair" },
    ),
    "conflict",
  );
  code(
    prepareRepairTicket(facts({ problem: null }), { request: "repair" }),
    "not_found",
  );
  code(
    prepareRepairTicket(facts({ problem: null }), {
      request: "implementation",
    }),
    "not_found",
  );
});

Deno.test("coding-agent/tickets#R24: a repair request only prepares the ticket and priority or a request flag does not start an agent or create an approval", () => {
  const source = facts();
  const plain = prepareRepairTicket(source, { request: "repair" });
  const flagged = prepareRepairTicket(source, {
    request: "repair",
    priority: "urgent",
    requested: true,
  });
  assertEquals(flagged, plain);
  assert(flagged.ok);
  if (!flagged.ok || flagged.value.kind !== "ticket") return;
  assertEquals(flagged.value.started, false);
  assertEquals(flagged.value.approval, null);
  assertEquals("priority" in flagged.value.create, false);
  assertEquals("requested" in flagged.value.create, false);
  assert(
    !repairPrepareInputSchema.safeParse({
      problem: PRB,
      request: "repair",
      start: true,
    }).success,
  );
  assert(
    !repairPrepareInputSchema.safeParse({
      problem: PRB,
      request: "repair",
      approval: "apr_01arz3ndektsv4rrffq69g5fav",
    }).success,
  );

  let wrote = false;
  const snapshot: ReadSnapshot = {
    sql: {
      get: () => {
        wrote = true;
        return undefined;
      },
      all: () => {
        wrote = true;
        return [];
      },
    },
    as_of_seq: "1",
    port(key) {
      if (key.name !== REPAIR_PREPARE_SOURCE.name) {
        throw new Error("unregistered port");
      }
      const read: {
        facts(problem: string): { ok: true; value: RepairPrepareFacts };
      } = {
        facts: () => ({ ok: true, value: source }),
      };
      return read as never;
    },
  };
  const read = reads.screen_repair_prepare.handle(snapshot, userContext(), {
    problem: PRB,
    request: "repair",
    priority: "urgent",
    requested: true,
  });
  assert(read.ok);
  if (!read.ok) return;
  assert(repairPrepareOutputSchema.safeParse(read.value).success);
  assertEquals(read.value.outcome, flagged.value);
  assertEquals(wrote, false);
  assertEquals(
    read.value.outcome.kind === "ticket" &&
      read.value.outcome.started === false &&
      read.value.outcome.approval === null,
    true,
  );
});
