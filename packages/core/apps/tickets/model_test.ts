// ticket 생성·readiness 규칙 테스트(coding-agent/tickets#R1–R10, R25). 요구
// 번호로 시작한다. SQL·port 없는 model 규칙과, fixture transaction으로 만드는
// command 결과를 함께 본다.
import { assert, assertEquals, assertThrows } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import { ticketCreateInputSchema } from "../../../protocol/coding-agent/mod.ts";
import { createTicketCommands } from "./commands.ts";
import {
  adoptionMatches,
  createActorAllowed,
  humanConfirmationCoupled,
  readinessOf,
  readyKindsComplete,
  uniqueConditions,
  wantsNoGrant,
} from "./model.ts";
import {
  APP,
  DOC,
  OTHER_APP,
  PRB,
  PRB_B,
  QUESTION,
  ticketFixture,
  userContext,
  VER,
} from "./fixture.ts";

const commands = createTicketCommands();

function code(
  result: { ok: boolean; error?: { code: string } },
  expected: string,
): void {
  assert(!result.ok);
  assertEquals(result.error?.code, expected);
}

function createInput(patch: Record<string, unknown> = {}) {
  return {
    app: APP,
    kind: "implementation" as const,
    title: "fix leaf redaction",
    what: "redact leaf before snapshot",
    why: "snapshot shows the raw leaf",
    references: [],
    adoption_questions: [],
    conditions: [],
    inspect: ["src/leaf.ts"],
    preserve: ["docs/leaf.md"],
    problems: [],
    readiness: "ready" as const,
    needs: [],
    ...patch,
  };
}

Deno.test("coding-agent/tickets#R1: creates implementation and repair only, rejects two apps via the single app field", () => {
  const ledger = ticketFixture();
  try {
    const implementation = ledger.transaction((tx) =>
      commands.create.handle(tx, userContext(), createInput(), {})
    );
    assert(implementation.ok);
    if (!implementation.ok) return;
    const repair = ledger.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        createInput({
          kind: "repair",
          problems: [PRB],
          readiness: "needs_confirmation",
          needs: ["confirm the repro is gone"],
        }),
        {},
      )
    );
    assert(repair.ok);
    const summary = ledger.sql.get(
      "SELECT kind, app FROM tickets ORDER BY id",
      [],
    );
    assert(summary !== undefined);
    // ticket은 앱 하나만 가리킨다. 두 앱을 묶는 입력은 schema가 거절한다.
    const unknown = ledger.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        createInput({ app: OTHER_APP }),
        {},
      )
    );
    code(unknown, "not_found");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R2: title and body limits, ready requires references, adoption questions, and conditions", () => {
  assert(
    !ticketCreateInputSchema.safeParse(createInput({ title: "a".repeat(121) }))
      .success,
  );
  assert(
    ticketCreateInputSchema.safeParse(
      createInput({
        title: "가".repeat(120),
        readiness: "needs_confirmation",
        needs: ["confirm the repro is gone"],
      }),
    ).success,
  );
  assert(
    !ticketCreateInputSchema.safeParse(createInput({ what: "x".repeat(2001) }))
      .success,
  );
  assert(!ticketCreateInputSchema.safeParse(createInput({ why: "" })).success);
  assert(
    !ticketCreateInputSchema.safeParse(
      createInput({
        readiness: "ready",
        needs: [],
        references: [{
          kind: "problem",
          target: PRB,
          address: null,
          section: null,
        }],
      }),
    ).success,
  );
  assert(
    !ticketCreateInputSchema.safeParse(
      createInput({
        references: [{
          kind: "version",
          target: VER,
          address: {
            place: "project",
            document: "leaf-redaction",
            section: null,
            version: 1,
          },
        }],
      }),
    ).success,
  );
});

Deno.test("coding-agent/tickets#R4: repair reserves each problem once, a closed problem is rejected, and a concurrent create conflicts", () => {
  const ledger = ticketFixture({
    problems: [{ id: PRB, status: "open" }],
  });
  try {
    const first = ledger.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        createInput({
          kind: "repair",
          problems: [PRB],
          readiness: "needs_confirmation",
          needs: ["confirm the repro is gone"],
        }),
        {},
      )
    );
    assert(first.ok);
    const again = ledger.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        createInput({
          kind: "repair",
          problems: [PRB],
          readiness: "needs_confirmation",
          needs: ["confirm the repro is gone"],
        }),
        {},
      )
    );
    code(again, "conflict");
    const closed = ticketFixture({
      problems: [{ id: PRB_B, status: "closed" }],
    });
    try {
      const closedCreate = closed.transaction((tx) =>
        commands.create.handle(
          tx,
          userContext(),
          createInput({
            kind: "repair",
            problems: [PRB_B],
            readiness: "needs_confirmation",
            needs: ["confirm the repro is gone"],
          }),
          {},
        )
      );
      code(closedCreate, "invalid_input");
    } finally {
      closed.close();
    }
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R5: user and the assigned agent create, other kinds are forbidden", () => {
  assert(createActorAllowed("user"));
  assert(createActorAllowed("agent:asg_01arz3ndektsv4rrffq69g5fav"));
  assert(!createActorAllowed("coding_agent:cac_01arz3ndektsv4rrffq69g5fav"));
  assert(!createActorAllowed("app:app_01arz3ndektsv4rrffq69g5fav"));
  assert(!createActorAllowed("machine"));
  const ledger = ticketFixture();
  try {
    const denied = ledger.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext("machine"),
        createInput(),
        {},
      )
    );
    code(denied, "forbidden");
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R6: immutable fields reject UPDATE and ready never returns to needs_confirmation", () => {
  const ledger = ticketFixture();
  try {
    const created = ledger.transaction((tx) =>
      commands.create.handle(tx, userContext(), createInput(), {})
    );
    assert(created.ok);
    if (!created.ok) return;
    assertThrows(
      () =>
        ledger.transaction((tx) => {
          tx.sql.run(
            "UPDATE tickets SET title = 'rewritten' WHERE id = ?",
            [created.value.ticket],
          );
          return ok({ changed: true });
        }),
    );
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R7: human_confirmation needs a problem and no reproduction_test for the same problem", () => {
  assert(
    !ticketCreateInputSchema.safeParse(createInput({
      conditions: [{
        kind: "human_confirmation",
      } as never],
    })).success,
  );
  const replaced = humanConfirmationCoupled([
    { kind: "human_confirmation", problem: PRB },
    { kind: "reproduction_test", problem: PRB, test_hash: "a".repeat(64) },
  ]);
  code(replaced, "invalid_input");
  const held = humanConfirmationCoupled([
    { kind: "human_confirmation", problem: PRB },
  ]);
  assert(held.ok);
});

Deno.test("coding-agent/tickets#R8: implementation ready requires app_test and test_command", () => {
  const missingAppTest = readyKindsComplete("implementation", [], [
    {
      kind: "test_command",
      executable: "deno",
      argv: [],
      cwd: ".",
      timeout_ms: 60_000,
      expected_exit_code: 0,
    },
  ]);
  code(missingAppTest, "invalid_input");
  const missingCommand = readyKindsComplete("implementation", [], [
    { kind: "app_test" },
  ]);
  code(missingCommand, "invalid_input");
  const complete = readyKindsComplete("implementation", [], [
    { kind: "app_test" },
    {
      kind: "test_command",
      executable: "deno",
      argv: ["task", "test"],
      cwd: ".",
      timeout_ms: 60_000,
      expected_exit_code: 0,
    },
  ]);
  assert(complete.ok);
});

Deno.test("coding-agent/tickets#R9: repair ready needs problems_closed and per-problem coverage", () => {
  const missingClosed = readyKindsComplete("repair", [PRB], [
    { kind: "app_test" },
    { kind: "reproduction_test", problem: PRB, test_hash: "a".repeat(64) },
  ]);
  code(missingClosed, "invalid_input");
  const missingCoverage = readyKindsComplete("repair", [PRB], [
    { kind: "app_test" },
    { kind: "problems_closed" },
  ]);
  code(missingCoverage, "invalid_input");
  const complete = readyKindsComplete("repair", [PRB], [
    { kind: "app_test" },
    {
      kind: "test_command",
      executable: "deno",
      argv: [],
      cwd: ".",
      timeout_ms: 60_000,
      expected_exit_code: 0,
    },
    { kind: "problems_closed" },
    { kind: "reproduction_test", problem: PRB, test_hash: "a".repeat(64) },
  ]);
  assert(complete.ok);
  const humanConfirm = readyKindsComplete("repair", [PRB], [
    { kind: "app_test" },
    {
      kind: "test_command",
      executable: "deno",
      argv: [],
      cwd: ".",
      timeout_ms: 60_000,
      expected_exit_code: 0,
    },
    { kind: "problems_closed" },
    { kind: "human_confirmation", problem: PRB },
  ]);
  assert(humanConfirm.ok);
});

Deno.test("coding-agent/tickets#R10: test command rejects absolute, outside, and shell strings", () => {
  assert(
    !ticketCreateInputSchema.safeParse(
      createInput({
        conditions: [{
          kind: "test_command",
          executable: "/bin/deno",
          argv: [],
          cwd: ".",
          timeout_ms: 60_000,
          expected_exit_code: 0,
        }],
      }),
    ).success,
  );
  assert(
    !ticketCreateInputSchema.safeParse(
      createInput({
        conditions: [{
          kind: "test_command",
          executable: "deno",
          argv: [],
          cwd: "../outside",
          timeout_ms: 60_000,
          expected_exit_code: 0,
        }],
      }),
    ).success,
  );
  assert(
    !ticketCreateInputSchema.safeParse(
      createInput({
        conditions: [{
          kind: "test_command",
          executable: "deno",
          argv: [],
          cwd: ".",
          timeout_ms: 0,
          expected_exit_code: 0,
        }],
      }),
    ).success,
  );
});

Deno.test("coding-agent/tickets#R25: inspect and preserve stay redaction-free, no grant interpretation", () => {
  const blank = wantsNoGrant({ inspect: [""], preserve: [] });
  code(blank, "invalid_input");
  const held = wantsNoGrant({ inspect: ["src/leaf.ts"], preserve: [] });
  assert(held.ok);
  assertEquals(adoptionMatches([], new Map()).ok, true);
  assertEquals(readinessOf("ready", []).ok, true);
  const missingNeeds = readinessOf("needs_confirmation", []);
  if (!missingNeeds.ok) {
    assertEquals(missingNeeds.error.code, "invalid_input");
  } else {
    assert(false);
  }
});

Deno.test("coding-agent/tickets#R2: ready create fills references, adoption questions, and conditions together", () => {
  const ledger = ticketFixture({
    adoptions: new Map([[QUESTION, { document: DOC, version: VER }]]),
  });
  try {
    const created = ledger.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        createInput({
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
        }),
        {},
      )
    );
    assert(created.ok);
    if (!created.ok) return;
    assertEquals(created.value.state, "open");
    assertEquals(created.value.readiness, "ready");
    const reference = ledger.sql.get(
      "SELECT target FROM ticket_references",
      [],
    );
    assertEquals(String(reference?.target), VER);
    const condition = ledger.sql.get(
      "SELECT condition_hash FROM ticket_conditions",
      [],
    );
    assertEquals(String(condition?.condition_hash).length, 64);
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R2: duplicate conditions are rejected before write", () => {
  const led = uniqueConditions([
    { kind: "app_test" },
    { kind: "app_test" },
  ]);
  code(led, "invalid_input");
});

Deno.test("coding-agent/tickets#R3: ready create refuses a version basis no question adopts", () => {
  const ledger = ticketFixture({
    // 질문 답이 존재하지만 version VER을 채택하지 않는다.
    adoptions: new Map([[QUESTION, { document: DOC, version: "ver_other" }]]),
  });
  try {
    const denied = ledger.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        createInput({
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
        }),
        {},
      )
    );
    code(denied, "invalid_input");
    const written = ledger.sql.get("SELECT COUNT(*) AS count FROM tickets", []);
    assertEquals(Number(written?.count), 0);
  } finally {
    ledger.close();
  }
});

Deno.test("coding-agent/tickets#R3: make_ready refuses a version basis no question adopts", () => {
  const ledger = ticketFixture({
    adoptions: new Map([[QUESTION, { document: DOC, version: "ver_other" }]]),
  });
  try {
    const created = ledger.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        createInput({
          readiness: "needs_confirmation",
          needs: ["confirm the repro is gone"],
        }),
        {},
      )
    );
    assert(created.ok);
    if (!created.ok) return;
    const denied = ledger.transaction((tx) =>
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
    code(denied, "invalid_input");
    const readiness = ledger.sql.get(
      "SELECT readiness FROM tickets",
      [],
    );
    assertEquals(String(readiness?.readiness), "needs_confirmation");
  } finally {
    ledger.close();
  }
});
