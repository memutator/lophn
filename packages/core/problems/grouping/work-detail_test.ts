// 문제 상세의 실제 담당·수리 상태(problems/grouping#R9, R12, tests#R5, problems#T22). 제품과 같은
// RecordReport로 문제를 만들고 실제 ReconcileProblemWork로 open·fixing을 바꾼 뒤 GetProblem.detail을
// 읽는다. ticket 표와 event는 `problems.testing.ticket-event`가, 두 read port는 grouping testing의
// fake가 같은 ledger 표에서 답한다.
import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../base/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../../apps/core/testing/ledger.ts";
import { APP_A, COLLECTOR, reportInput } from "./testing/mod.ts";

const registration = new URL("./testing/mod.ts", import.meta.url);
const NOW_MS = Date.parse("2026-10-04T12:00:00.000Z");
const TICKET = "tkt_01arz3ndektsv4rrffq69g5fa1";
const READER: AuthenticatedContext = {
  principal: "user-1",
  actor: "user",
  scope: { operations: ["GetProblem"], targets: {} },
  conditions: {},
  credential_ref: "cred-reader",
};

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

let serial = 0;
const key = (name: string) => `${name}-${++serial}`;

async function send(h: LedgerHarness, command: string, input: unknown) {
  return value(
    await h.command(COLLECTOR, {
      command,
      input,
      compare: command === "RecordReport"
        ? { active_release: null, problem_seq: null }
        : {},
      idempotency_key: key(command),
      prepared: [],
    }),
  ).result as Record<string, unknown>;
}

async function ticket(
  h: LedgerHarness,
  problem: string,
  event: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  const sent = await send(h, "problems.testing.ticket-event", {
    event,
    ticket: TICKET,
    app: APP_A,
    problems: [problem],
    ...extra,
  });
  const row = value(
    await h.inspect(
      `select status, work,
              (select cast(max(seq) as text) from events where subject = p.id) as seq
         from problems p where id = ?`,
      [problem],
    ),
  )[0]!;
  value(
    await h.command(COLLECTOR, {
      command: "ReconcileProblemWork",
      input: { problem, ticket: TICKET, ticket_event_seq: sent["seq"] },
      compare: {
        problem_seq: String(row["seq"]),
        work: row["work"] === null ? null : String(row["work"]),
      },
      idempotency_key: key("reconcile"),
      prepared: [],
    }),
  );
}

type Detail = {
  progress: { state: string };
  owner: { kind: string };
  repair: { state: string; needs: string[]; last_check_failed: boolean };
  next_action: string | null;
  result: { tests: { state: string; items: { state: string }[] } };
};

async function detailOf(
  h: LedgerHarness,
  problem: string,
): Promise<{ detail: Detail; status: string; text: string }> {
  const read = value(
    await h.read({ resource: "problems", method: "get" }, READER, { problem }),
  ) as { problem: { status: string }; detail: Detail };
  return {
    detail: read.detail,
    status: read.problem.status,
    text: JSON.stringify(read.detail),
  };
}

Deno.test("problems/grouping#R9 R12 tests#R5: 실제 ReconcileProblemWork의 open·fixing이 상세의 담당·수리 상태·테스트로 읽힌다", async () => {
  const h = value(
    await createLedgerHarness({
      registrationModules: [registration],
      credentials: [COLLECTOR, READER],
      nowMs: NOW_MS,
    }),
  );
  try {
    const problem = String(
      (await send(h, "RecordReport", reportInput({ serial: 1, app: APP_A })))[
        "problem"
      ],
    );
    // ticket이 없는 열린 문제: 아무도 맡지 않았고, 테스트를 정하지 않아 결과는 모름이다.
    let now = await detailOf(h, problem);
    assertEquals(now.status, "open");
    assertEquals(now.detail.owner.kind, "nobody");
    assertEquals(now.detail.repair.state, "none");
    assertEquals(now.detail.result.tests.state, "unknown");

    // 확인이 필요한 repair ticket이 생기면 open인 채 그 needs가 사람 조치다.
    await ticket(h, problem, "TicketCreated", {
      readiness: "needs_confirmation",
      needs: ["Confirm the save button should stay enabled."],
    });
    now = await detailOf(h, problem);
    assertEquals(now.status, "open");
    assertEquals(now.detail.repair.state, "needs_confirmation");
    assertEquals(now.detail.repair.needs, [
      "Confirm the save button should stay enabled.",
    ]);
    assertEquals(now.detail.owner.kind, "nobody");

    // claim하면 fixing이고 coding agent가 맡는다. 테스트는 대기·진행을 구별한다.
    await send(h, "problems.testing.set-tests", {
      problem,
      tests: [
        { kind: "reproduction", state: "running", ended_at: null },
        { kind: "app_test", state: "pending", ended_at: null },
      ],
    });
    await ticket(h, problem, "TicketClaimed", { claim_seq: "9" });
    now = await detailOf(h, problem);
    assertEquals(now.status, "fixing");
    assertEquals(now.detail.progress.state, "fixing");
    assertEquals(now.detail.owner.kind, "coding_agent");
    assertEquals(now.detail.repair.state, "in_progress");
    assertEquals(now.detail.result.tests.state, "running");

    // 완료 보고는 다시 open이고 결과를 확인하는 중이다.
    await ticket(h, problem, "TicketCompletionReported", { claim_seq: "9" });
    now = await detailOf(h, problem);
    assertEquals(now.status, "open");
    assertEquals(now.detail.owner.kind, "platform_check");
    assertEquals(now.detail.repair.state, "checking");

    // 검사 실패는 새 claim이 아니다: open이고 다시 맡겨야 한다. 실패한 테스트는 실패로 보인다.
    await send(h, "problems.testing.set-tests", {
      problem,
      tests: [{
        kind: "reproduction",
        state: "fail",
        ended_at: "2026-10-04T12:05:00.000Z",
      }],
    });
    await ticket(h, problem, "TicketCheckFailed");
    now = await detailOf(h, problem);
    assertEquals(now.status, "open");
    assertEquals(now.detail.repair.last_check_failed, true);
    assertEquals(now.detail.result.tests.state, "fail");

    // 취소하면 ticket 연결이 풀리고 담당은 다시 없음이다.
    await ticket(h, problem, "TicketCancelled");
    now = await detailOf(h, problem);
    assertEquals(now.status, "open");
    assertEquals(now.detail.owner.kind, "nobody");
    assertEquals(now.detail.repair.state, "none");
    // 상세에는 ticket ID·claim 값이 나오지 않는다.
    assert(!now.text.includes(TICKET));
  } finally {
    await h.close();
  }
});
