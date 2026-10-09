// 문제 상세가 읽는 지금 수리 ticket 사실(problems/grouping#R12, problems#T22). 실제 ticket 표와
// create command로 만든 repair ticket을 `ProblemWorkPort` 구현으로 읽는다.
import { assert, assertEquals } from "@std/assert";
import { createTicketCommands } from "./commands.ts";
import { problemWorkLookup } from "./problem-work.ts";
import { APP, PRB, PRB_B, ticketFixture, userContext } from "./fixture.ts";

const commands = createTicketCommands();

function input(patch: Record<string, unknown>) {
  return {
    app: APP,
    kind: "repair" as const,
    title: "fix leaf redaction",
    what: "redact leaf before snapshot",
    why: "snapshot shows the raw leaf",
    references: [],
    adoption_questions: [],
    conditions: [],
    inspect: ["src/leaf.ts"],
    preserve: ["docs/leaf.md"],
    problems: [PRB],
    readiness: "needs_confirmation" as const,
    needs: ["confirm the repro is gone"],
    ...patch,
  };
}

Deno.test("problems/grouping#R12 coding-agent/tickets#R4: 문제의 지금 repair ticket은 claim 전 open도 state·readiness·needs로 읽고 없으면 null이다", () => {
  const ledger = ticketFixture({
    problems: [{ id: PRB, status: "open" }, { id: PRB_B, status: "open" }],
  });
  try {
    assertEquals(problemWorkLookup(ledger.sql, PRB, null), {
      ok: true,
      value: null,
    });
    const implementation = ledger.transaction((tx) =>
      commands.create.handle(
        tx,
        userContext(),
        input({ kind: "implementation", problems: [PRB_B] }),
        {},
      )
    );
    assert(implementation.ok);
    // implementation ticket은 문제의 수리 ticket이 아니다.
    assertEquals(problemWorkLookup(ledger.sql, PRB_B, null), {
      ok: true,
      value: null,
    });
    const created = ledger.transaction((tx) =>
      commands.create.handle(tx, userContext(), input({}), {})
    );
    assert(created.ok);
    const ticket = String(
      ledger.sql.get(`select id from tickets where kind = 'repair'`, [])?.id,
    );
    assertEquals(problemWorkLookup(ledger.sql, PRB, null), {
      ok: true,
      value: {
        state: "open",
        readiness: "needs_confirmation",
        needs: ["confirm the repro is gone"],
      },
    });
    // 끝난 ticket은 예약이 풀린다. 문제의 work로 남은 ticket만 그 끝난 상태로 읽는다.
    ledger.sql.run(
      `update tickets set state = 'cancelled', cancel_reason = 'dropped' where id = ?`,
      [ticket],
    );
    ledger.sql.run(
      `delete from ticket_open_repair_problems where ticket = ?`,
      [ticket],
    );
    assertEquals(problemWorkLookup(ledger.sql, PRB, null), {
      ok: true,
      value: null,
    });
    const ended = problemWorkLookup(ledger.sql, PRB, ticket);
    assert(ended.ok);
    assertEquals(ended.value?.state, "cancelled");
  } finally {
    ledger.close();
  }
});

Deno.test("problems/grouping#R12: 읽지 못한 ticket 사실은 값을 지어내지 않고 unavailable이다", () => {
  const ledger = ticketFixture({ problems: [{ id: PRB, status: "open" }] });
  try {
    const created = ledger.transaction((tx) =>
      commands.create.handle(tx, userContext(), input({}), {})
    );
    assert(created.ok);
    ledger.sql.run(`update tickets set needs = 'not json'`, []);
    const broken = problemWorkLookup(ledger.sql, PRB, null);
    assert(!broken.ok);
    assertEquals(broken.error.code, "unavailable");
  } finally {
    ledger.close();
  }
});
