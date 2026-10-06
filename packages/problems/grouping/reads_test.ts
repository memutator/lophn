// 실제 임시 ledger(writer Worker·reader Worker·SQLite WAL) 위에서 제품과 같은
// RecordReport로 문제를 만들고 문제 read를 읽는다. 표를 직접 만들지 않는다.
import { assert, assertEquals, assertNotEquals } from "@std/assert";
import type { Result } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../contracts/platform/mod.ts";
import { RESERVED_PROBLEM_CODES } from "../../contracts/problems/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../apps/core/testing/ledger.ts";
import {
  APP_A,
  APP_B,
  COLLECTOR,
  ERROR_MESSAGE,
  RELEASE,
  reportInput,
  type ReportSpec,
  rpt,
  snp,
  STACK_HASH,
} from "./testing/mod.ts";

const registration = new URL("./testing/mod.ts", import.meta.url);
const NOW_MS = Date.parse("2026-10-04T12:00:00.000Z");
const ALL_READS = [
  "ListProblems",
  "GetProblem",
  "ListReports",
  "GetReport",
  "GetSnapshot",
];

function reader(
  patch: Partial<AuthenticatedContext> = {},
): AuthenticatedContext {
  return {
    principal: "user-1",
    actor: "user",
    scope: { operations: ALL_READS, targets: {} },
    conditions: {},
    credential_ref: "cred-reader",
    ...patch,
  };
}

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

function failure(result: Result<unknown>, code: string): string {
  assert(!result.ok, "실패해야 한다");
  assertEquals(result.error.code, code);
  return JSON.stringify(result.error);
}

async function open(
  ...extra: AuthenticatedContext[]
): Promise<LedgerHarness> {
  return value(
    await createLedgerHarness({
      registrationModules: [registration],
      credentials: [COLLECTOR, reader(), ...extra],
      nowMs: NOW_MS,
    }),
  );
}

let keySerial = 0;
async function record(h: LedgerHarness, spec: ReportSpec): Promise<string> {
  const input = reportInput(spec);
  const sent = value(
    await h.command(COLLECTOR, {
      command: "RecordReport",
      input,
      compare: { active_release: null, problem_seq: null },
      idempotency_key: `record-${++keySerial}`,
      prepared: [],
    }),
  );
  const accepted = sent.result as { problem: string | null };
  return accepted.problem ?? "";
}

type Arranged = {
  status: "open" | "fixing" | "closed";
  work?: string;
  closure?: string;
  interpretation?: { version: string; section: string };
};

// 상태를 바꾸는 command는 뒤 작업이 만든다. 그 전에는 테스트 command로 상태만 정한다.
async function arrange(
  h: LedgerHarness,
  problem: string,
  state: Arranged,
): Promise<void> {
  value(
    await h.command(COLLECTOR, {
      command: "problems.testing.arrange",
      input: {
        problem,
        status: state.status,
        work: state.work ?? null,
        closure: state.closure ?? null,
        interpretation_version: state.interpretation?.version ?? null,
        interpretation_section: state.interpretation?.section ?? null,
      },
      compare: {},
      idempotency_key: `arrange-${++keySerial}`,
      prepared: [],
    }),
  );
}

type Declared = {
  message: string;
  message_key?: string;
  fixer?: "coding_agent" | "user";
  app_name?: string;
};

// 문제 문구 fixture를 release·code별로 정한다(problems#T27). message를 null로 주면
// 그 release의 선언을 지운다(선언을 읽을 수 없는 상태).
async function declare(
  h: LedgerHarness,
  release: string,
  code: string,
  wording: Declared | null,
  app?: string,
): Promise<void> {
  value(
    await h.command(COLLECTOR, {
      command: "problems.testing.set-wording",
      input: {
        release,
        code,
        message: wording === null ? null : wording.message,
        message_key: wording?.message_key ?? null,
        fixer: wording?.fixer ?? null,
        app_name: wording?.app_name ?? null,
      },
      compare: {},
      idempotency_key: `declare-${++keySerial}`,
      prepared: [],
    }),
  );
  if (wording?.app_name !== undefined && app !== undefined) {
    value(
      await h.command(COLLECTOR, {
        command: "problems.testing.set-app-name",
        input: { app, name: wording.app_name },
        compare: {},
        idempotency_key: `app-name-${++keySerial}`,
        prepared: [],
      }),
    );
  }
}

type Summary = {
  id: string;
  app: string;
  status: string;
  symptom: string;
  next_action: string | null;
  seq: string;
};
type Listed = { problems: Summary[]; next_cursor: string | null };

async function list(
  h: LedgerHarness,
  input: unknown = {},
  ctx: AuthenticatedContext = reader(),
): Promise<Result<Listed>> {
  return await h.read(
    { resource: "problems", method: "list" },
    ctx,
    input,
  ) as Result<Listed>;
}

async function get(
  h: LedgerHarness,
  route: string,
  input: unknown,
  ctx: AuthenticatedContext = reader(),
): Promise<Result<Record<string, unknown>>> {
  return await h.read(
    { resource: "problems", method: route },
    ctx,
    input,
  ) as Result<Record<string, unknown>>;
}

const NEWER_RELEASE = "rel_01arz3ndektsv4rrffq69g5faw";
const TICKET = "tkt_01arz3ndektsv4rrffq69g5fav";
const CLOSURE = JSON.stringify({
  reason: "dismissed",
  basis_seq: "1",
  release: null,
  verification: null,
  confirmation: "confirmation-1",
  last_report: null,
  note: "not needed",
});

Deno.test("problems/grouping#R11: 목록은 앱과 진행으로 찾고 기본 항목은 앱·증상·진행·다음 행동뿐이다", async () => {
  const h = await open();
  try {
    const exception = await record(h, { serial: 1 });
    const declared = await record(h, { serial: 2, kind: "declared" });
    const other = await record(h, { serial: 3, app: APP_B });
    await arrange(h, declared, { status: "closed", closure: CLOSURE });
    await arrange(h, other, { status: "fixing", work: TICKET });

    const all = value(await list(h));
    assertEquals(
      all.problems.map((item) => item.id).sort(),
      [
        exception,
        declared,
        other,
      ].sort(),
    );
    for (const item of all.problems) {
      // claim·기한·연결 식별자·보고 수·시각은 기본 항목에 없다.
      assertEquals(Object.keys(item).sort(), [
        "app",
        "id",
        "next_action",
        "seq",
        "status",
        "symptom",
      ]);
    }
    const byApp = value(await list(h, { app: APP_A }));
    assertEquals(byApp.problems.length, 2);
    assert(byApp.problems.every((item) => item.app === APP_A));
    for (const status of ["open", "fixing", "closed"]) {
      const found = value(await list(h, { status }));
      assertEquals(found.problems.length, 1);
      assertEquals(found.problems[0].status, status);
    }
    const scoped = value(await list(h, { app: APP_A, status: "closed" }));
    assertEquals(scoped.problems.map((item) => item.id), [declared]);
    // 가장 최근에 바뀐 문제가 앞이다.
    assertEquals(all.problems[0].id, other);
    assertEquals(all.next_cursor, null);
  } finally {
    await h.close();
  }
});

Deno.test("problems/grouping#R11: cursor와 limit(최대 100)은 seq로 page를 고정한다", async () => {
  const h = await open();
  try {
    const first: string[] = [];
    for (let serial = 1; serial <= 5; serial++) {
      first.push(await record(h, { serial }));
    }
    const page1 = value(await list(h, { limit: 2 }));
    assertEquals(page1.problems.length, 2);
    assert(page1.next_cursor !== null);
    // 첫 page 뒤 오래된 문제에 새 보고가 오고 새 문제도 생긴다.
    const oldest = first[0];
    await record(h, {
      serial: 6,
      kind: "exception",
      discriminator: rpt(1),
    });
    const fresh = await record(h, { serial: 7 });
    const page2 = value(
      await list(h, { limit: 2, cursor: page1.next_cursor }),
    );
    assert(page2.next_cursor !== null);
    const page3 = value(
      await list(h, { limit: 2, cursor: page2.next_cursor }),
    );
    assertEquals(page3.next_cursor, null);
    const seen = [...page1.problems, ...page2.problems, ...page3.problems]
      .map((item) => item.id);
    // 처음 시점의 문제 5개가 빠짐없이 한 번씩 나오고 그 뒤 생긴 문제는 이 묶음에 없다.
    assertEquals(seen.length, 5);
    assertEquals(new Set(seen), new Set(first));
    assert(!seen.includes(fresh));
    assert(seen.includes(oldest));
    // 새 호출은 새 변경을 본다.
    const again = value(await list(h, {}));
    assertEquals(again.problems.length, 6);
    assertEquals(again.problems[0].id, fresh);

    failure(await list(h, { limit: 101 }), "invalid_input");
    failure(await list(h, { limit: 0 }), "invalid_input");
    failure(await list(h, { cursor: "garbage" }), "invalid_input");
    failure(await list(h, { cursor: "999999:1" }), "invalid_input");
  } finally {
    await h.close();
  }
});

Deno.test("problems/grouping#R11 R12: 상세는 진행을 먼저 주고 보고 수와 처음·최근 시각은 Report에서 센다", async () => {
  const h = await open();
  try {
    const problem = await record(h, {
      serial: 1,
      kind: "declared",
      observedAt: "2026-10-04T12:00:01.000Z",
      release: RELEASE,
    });
    await record(h, {
      serial: 2,
      kind: "declared",
      observedAt: "2026-10-04T12:00:09.000Z",
      release: NEWER_RELEASE,
    });
    await record(h, {
      serial: 3,
      kind: "declared",
      observedAt: "2026-10-04T12:00:05.000Z",
    });
    // 같은 앱의 preview 보고는 운영 수와 시각에 들어가지 않는다.
    await record(h, {
      serial: 4,
      kind: "declared",
      mode: "preview",
      scope: "preview-1",
      observedAt: "2026-10-04T12:30:00.000Z",
    });
    const detail = value(await get(h, "get", { problem }));
    assertEquals(detail["report_count"], 3);
    assertEquals(detail["first_observed_at"], "2026-10-04T12:00:01.000Z");
    assertEquals(detail["last_observed_at"], "2026-10-04T12:00:09.000Z");
    // 당시 release는 처음·최근 보고의 것이다. 중간 보고의 release가 끼지 않는다.
    assertEquals(detail["first_release"], RELEASE);
    assertEquals(detail["last_release"], NEWER_RELEASE);
    const shown = detail["problem"] as Record<string, unknown>;
    assertEquals(shown["status"], "open");
    assertEquals(shown["work"], null);
    assertEquals(shown["closure"], null);
    // 변경 seq는 그 문제의 마지막 event이고 목록의 seq와 같다.
    const listed = value(await list(h));
    assertEquals(listed.problems.length, 1);
    assertEquals(shown["seq"], listed.problems[0].seq);
    // 수를 담은 별도 counter 열이 없다.
    const columns = value(
      await h.inspect("select name from pragma_table_info('problems')"),
    ).map((row) => String(row.name));
    assertEquals(columns.filter((name) => /count|total|occurr/.test(name)), []);
    // claim·기한·연결 식별자 field는 없다.
    const text = JSON.stringify(detail);
    for (const word of ["claim", "deadline", "expires", "connection"]) {
      assert(!text.includes(word), word);
    }

    // fixing은 담당 ticket을, closed는 닫힘 근거를 같은 상세에서 준다.
    await arrange(h, problem, { status: "fixing", work: TICKET });
    const fixing = value(await get(h, "get", { problem }));
    assertEquals(
      (fixing["problem"] as Record<string, unknown>)["status"],
      "fixing",
    );
    await arrange(h, problem, { status: "closed", closure: CLOSURE });
    const closed = value(await get(h, "get", { problem }));
    const closedProblem = closed["problem"] as Record<string, unknown>;
    assertEquals(closedProblem["status"], "closed");
    assertEquals(
      (closedProblem["closure"] as Record<string, unknown>)["reason"],
      "dismissed",
    );
    // 닫힌 문제도 같은 key로 계속 읽히고 보고 수는 그대로다.
    assertEquals(closed["report_count"], 3);
  } finally {
    await h.close();
  }
});

Deno.test("problems/problem-codes#R6: 예약 3종은 catalog en 그대로 별개로 나오고 선언 문구를 읽을 수 없으면 확인할 문제 안내다", async () => {
  const h = await open();
  try {
    const exception = await record(h, { serial: 1 });
    const feedback = await record(h, { serial: 2, kind: "feedback" });
    const invalid = await record(h, { serial: 3, kind: "invalid_report" });
    const declared = await record(h, { serial: 4, kind: "declared" });
    const listed = value(await list(h));
    const symptom = (id: string) =>
      listed.problems.find((item) => item.id === id)!.symptom;
    const message = (code: string) =>
      RESERVED_PROBLEM_CODES.find((item) => item.code === code)!.message;
    assertEquals(symptom(exception), message("_exception"));
    assertEquals(symptom(feedback), message("_feedback"));
    assertEquals(symptom(invalid), message("_invalid_report"));
    assertEquals(
      new Set([exception, feedback, invalid].map(symptom)).size,
      3,
    );
    // 선언 문구는 당시 release 선언을 읽는 작업이 채운다. 그 전에는 확인할 문제 안내이고
    // 예약 문구나 raw code가 아니다.
    const fallback = symptom(declared);
    assert(/problem to check/i.test(fallback), fallback);
    assert(!fallback.includes("payment_declined"));
    for (const code of ["_exception", "_feedback", "_invalid_report"]) {
      assertNotEquals(fallback, message(code));
    }
    const detail = value(await get(h, "get", { problem: feedback }));
    assertEquals(detail["text"], message("_feedback"));
  } finally {
    await h.close();
  }
});

Deno.test("problems/grouping#R5: 보고와 원인 가설은 다른 field이고 묶였다는 사실은 원인 확정이 아니다", async () => {
  const h = await open();
  try {
    const problem = await record(h, { serial: 1 });
    await record(h, { serial: 2, discriminator: rpt(1) });
    await arrange(h, problem, {
      status: "open",
      interpretation: {
        version: "ver_01arz3ndektsv4rrffq69g5fav",
        section: "cause",
      },
    });
    const detail = value(await get(h, "get", { problem }));
    const shown = detail["problem"] as Record<string, unknown>;
    // 가설은 해석 참조 field에만 있고 보고 목록에는 섞이지 않는다.
    assertEquals(shown["interpretation"], {
      version: "ver_01arz3ndektsv4rrffq69g5fav",
      section: "cause",
    });
    const reports = value(await get(h, "list-reports", { problem })) as {
      reports: Record<string, unknown>[];
    };
    assertEquals(reports.reports.length, 2);
    for (const report of reports.reports) {
      assertEquals(
        Object.keys(report).filter((name) =>
          /cause|hypothesis|interpretation/.test(name)
        ),
        [],
      );
    }
    // 원인이 확정됐다는 field가 상세 어디에도 없다.
    assert(
      !/root_cause|confirmed_cause|same_cause/.test(JSON.stringify(detail)),
    );
  } finally {
    await h.close();
  }
});

Deno.test("problems/reporting#R15: 보고한 앱 범위에서 목록 → 상세 → 보고 → snapshot 순서로 읽히고 범위 밖은 없는 것과 같다", async () => {
  const scoped = reader({
    credential_ref: "cred-app-a",
    scope: { operations: ALL_READS, targets: { app: APP_A } },
    conditions: { app: APP_A },
  });
  const h = await open(scoped);
  try {
    const mine = await record(h, { serial: 1 });
    const theirs = await record(h, { serial: 2, app: APP_B });

    const listed = value(await list(h, {}, scoped));
    assertEquals(listed.problems.map((item) => item.id), [mine]);
    // 다른 앱 필터도 빈 목록이다. 없는 앱과 구별되지 않는다.
    assertEquals(value(await list(h, { app: APP_B }, scoped)).problems, []);

    const detail = value(await get(h, "get", { problem: mine }, scoped));
    assertEquals(
      (detail["problem"] as Record<string, unknown>)["id"],
      mine,
    );
    const reports = value(
      await get(h, "list-reports", { problem: mine }, scoped),
    ) as { reports: { id: string; snapshot: string }[] };
    assertEquals(reports.reports.map((item) => item.id), [rpt(1)]);
    const report = value(
      await get(h, "get-report", { report: rpt(1) }, scoped),
    );
    assertEquals(
      (report["report"] as Record<string, unknown>)["problem"],
      mine,
    );
    const evidence = value(
      await get(h, "get-snapshot", { snapshot: snp(1), item: "error" }, scoped),
    );
    assertEquals(
      (evidence["item"] as Record<string, unknown>)["name"],
      "TypeError",
    );

    // 범위 밖 대상은 없는 대상과 같은 not_found이고 문구도 같다.
    const absent = "prb_01arz3ndektsv4rrffq69g5faz";
    assertEquals(
      failure(await get(h, "get", { problem: theirs }, scoped), "not_found"),
      failure(await get(h, "get", { problem: absent }, scoped), "not_found"),
    );
    assertEquals(
      failure(
        await get(h, "get-report", { report: rpt(2) }, scoped),
        "not_found",
      ),
      failure(
        await get(h, "get-report", { report: rpt(30) }, scoped),
        "not_found",
      ),
    );
    assertEquals(
      failure(
        await get(h, "get-snapshot", { snapshot: snp(2) }, scoped),
        "not_found",
      ),
      failure(
        await get(h, "get-snapshot", { snapshot: snp(30) }, scoped),
        "not_found",
      ),
    );
    assertEquals(
      (value(
        await get(h, "list-reports", { problem: theirs }, scoped),
      ) as { reports: unknown[] }).reports,
      [],
    );
    // 같은 자격이 아닌 넓은 자격은 둘 다 읽는다.
    assertEquals(value(await list(h)).problems.length, 2);
  } finally {
    await h.close();
  }
});

Deno.test("problems/reporting#R4 problems/grouping#R7: test·preview 진단은 해당 scope로만 list-reports에 나오고 운영 집계에 들어가지 않는다", async () => {
  const preview = reader({
    credential_ref: "cred-preview",
    scope: { operations: ALL_READS, targets: {} },
    conditions: { diagnostic_scope: "preview-1" },
  });
  const h = await open(preview);
  try {
    const problem = await record(h, { serial: 1, kind: "declared" });
    await record(h, {
      serial: 2,
      kind: "declared",
      mode: "preview",
      scope: "preview-1",
    });
    await record(h, {
      serial: 3,
      kind: "declared",
      mode: "test",
      scope: "test-1",
    });

    const previewList = value(
      await get(h, "list-reports", {
        app: APP_A,
        diagnostic_scope: "preview-1",
      }),
    ) as { reports: { id: string; mode: string; problem: null }[] };
    assertEquals(previewList.reports.map((item) => [item.id, item.mode]), [
      [rpt(2), "preview"],
    ]);
    assertEquals(previewList.reports[0].problem, null);
    const testList = value(
      await get(h, "list-reports", { app: APP_A, diagnostic_scope: "test-1" }),
    ) as { reports: { id: string; mode: string }[] };
    assertEquals(testList.reports.map((item) => [item.id, item.mode]), [
      [rpt(3), "test"],
    ]);
    // 없는 scope는 빈 목록이다.
    assertEquals(
      (value(
        await get(h, "list-reports", {
          app: APP_A,
          diagnostic_scope: "nobody",
        }),
      ) as { reports: unknown[] }).reports,
      [],
    );

    // 문제 기준 목록과 문제 수·상세에는 운영 보고 하나뿐이다.
    const byProblem = value(await get(h, "list-reports", { problem })) as {
      reports: { id: string }[];
    };
    assertEquals(byProblem.reports.map((item) => item.id), [rpt(1)]);
    const listed = value(await list(h));
    assertEquals(listed.problems.length, 1);
    const detail = value(await get(h, "get", { problem }));
    assertEquals(detail["report_count"], 1);

    // preview scope credential은 다른 scope의 진단을 없는 것처럼 본다.
    assertEquals(
      (value(
        await get(h, "list-reports", {
          app: APP_A,
          diagnostic_scope: "test-1",
        }, preview),
      ) as { reports: unknown[] }).reports,
      [],
    );
    failure(
      await get(h, "get-report", { report: rpt(3) }, preview),
      "not_found",
    );
    const own = value(
      await get(h, "list-reports", {
        app: APP_A,
        diagnostic_scope: "preview-1",
      }, preview),
    ) as { reports: { id: string }[] };
    assertEquals(own.reports.map((item) => item.id), [rpt(2)]);
  } finally {
    await h.close();
  }
});

Deno.test("problems/reporting#R7: 일반 응답과 오류 응답에 raw stack·code가 없고 수리 조회 권한에서만 상세를 준다", async () => {
  const general = reader({
    credential_ref: "cred-general",
    scope: { operations: ["ListProblems", "GetProblem"], targets: {} },
  });
  const h = await open(general);
  try {
    await record(h, { serial: 1 });
    const problem = await record(h, { serial: 2, kind: "declared" });

    // 일반 목록에는 stack·hash·오류 message·raw code가 없다.
    const listed = JSON.stringify(value(await list(h, {}, general)));
    for (const secret of [STACK_HASH, ERROR_MESSAGE, "payment_declined"]) {
      assert(!listed.includes(secret), secret);
    }
    const detail = JSON.stringify(
      value(await get(h, "get", { problem }, general)),
    );
    for (const secret of [STACK_HASH, ERROR_MESSAGE, "stack"]) {
      assert(!detail.includes(secret), secret);
    }

    // 수리 조회(보고·snapshot)는 그 operation을 가진 credential만 읽는다.
    failure(
      await get(h, "get-report", { report: rpt(1) }, general),
      "forbidden",
    );
    failure(
      await get(h, "get-snapshot", { snapshot: snp(1) }, general),
      "forbidden",
    );
    failure(
      await get(h, "list-reports", { problem }, general),
      "forbidden",
    );
    const repair = value(await get(h, "get-report", { report: rpt(1) }));
    const error = (repair["snapshot"] as Record<string, unknown>)["error"] as {
      stack: string;
      message: string;
    };
    // stack은 원문이 아니라 hash 참조이고 blob 원문은 이 read에 없다.
    assertEquals(error.stack, STACK_HASH);
    assertEquals(error.message, ERROR_MESSAGE);
    assert(!JSON.stringify(repair).includes("at pay"));

    // 오류 응답은 요청한 ID·저장 내용·stack을 되풀이하지 않는다.
    const errors = [
      failure(
        await get(h, "get", { problem: rpt(1) }, general),
        "invalid_input",
      ),
      failure(
        await get(h, "get", { problem: "prb_01arz3ndektsv4rrffq69g5faz" }),
        "not_found",
      ),
      failure(await list(h, { cursor: "x" }), "invalid_input"),
      failure(
        await get(h, "get-report", { report: rpt(1) }, general),
        "forbidden",
      ),
    ];
    for (const body of errors) {
      for (
        const secret of [
          STACK_HASH,
          ERROR_MESSAGE,
          "payment_declined",
          "prb_01arz3ndektsv4rrffq69g5faz",
          "select ",
          "stack",
        ]
      ) {
        assert(!body.includes(secret), `${secret} in ${body}`);
      }
    }
  } finally {
    await h.close();
  }
});

Deno.test("problems/reporting#R15: scope target(app·problem)으로 좁힌 credential은 범위 밖 행을 건너뛰고 page를 채운다", async () => {
  const appOnly = reader({
    credential_ref: "cred-target-app",
    scope: { operations: ALL_READS, targets: { app: APP_A } },
    conditions: { app: APP_A },
  });
  const noOperation = reader({
    credential_ref: "cred-no-op",
    scope: { operations: ["GetProblem"], targets: {} },
  });
  const oneProblem = reader({
    credential_ref: "cred-target-problem",
    scope: { operations: ALL_READS, targets: {} },
  });
  const h = await open(appOnly, noOperation);
  try {
    const mine = await record(h, { serial: 1 });
    // 더 최근인 다른 앱 문제가 먼저 훑이지만 범위 밖이라 건너뛴다.
    for (let serial = 2; serial <= 6; serial++) {
      await record(h, { serial, app: APP_B });
    }
    const page = value(await list(h, { limit: 1 }, appOnly));
    assertEquals(page.problems.map((item) => item.id), [mine]);
    assertEquals(page.next_cursor, null);
    // scope target이 problem 하나면 그 문제와 보고만 읽힌다.
    oneProblem.scope.targets = { problem: mine };
    value(await h.setCredential(oneProblem));
    assertEquals(
      value(await list(h, {}, oneProblem)).problems.map((item) => item.id),
      [mine],
    );
    const reports = value(
      await get(h, "list-reports", { problem: mine }, oneProblem),
    ) as { reports: { id: string }[] };
    assertEquals(reports.reports.map((item) => item.id), [rpt(1)]);
    failure(
      await get(h, "get-report", { report: rpt(2) }, oneProblem),
      "not_found",
    );
    // operation이 scope에 없으면 대상이 있어도 forbidden이다.
    failure(await list(h, {}, noOperation), "forbidden");
    failure(
      await get(h, "list-reports", { problem: mine }, noOperation),
      "forbidden",
    );
    const allowed = value(await get(h, "get", { problem: mine }, noOperation));
    assertEquals((allowed["problem"] as { id: string }).id, mine);
  } finally {
    await h.close();
  }
});

Deno.test("problems/reporting#R15: list-reports는 접수 seq 내림차순이고 cursor는 마지막 seq 아래부터 잇는다", async () => {
  const h = await open();
  try {
    const problem = await record(h, { serial: 1, kind: "declared" });
    await record(h, { serial: 2, kind: "declared" });
    await record(h, { serial: 3, kind: "declared" });
    const all = value(await get(h, "list-reports", { problem })) as {
      reports: { id: string }[];
      next_cursor: string | null;
    };
    assertEquals(all.reports.map((item) => item.id), [rpt(3), rpt(2), rpt(1)]);
    assertEquals(all.next_cursor, null);
    const seqs = value(
      await h.inspect(
        "select cast(seq as text) as seq from events where type = 'ReportRecorded' order by seq",
      ),
    );
    // 두 번째 보고의 seq를 cursor로 주면 그보다 오래된 것만 나온다.
    const older = value(
      await get(h, "list-reports", { problem, cursor: String(seqs[1].seq) }),
    ) as { reports: { id: string }[] };
    assertEquals(older.reports.map((item) => item.id), [rpt(1)]);
    failure(
      await get(h, "list-reports", { problem, cursor: "not-a-seq" }),
      "invalid_input",
    );
  } finally {
    await h.close();
  }
});

Deno.test("problems/reporting#R3 problems/grouping#R1: 같은 key의 두 번째 live 보고는 같은 문제에 ProblemObserved로 접수되고 목록 seq가 앞선다", async () => {
  const h = await open();
  try {
    const first = await record(h, { serial: 1, kind: "declared" });
    const other = await record(h, {
      serial: 2,
      kind: "declared",
      code: "other",
    });
    const again = await record(h, { serial: 3, kind: "declared" });
    assertEquals(again, first);
    assertNotEquals(other, first);
    const events = value(
      await h.inspect(
        "select type from events where subject = ? order by seq",
        [first],
      ),
    ).map((row) => String(row.type));
    assertEquals(events, ["ProblemOpened", "ProblemObserved"]);
    // 다시 관측된 문제가 가장 최근 변경으로 목록 맨 앞에 온다.
    const listed = value(await list(h));
    assertEquals(listed.problems.map((item) => item.id), [first, other]);
  } finally {
    await h.close();
  }
});

Deno.test("problems/problem-codes#R4: 선언 문제의 증상은 보고 당시 release의 선언 문구다; 새 release에서 바꾸거나 지워도 이전 보고는 당시 문구다", async () => {
  const h = await open();
  try {
    // 보고 당시 release(fixture RELEASE)의 선언 문구를 먼저 정한다.
    await declare(h, RELEASE, "payment_declined", {
      message: "The card was declined by the issuer.",
      message_key: "app-detail.issue.payment_declined",
      fixer: "coding_agent",
      app_name: "Ledger Desk",
    }, APP_A);
    const problem = await record(h, {
      serial: 1,
      kind: "declared",
      code: "payment_declined",
      release: RELEASE,
    });
    const detail = value(await get(h, "get", { problem }));
    assertEquals(detail["text"], "The card was declined by the issuer.");

    // 새 release에서 선언을 바꾼다. 이전 보고의 release는 그대로다.
    await declare(h, NEWER_RELEASE, "payment_declined", {
      message: "Payment needs a different card.",
      message_key: "app-detail.issue.payment_declined",
      fixer: "coding_agent",
    });
    assertEquals(
      value(await get(h, "get", { problem }))["text"],
      "The card was declined by the issuer.",
    );
    const listed = value(await list(h));
    assertEquals(
      listed.problems.find((item) => item.id === problem)!.symptom,
      "The card was declined by the issuer.",
    );
    assertEquals(
      listed.problems.find((item) => item.id === problem)!.next_action,
      null,
    );

    // 보고했던 release의 당시 선언을 지운다. 선언을 읽을 수 없으므로 앱 이름과
    // fallback 안내다(R4).
    await declare(h, RELEASE, "payment_declined", null);
    const fallback = value(await get(h, "get", { problem }))["text"] as string;
    assert(/problem to check/i.test(fallback), fallback);
    assertEquals(fallback, "There is a problem to check in Ledger Desk.");
    assertEquals(
      value(await list(h)).problems.find((item) => item.id === problem)!
        .symptom,
      "There is a problem to check in Ledger Desk.",
    );
  } finally {
    await h.close();
  }
});

Deno.test("problems/problem-codes#R4: 보고했던 당시 선언을 읽을 수 없으면 앱 이름과 확인할 문제 안내다", async () => {
  const h = await open();
  try {
    await declare(h, RELEASE, "payment_declined", {
      message: "The card was declined by the issuer.",
      app_name: "Ledger Desk",
    }, APP_A);
    const problem = await record(h, {
      serial: 1,
      kind: "declared",
      code: "payment_declined",
      release: RELEASE,
    });
    // 당시 선언이 있을 때는 당시 문구다.
    assertEquals(
      value(await get(h, "get", { problem }))["text"],
      "The card was declined by the issuer.",
    );
    // 당시 선언을 지운다(선언을 읽을 수 없는 상태). fallback에 앱 이름이 붙는다.
    await declare(h, RELEASE, "payment_declined", null);
    const fallback = value(await get(h, "get", { problem }))["text"] as string;
    assert(/problem to check/i.test(fallback), fallback);
    assertEquals(fallback, "There is a problem to check in Ledger Desk.");
    assertEquals(
      value(await list(h)).problems.find((item) => item.id === problem)!
        .symptom,
      "There is a problem to check in Ledger Desk.",
    );

    // release를 모르는 보고는 이름 없는 fallback이다.
    const noRelease = await record(h, {
      serial: 2,
      kind: "declared",
      code: "payment_declined",
      release: null,
    });
    assertEquals(
      value(await get(h, "get", { problem: noRelease }))["text"],
      "There is a problem to check in this app.",
    );
  } finally {
    await h.close();
  }
});

Deno.test("problems/problem-codes#R4: 당시 선언의 fixer가 user이면 목록의 다음 행동에 사람이 할 일을 채운다", async () => {
  const h = await open();
  try {
    await declare(h, RELEASE, "payment_declined", {
      message: "The card was declined by the issuer.",
      fixer: "user",
    });
    await declare(h, RELEASE, "quota_exceeded", {
      message: "The app's storage quota is full.",
      fixer: "coding_agent",
    });
    const userProblem = await record(h, {
      serial: 1,
      kind: "declared",
      code: "payment_declined",
      release: RELEASE,
    });
    const agentProblem = await record(h, {
      serial: 2,
      kind: "declared",
      code: "quota_exceeded",
      release: RELEASE,
    });
    const listed = value(await list(h));
    const first = listed.problems.find((item) => item.id === userProblem)!;
    const second = listed.problems.find((item) => item.id === agentProblem)!;
    assertEquals(first.symptom, "The card was declined by the issuer.");
    assertEquals(
      first.next_action,
      "Adjust the app's settings or input for this problem.",
    );
    assertEquals(second.symptom, "The app's storage quota is full.");
    assertEquals(second.next_action, null);
    // 상세 문구는 목록과 같다.
    assertEquals(
      value(await get(h, "get", { problem: userProblem }))["text"],
      first.symptom,
    );
  } finally {
    await h.close();
  }
});

Deno.test("problems/grouping#R11: 문제 목록의 기본 항목(앱·증상·진행·다음 행동)에 당시 선언 문구가 들어간다", async () => {
  const h = await open();
  try {
    await declare(h, RELEASE, "payment_declined", {
      message: "The card was declined by the issuer.",
      fixer: "user",
      app_name: "Ledger Desk",
    }, APP_A);
    await declare(h, RELEASE, "sync_failed", {
      message: "The external calendar could not be reached.",
      fixer: "coding_agent",
      app_name: "Calendar Sync",
    }, APP_B);
    const mine = await record(h, {
      serial: 1,
      kind: "declared",
      code: "payment_declined",
      release: RELEASE,
    });
    const theirs = await record(h, {
      serial: 2,
      app: APP_B,
      kind: "declared",
      code: "sync_failed",
      release: RELEASE,
    });

    const byApp = value(await list(h, { app: APP_A }));
    assertEquals(byApp.problems.length, 1);
    const item = byApp.problems[0];
    assertEquals(item.id, mine);
    // 기본 항목은 앱·증상·진행·다음 행동뿐이고 당시 선언 문구가 증상이다.
    assertEquals(Object.keys(item).sort(), [
      "app",
      "id",
      "next_action",
      "seq",
      "status",
      "symptom",
    ]);
    assertEquals(item.app, APP_A);
    assertEquals(item.status, "open");
    assertEquals(item.symptom, "The card was declined by the issuer.");
    assertEquals(
      item.next_action,
      "Adjust the app's settings or input for this problem.",
    );

    // 두 앱의 문제가 서로의 당시 선언을 섞지 않는다.
    const all = value(await list(h));
    assertEquals(
      all.problems.find((entry) => entry.id === theirs)!.symptom,
      "The external calendar could not be reached.",
    );
    assertEquals(
      all.problems.find((entry) => entry.id === theirs)!.next_action,
      null,
    );
    // 펼친 상세도 같은 당시 문구를 읽는다(grouping#R11).
    assertEquals(
      value(await get(h, "get", { problem: theirs }))["text"],
      "The external calendar could not be reached.",
    );
  } finally {
    await h.close();
  }
});
