// 조립한 feedback을 제품과 같은 RecordReport로 접수해 묶기를 확인한다
// (problems/grouping#R6, problems/feedback#R14). 실제 임시 ledger(writer Worker·
// reader Worker·SQLite WAL) 위에서 돈다. 문제 표를 직접 만들지 않는다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import { ok, type Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../apps/core/testing/ledger.ts";
import { getProblemOutputSchema } from "../../protocol/problems/mod.ts";
import {
  APP_A,
  APP_B,
  COLLECTOR,
  reportInput,
  rpt,
} from "../grouping/testing/mod.ts";
import { assemble, feedbackHarness, type Submission } from "./testing/mod.ts";
import { realPrepare } from "../snapshots/testing/mod.ts";

function newHarness(
  options: Omit<Parameters<typeof feedbackHarness>[0], "store"> = {},
) {
  return feedbackHarness({ ...options, store: realPrepare() });
}

const registration = new URL("../grouping/testing/mod.ts", import.meta.url);
const NOW_MS = Date.parse("2026-10-04T12:00:00.000Z");

const READER: AuthenticatedContext = {
  principal: "user-1",
  actor: "user",
  scope: {
    operations: ["ListProblems", "GetProblem", "ListReports", "GetReport"],
    targets: {},
  },
  conditions: {},
  credential_ref: "cred-reader",
};

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

async function open(): Promise<LedgerHarness> {
  return value(
    await createLedgerHarness({
      registrationModules: [registration],
      credentials: [COLLECTOR, READER],
      nowMs: NOW_MS,
    }),
  );
}

let serial = 0;

// 사람이 [문제 알리기]로 낸 feedback 하나를 조립해 RecordReport로 접수한다. 기존 문제는
// collector가 core 읽기로 찾는 것과 같은 GetProblem으로 읽는다.
async function submit(
  h: LedgerHarness,
  patch: Partial<Submission>,
): Promise<{ problem: string; report: string }> {
  const harness = newHarness({
    lookup: async (id) => {
      const read = await h.read(
        { resource: "problems", method: "get" },
        READER,
        { problem: id },
      ) as Result<unknown>;
      if (!read.ok) return ok(null);
      const parsed = getProblemOutputSchema.parse(read.value);
      return ok({
        id: parsed.problem.id,
        app: parsed.problem.app,
        group_key: parsed.problem.group_key,
      });
    },
  });
  const assembled = await assemble(patch, harness.deps);
  const built = value(assembled);
  const sent = value(
    await h.command(COLLECTOR, {
      command: "RecordReport",
      input: built.input,
      compare: { active_release: null, problem_seq: null },
      idempotency_key: `feedback-${++serial}`,
      prepared: built.prepared,
    }),
  );
  const result = sent.result as { problem: string; report: string };
  return { problem: result.problem, report: result.report };
}

async function detail(
  h: LedgerHarness,
  problem: string,
): Promise<Record<string, unknown>> {
  return value(
    await h.read(
      { resource: "problems", method: "get" },
      READER,
      { problem },
    ) as Result<Record<string, unknown>>,
  );
}

async function listed(h: LedgerHarness): Promise<{ id: string }[]> {
  const all = value(
    await h.read(
      { resource: "problems", method: "list" },
      READER,
      {},
    ) as Result<
      { problems: { id: string }[] }
    >,
  );
  return all.problems;
}

Deno.test("problems/grouping#R6: 같은 앱·같은 화면의 비슷한 글 2개는 별도 문제로 열린다", async () => {
  const h = await open();
  try {
    const view = {
      binding: "binding-1",
      name: "Monthly report",
      app: APP_A,
      release: "rel_01arz3ndektsv4rrffq69g5fav",
      mode: "live" as const,
      bundle_hash: "a".repeat(64),
      diagnostic_scope: null,
      observed_at: "2026-10-04T12:00:00.000Z",
      capture: null,
      final_screenshot_hash: null,
    };
    const first = await submit(h, {
      report_id: rpt(1),
      text: "The monthly total is wrong.",
      view,
    });
    const second = await submit(h, {
      report_id: rpt(2),
      text: "The monthly total is wrong!",
      view,
    });
    assertNotEquals(first.problem, second.problem);
    assertEquals((await listed(h)).length, 2);
    assertEquals((await detail(h, first.problem))["report_count"], 1);
    assertEquals((await detail(h, second.problem))["report_count"], 1);
  } finally {
    await h.close();
  }
});

Deno.test("problems/grouping#R6: 같은 앱의 기존 문제를 명시적으로 고른 제보만 그 문제에 연결된다", async () => {
  const h = await open();
  try {
    const first = await submit(h, { report_id: rpt(1) });
    const joined = await submit(h, {
      report_id: rpt(2),
      text: "Still wrong this morning.",
      existing_problem: first.problem,
    });
    assertEquals(joined.problem, first.problem);
    assertEquals((await detail(h, first.problem))["report_count"], 2);
    assertEquals((await listed(h)).length, 1);
    // 선택하지 않은 다음 제보는 같은 문제라도 합치지 않는다.
    const alone = await submit(h, { report_id: rpt(3) });
    assertNotEquals(alone.problem, first.problem);
  } finally {
    await h.close();
  }
});

Deno.test("problems/grouping#R6: 다른 앱의 문제를 고른 제보는 없는 문제를 고른 것과 같이 새 문제가 되고 다른 앱 문제는 바뀌지 않는다", async () => {
  const h = await open();
  try {
    const theirs = value(
      await h.command(COLLECTOR, {
        command: "RecordReport",
        input: reportInput({ serial: 9, app: APP_B, kind: "declared" }),
        compare: { active_release: null, problem_seq: null },
        idempotency_key: "seed-b",
        prepared: [],
      }),
    ).result as { problem: string };
    const fromOther = await submit(h, {
      report_id: rpt(1),
      existing_problem: theirs.problem,
    });
    const fromAbsent = await submit(h, {
      report_id: rpt(2),
      existing_problem: "prb_01arz3ndektsv4rrffq69g5fav",
    });
    assertNotEquals(fromOther.problem, theirs.problem);
    assertNotEquals(fromOther.problem, fromAbsent.problem);
    assertEquals((await detail(h, theirs.problem))["report_count"], 1);
    const created = (await detail(h, fromOther.problem))["problem"] as {
      app: string;
    };
    assertEquals(created.app, APP_A);
  } finally {
    await h.close();
  }
});

Deno.test("problems/feedback#R14: 직접 해 봤지만 안 된다는 제보는 새 Report일 뿐 닫힘이나 오탐 결정이 아니고 별도 오탐 문제도 만들지 않는다", async () => {
  const h = await open();
  try {
    const closedProblem = value(
      await h.command(COLLECTOR, {
        command: "RecordReport",
        input: reportInput({ serial: 9, kind: "declared" }),
        compare: { active_release: null, problem_seq: null },
        idempotency_key: "seed-closed",
        prepared: [],
      }),
    ).result as { problem: string };
    const closure = JSON.stringify({
      reason: "dismissed",
      basis_seq: "1",
      release: null,
      verification: null,
      confirmation: "confirmation-1",
      last_report: null,
      note: "not needed",
    });
    value(
      await h.command(COLLECTOR, {
        command: "problems.testing.arrange",
        input: {
          problem: closedProblem.problem,
          status: "closed",
          work: null,
          closure,
          interpretation_version: null,
          interpretation_section: null,
        },
        compare: {},
        idempotency_key: "arrange-closed",
        prepared: [],
      }),
    );
    const retry = await submit(h, {
      report_id: rpt(1),
      text: "I tried it myself, but it still does not work.",
    });
    // 새 Report의 새 문제이고, 닫힌 문제는 상태·닫힘 근거·보고 수가 그대로다.
    assertNotEquals(retry.problem, closedProblem.problem);
    const before = await detail(h, closedProblem.problem);
    assertEquals((before["problem"] as { status: string }).status, "closed");
    assertEquals(before["report_count"], 1);
    const opened = await detail(h, retry.problem);
    assertEquals((opened["problem"] as { status: string }).status, "open");
    assertEquals((opened["problem"] as { closure: unknown }).closure, null);
    // 자동 오탐 문제나 닫힘 command 흔적이 없다: 문제는 둘뿐이다.
    assertEquals((await listed(h)).length, 2);
    const reports = value(
      await h.read(
        { resource: "problems", method: "list-reports" },
        READER,
        { problem: retry.problem },
      ) as Result<{ reports: { source: string; code: string }[] }>,
    );
    assertEquals(
      reports.reports.map((report) => [report.source, report.code]),
      [["feedback", "_feedback"]],
    );
  } finally {
    await h.close();
  }
});
