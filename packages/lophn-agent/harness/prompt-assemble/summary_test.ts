import { assert, assertEquals } from "@std/assert";
import type { Result } from "../../../../packages/base/mod.ts";
import type { SqlRow } from "../../../../packages/contracts/platform/mod.ts";
import {
  createLedgerHarness,
  type LedgerHarness,
} from "../../../../apps/core/testing/ledger.ts";
import { envelope, presetDefinitionJson } from "../run-loop/testing/mod.ts";
import {
  assertsNoPreferenceGeneralization,
  clampSummaryText,
  CONTINUATION_RESHRINK_MAX,
  latestContinuationSummary,
  summaryBodyHash,
  summaryBodyTokens,
  type SummaryParts,
  type SummaryRef,
} from "./mod.ts";
import {
  cred,
  hashOf,
  id,
  textContent,
} from "../../conversation/testing/mod.ts";

// 이어가기 summary 테스트(R19–R23)와 conversation#R9–R11 ledger 테스트다. 실제
// provider를 부르지 않는다. prompt-assemble의 순수 준비는 summary.ts가 하고,
// 이어가기를 ledger에 남기는 색인·종료는 conversation 명령이 한다.

const NOW = Date.UTC(2026, 0, 1);

const userCred = cred("user");
const machineCred = cred("machine");
const ASG_LOPHN = id("asg", 1);
const SES = id("ses", 1);
const SES_NEXT = id("ses", 2);
const MSG = id("msg", 1);
const MSG_NEXT = id("msg", 2);
const BASIS = "b".repeat(64);
const RESULT = "c".repeat(64);
const LIMITS = { model_attempts: 30, stall_ms: 300_000, active_ms: 1_800_000 };

const agentOf = (assignment: string) => cred(`agent:${assignment}`);

function value<T>(result: Result<T>): T {
  assert(result.ok, result.ok ? undefined : JSON.stringify(result.error));
  return result.value;
}

async function code(result: Promise<Result<unknown>>, expected: string) {
  const settled = await result;
  if (settled.ok) {
    assert(false, "expected failure, got " + JSON.stringify(settled.value));
  } else {
    assertEquals(settled.error.code, expected);
  }
}

async function sql(
  h: LedgerHarness,
  query: string,
  params: readonly (string | number | bigint)[] = [],
): Promise<SqlRow[]> {
  return value(await h.inspect(query, params));
}

const AT_1 = "2026-01-01T00:00:00.000Z";
const AT_2 = "2026-01-02T00:00:00.000Z";
const AT_3 = "2026-01-03T00:00:00.000Z";

function partsOf(): SummaryParts {
  return {
    purpose: "목적이다",
    decisions_constraints: "결정이다",
    progress_evidence: "근거다",
    incomplete: "",
    failures_next: "",
    estimations_uncertainty: "추정이다",
  };
}

function summaryOf(
  session: string,
  at: string,
  through_seq: bigint,
  kind: "continuation" | "compaction" = "continuation",
): SummaryRef {
  return {
    kind,
    session: kind === "continuation" ? session : null,
    run: kind === "compaction" ? "run_1" : null,
    from_seq: 1n,
    through_seq,
    created_at: at,
    summary_call: "mcl_1",
    body_hash: "h1",
    rule_version: "compaction.1",
    references: [],
    parts: partsOf(),
  };
}

Deno.test("lophn-agent/harness/prompt-assemble#R19: summary는 derived 재료로 원문 구간·call·본문 hash·생성 시각을 연결한다", async () => {
  const body_hash = await summaryBodyHash("이어가기 본문");
  const ref: SummaryRef = {
    kind: "continuation",
    session: "ses_1",
    run: null,
    from_seq: 2n,
    through_seq: 9n,
    created_at: AT_1,
    summary_call: "mcl_3",
    body_hash,
    rule_version: "compaction.1",
    references: [{ address: "doc_1", version: "ver_1" }],
    parts: partsOf(),
  };
  // 원문을 대체하지 않는다: 구간은 from ≤ through고 본문 hash만 남는다.
  assertEquals(ref.from_seq <= ref.through_seq, true);
  assertEquals(ref.body_hash, body_hash);
  assert(ref.body_hash !== "이어가기 본문");
  // 정정은 이전을 덮지 않고 새 근거로 남는다: 최신 완성본 하나를 고르는 규칙이
  // 옛 것을 지우지 않는지의 확인이다.
  const summaries = [
    summaryOf("ses_1", AT_1, 9n),
    summaryOf("ses_1", AT_2, 12n),
  ];
  assertEquals(latestContinuationSummary(summaries, "ses_1")?.through_seq, 12n);
  assertEquals(summaries.length, 2);
});

Deno.test("lophn-agent/harness/prompt-assemble#R20: 이어가기 본문은 400 token 안이면 그대로 쓴다", () => {
  // token 상한은 UTF-8 byte라 한글 300자는 900 byte다.
  assertEquals(summaryBodyTokens("가".repeat(300)), 900);
  const within = clampSummaryText("가".repeat(100), 1);
  assertEquals(within.status, "within");
});

Deno.test("lophn-agent/harness/prompt-assemble#R20: 401 token은 저장된 완성 summary로 쓰지 않고 문장 경계에서 다시 줄인다", () => {
  // 문장 두 개로 이뤄진 401 token 넘는 본문이다.
  const over = `첫 문장이다. ${"가".repeat(300)}`;
  assert(summaryBodyTokens(over) > 400);
  const first = clampSummaryText(over, 1);
  // 다시 줄인 결과가 문장 중간이 아니다.
  if (first.status === "over") {
    assert(first.text !== null);
    assert(
      first.text.endsWith(".") || first.text.endsWith("!") ||
        first.text.endsWith("?"),
      "줄인 끝은 문장 끝이다",
    );
    assertEquals(over.startsWith(first.text), true);
  } else {
    assert(false, "expected over");
  }
  // 상한을 넘은 본문은 문장 경계가 없으면 못 줄인다.
  const noBoundary = "가".repeat(401);
  const stuck = clampSummaryText(noBoundary, 1);
  if (stuck.status === "over") {
    assertEquals(stuck.text, null);
  } else {
    assert(false, "expected over");
  }
});

Deno.test("lophn-agent/harness/prompt-assemble#R20: 재축소는 최대 2회다(질문 Q12)", () => {
  assertEquals(CONTINUATION_RESHRINK_MAX, 2);
  const over = `첫 문장이다. ${"가".repeat(300)}`;
  // 세 번째 시도는 원본을 내보내지 않는다.
  const third = clampSummaryText(over, CONTINUATION_RESHRINK_MAX + 1);
  if (third.status === "over") {
    assertEquals(third.text, null);
  } else {
    assert(false, "expected over");
  }
});

Deno.test("lophn-agent/harness/prompt-assemble#R21: summary는 사람 의도·추정·확인 근거·미정을 구별하고 일회 선호를 영구 취향으로 일반화하지 않는다", () => {
  // 여섯 부분이 구별돼 있다.
  const parts = partsOf();
  assertEquals(parts.purpose, "목적이다");
  assertEquals(parts.decisions_constraints, "결정이다");
  assertEquals(parts.progress_evidence, "근거다");
  assertEquals(parts.incomplete, "");
  assertEquals(parts.failures_next, "");
  assertEquals(parts.estimations_uncertainty, "추정이다");
  // 없는 내용은 없다고 쓴다(빈 문자열).
  assert(parts.incomplete === "");
  // 일회 선호를 영구 취향으로 일반화하지 않는다.
  const oneTime: SummaryParts = {
    ...partsOf(),
    decisions_constraints: "이번 한 번만 읽기다",
  };
  assertEquals(assertsNoPreferenceGeneralization(oneTime), true);
  // 영구 표현으로 바뀐 요약은 거른다.
  const generalized: SummaryParts = {
    ...partsOf(),
    decisions_constraints: "늘 읽기다",
  };
  assertEquals(assertsNoPreferenceGeneralization(generalized), false);
});

Deno.test("lophn-agent/harness/prompt-assemble#R23: 이어가기 재사용은 같은 세션의 최신 완성본 하나만 고른다", () => {
  const summaries = [
    summaryOf("ses_1", AT_1, 4n),
    summaryOf("ses_1", AT_2, 7n),
    summaryOf("ses_1", AT_3, 9n),
  ];
  const chosen = latestContinuationSummary(summaries, "ses_1");
  assertEquals(chosen?.created_at, AT_3);
  assertEquals(chosen?.through_seq, 9n);
  // 그 뒤 원문을 붙인다: 최신 완성본의 through_seq가 원문 시작점이다.
  assert(chosen !== null && chosen.kind === "continuation");
});

Deno.test("lophn-agent/harness/prompt-assemble#R23: 다른 세션·주기·handoff에 옛 요약을 자동 주입하지 않는다", () => {
  const summaries = [
    summaryOf("ses_1", AT_1, 4n),
    summaryOf("ses_2", AT_2, 7n),
  ];
  // 다른 세션을 지정하면 그 세션의 것만 고른다.
  const forSes2 = latestContinuationSummary(summaries, "ses_2");
  assertEquals(forSes2?.session, "ses_2");
  // 지정하지 않은 세션의 요약은 새 세션에 주입되지 않는다(고르지 않는다).
  const forSes3 = latestContinuationSummary(summaries, "ses_3");
  assertEquals(forSes3, null);
  // compaction summary는 continuation 재사용 대상이 아니다.
  const compactionOnly = [summaryOf("ses_1", AT_1, 4n, "compaction")];
  assertEquals(latestContinuationSummary(compactionOnly, "ses_1"), null);
});

// ---- conversation#R9–R11 ledger 테스트 ----

async function seed(h: LedgerHarness) {
  for (const kind of ["lophn", "context_engineer"]) {
    const definition = presetDefinitionJson(kind);
    value(
      await h.command(
        machineCred,
        envelope("RegisterDefaultPreset", {
          id: id("pst", kind.length),
          definition,
          definition_hash: hashOf(definition),
        }),
      ),
    );
  }
  value(
    await h.command(
      machineCred,
      envelope("CreateBuiltinAssignment", {
        id: ASG_LOPHN,
        preset: id("pst", 5),
        preset_revision: 1,
        role: "lophn",
        scope: { kind: "all", id: null },
      }),
    ),
  );
}

async function openSession(
  h: LedgerHarness,
  session: string,
  from: { session: string; through_seq: string } | null = null,
) {
  const current = (await sql(
    h,
    "select revision, state from assignments where id = ?",
    [ASG_LOPHN],
  ))[0]!;
  value(
    await h.command(
      userCred,
      envelope("OpenSession", {
        id: session,
        assignment: ASG_LOPHN,
        role: "lophn",
        work_place: { kind: "global", id: null },
        continued_from: from,
      }, {
        assignment_revision: Number(current["revision"]),
        assignment_state: String(current["state"]),
      }),
    ),
  );
}

async function sessionStateSeq(
  h: LedgerHarness,
  session: string,
): Promise<string> {
  const row = (await sql(
    h,
    "select cast(state_seq as text) as seq from sessions where id = ?",
    [session],
  ))[0]!;
  return String(row["seq"]);
}

async function closeSession(h: LedgerHarness, session: string, by = userCred) {
  return h.command(
    by,
    envelope("CloseSession", {
      session,
      reason: by === userCred ? "user_closed" : "assignment_withdrawn",
    }, {
      state_seq: await sessionStateSeq(h, session),
      state: "open",
    }),
  );
}

async function receiveMessage(
  h: LedgerHarness,
  message: string,
  session: string,
  text: string,
) {
  const current = await sessionStateSeq(h, session);
  const stored = (await sql(
    h,
    "select s.assignment as assignment from sessions s where s.id = ?",
    [session],
  ))[0]!;
  const current_revision = (await sql(
    h,
    "select revision, state from assignments where id = ?",
    [String(stored["assignment"])],
  ))[0]!;
  return h.command(
    userCred,
    envelope("ReceiveMessage", {
      id: message,
      session,
      content: textContent(text),
      mode: "request",
    }, {
      session_state: "open",
      session_state_seq: current,
      assignment_revision: Number(current_revision["revision"]),
      assignment_state: String(current_revision["state"]),
    }),
  );
}

async function count(
  h: LedgerHarness,
  query: string,
  params: readonly (string | number | bigint)[] = [],
): Promise<number> {
  return Number((await sql(h, query, params))[0]!["n"]);
}

// 접수가 만든 run을 끝낸다. 실행 중 run이 있으면 CloseSession이 거절한다.
async function runStateSeq(h: LedgerHarness, run: string): Promise<string> {
  const read = value(
    await h.read({ resource: "runs", method: "read" }, userCred, { run }),
  ) as { run: { state_seq: string } };
  return read.run.state_seq;
}

async function finishRun(h: LedgerHarness, run: string) {
  value(
    await h.command(
      machineCred,
      envelope("FinishRun", {
        run,
        outcome: { kind: "completed", reason: "answer_completed" },
        result: RESULT,
      }, { state_seq: await runStateSeq(h, run) }),
    ),
  );
}

async function messageRun(h: LedgerHarness, message: string): Promise<string> {
  const row = (await sql(
    h,
    "select run from messages where id = ?",
    [message],
  ))[0]!;
  assert(row["run"] !== null, "message has no run");
  return String(row["run"]);
}

async function startRun(h: LedgerHarness, run: string) {
  value(
    await h.command(
      machineCred,
      envelope("StartRun", {
        run,
        basis: BASIS,
        limits: LIMITS,
        scope: { role: "lophn", assignment: ASG_LOPHN, apps: [] },
      }, { state_seq: await runStateSeq(h, run) }),
    ),
  );
}

// 접수가 만든 run을 시작하고 마친다. 실행 중 run이 있으면 CloseSession이 거절하므로
// 접수마다 run을 마친다.
async function receiveAndFinish(
  h: LedgerHarness,
  message: string,
  session: string,
  text: string,
) {
  value(await receiveMessage(h, message, session, text));
  const run = await messageRun(h, message);
  await startRun(h, run);
  await finishRun(h, run);
}

// 요약 성공을 세션 종료 조건으로 삼지 않는다(conversation#R10). 종료는
// CloseSession 하나다. 요약 실패는 원문 그대로를 남긴다.
Deno.test("lophn-agent/conversation#R10: 요약 실패에도 세션이 종료되고 새 입력을 받지 않는다", async () => {
  const h = value(
    await createLedgerHarness({
      registrationModules: [
        new URL("../provider/registration_test.ts", import.meta.url),
        new URL("../usage/registration_test.ts", import.meta.url),
        new URL("../../conversation/registration_test.ts", import.meta.url),
      ],
      credentials: [userCred, machineCred, agentOf(ASG_LOPHN)],
      nowMs: NOW,
    }),
  );
  try {
    await seed(h);
    await openSession(h, SES);
    await receiveAndFinish(h, MSG, SES, "이전 대화다");
    // 요약을 만들지 않고 바로 종료한다(요약 성공을 종료 조건으로 삼지 않는다).
    value(await closeSession(h, SES));
    const row = (await sql(
      h,
      "select state from sessions where id = ?",
      [SES],
    ))[0]!;
    assertEquals(String(row["state"]), "closed");
    // 종료된 세션이 새 입력을 받지 않는다.
    await code(
      h.command(
        userCred,
        envelope("ReceiveMessage", {
          id: MSG_NEXT,
          session: SES,
          content: textContent("늦은 입력"),
          mode: "request",
        }, {
          session_state: "open",
          session_state_seq: "2",
          assignment_revision: 1,
          assignment_state: "enabled",
        }),
      ),
      "forbidden",
    );
  } finally {
    await h.close();
  }
});

// 이어가기는 원문 구간과 출처를 가리킨다(conversation#R9). 원문 메시지를 복제하지
// 않는다. 새 세션의 continued_from이 옛 세션·구간만 가리키는지 본다.
Deno.test("lophn-agent/conversation#R9: 이어가기 새 세션은 원문 구간을 가리키고 원문 메시지를 복제하지 않는다", async () => {
  const h = value(
    await createLedgerHarness({
      registrationModules: [
        new URL("../provider/registration_test.ts", import.meta.url),
        new URL("../usage/registration_test.ts", import.meta.url),
        new URL("../../conversation/registration_test.ts", import.meta.url),
      ],
      credentials: [userCred, machineCred, agentOf(ASG_LOPHN)],
      nowMs: NOW,
    }),
  );
  try {
    await seed(h);
    await openSession(h, SES);
    await receiveAndFinish(h, MSG, SES, "이전 대화다");
    await receiveAndFinish(h, MSG_NEXT, SES, "두 번째다");
    // 구간 끝은 두 번째 메시지의 created_seq다.
    const anchor = (await sql(
      h,
      "select cast(created_seq as text) as seq from messages where id = ?",
      [MSG_NEXT],
    ))[0]!;
    const through = String(anchor["seq"]);
    // 사람이 구간 끝을 지정해 새 세션을 이어서 연다.
    await openSession(h, SES_NEXT, { session: SES, through_seq: through });
    // 원문 메시지가 복제되지 않는다: 옛 메시지는 옛 세션에 그대로 있다.
    assertEquals(
      await count(
        h,
        "select count(*) as n from messages where session = ?",
        [SES],
      ),
      2,
    );
    assertEquals(
      await count(
        h,
        "select count(*) as n from messages where session = ?",
        [SES_NEXT],
      ),
      0,
    );
    // 새 세션은 출처(continued_from)를 가리킨다.
    const row = (await sql(
      h,
      "select continued_from_session, continued_from_through_seq from sessions where id = ?",
      [SES_NEXT],
    ))[0]!;
    assertEquals(String(row["continued_from_session"]), SES);
    assertEquals(Number(row["continued_from_through_seq"]), Number(through));
  } finally {
    await h.close();
  }
});

// 닫힌 세션을 늦은 notification으로 다시 활성화하지 않는다(conversation#R11).
Deno.test("lophn-agent/conversation#R11: 늦은 소식 뒤에도 세션은 닫힌 채다", async () => {
  const h = value(
    await createLedgerHarness({
      registrationModules: [
        new URL("../provider/registration_test.ts", import.meta.url),
        new URL("../usage/registration_test.ts", import.meta.url),
        new URL("../../conversation/registration_test.ts", import.meta.url),
      ],
      credentials: [userCred, machineCred, agentOf(ASG_LOPHN)],
      nowMs: NOW,
    }),
  );
  try {
    await seed(h);
    await openSession(h, SES);
    await receiveAndFinish(h, MSG, SES, "이전 대화다");
    value(await closeSession(h, SES));
    // 닫힌 세션에 늦은 입력(notification)이 와도 세션은 닫힌 채다.
    await code(
      h.command(
        userCred,
        envelope("ReceiveMessage", {
          id: MSG_NEXT,
          session: SES,
          content: textContent("늦은 소식"),
          mode: "request",
        }, {
          session_state: "open",
          session_state_seq: "2",
          assignment_revision: 1,
          assignment_state: "enabled",
        }),
      ),
      "forbidden",
    );
    const row = (await sql(
      h,
      "select state from sessions where id = ?",
      [SES],
    ))[0]!;
    assertEquals(String(row["state"]), "closed");
  } finally {
    await h.close();
  }
});
