// Claude Code 세션 시작 hook 시험이다(coding-agent/guides#R23, R24, R25; coding-agent#T35).
// summary 조립을 대역한 HookRead로 출력 상한·제외·timeout·장애 계약을 본다. 실제 Claude Code
// 실행과 사람의 ~/.claude는 쓰지 않는다.
import { assert, assertEquals } from "@std/assert";
import { err, ok, type Result } from "../../base/mod.ts";
import type { CodingAgentSessionSummary } from "../../protocol/coding-agent/mod.ts";
import {
  HOOK_CORE_WAIT_MS,
  HOOK_MAX_CODE_POINTS,
  HOOK_MAX_LINES,
  HOOK_MAX_PROBLEMS,
  HOOK_TOTAL_TIMEOUT_MS,
} from "../../protocol/coding-agent/mod.ts";
import {
  type HookFacts,
  renderHook,
  runSummaryHook,
  runSummaryHookBounded,
} from "./hook.ts";

const APP = "app_01h455vb4pex5v6nkc6gd5fdw1";
const CAC = "cac_01h455vb4pex5v6nkc6gd5fdw1";

function problem(
  patch: Record<string, unknown> = {},
): CodingAgentSessionSummary["problems"][number] {
  return {
    id: "prb_01h455vb4pex5v6nkc6gd5fdw1",
    app: APP,
    status: "open",
    symptom: "문제 증상",
    next_action: null,
    seq: "10",
    repair_state: "ready_to_hand_off",
    ...patch,
  } as CodingAgentSessionSummary["problems"][number];
}

function ticket(
  patch: Record<string, unknown> = {},
): CodingAgentSessionSummary["tickets"][number] {
  return {
    id: "tkt_01h455vb4pex5v6nkc6gd5fdw1",
    app: APP,
    kind: "repair",
    title: "ticket 제목",
    state: "open",
    readiness: "ready",
    problems: ["prb_01h455vb4pex5v6nkc6gd5fdw1"],
    ...patch,
  } as CodingAgentSessionSummary["tickets"][number];
}

// hook read의 성공 값이다. HookRead는 summary 자체를 받는다.
function theSummary(
  problems: CodingAgentSessionSummary["problems"],
  tickets: CodingAgentSessionSummary["tickets"],
  nextCursor: string | null = null,
): CodingAgentSessionSummary {
  return {
    connection: CAC,
    scope: { kind: "app", app: APP },
    observed_seq: "40",
    observed_at: "2026-03-02T00:00:00.000Z",
    problems,
    tickets,
    claims: [],
    remaining_checks: [],
    project: null,
    folder: null,
    claim_rule: "rule",
    next_cursor: nextCursor,
  };
}

Deno.test("coding-agent/guides#R23: hook은 coding agent 대상 문제와 ticket을 10줄·1,200 code point 이하로 보여 주고 상세 읽기·착수 금지 안내가 마지막 줄이다", async () => {
  const problems = [
    problem({
      id: "prb_01h455vb4pex5v6nkc6gd5fdw1",
      repair_state: "ready_to_hand_off",
      symptom: "첫 문제다",
    }),
    problem({
      id: "prb_01h455vb4pex5v6nkc6gd5fdw2",
      repair_state: "in_progress",
      symptom: "둘째 문제다",
    }),
  ];
  const tickets = [
    ticket({
      id: "tkt_01h455vb4pex5v6nkc6gd5fdw1",
      problems: ["prb_01h455vb4pex5v6nkc6gd5fdw1"],
    }),
    ticket({
      id: "tkt_01h455vb4pex5v6nkc6gd5fdw2",
      problems: ["prb_01h455vb4pex5v6nkc6gd5fdw2"],
      state: "claimed",
    }),
  ];
  const text = await runSummaryHook(
    () => Promise.resolve(ok(theSummary(problems, tickets))),
    APP,
  );
  assert(text !== "", "출력이 있다");
  const lines = text.split("\n");
  assertEquals(lines.length <= HOOK_MAX_LINES, true, `${lines.length}줄`);
  assertEquals([...text].length <= HOOK_MAX_CODE_POINTS, true);
  // 마지막 줄은 상세 읽기와 착수 금지 안내다.
  const last = lines[lines.length - 1];
  assert(last.includes("착수 지시가 아니다"));
  assert(last.includes("session summary"));
  // 문제 줄에 ticket이 붙는다.
  assert(lines.some((line) => line.includes("prb_01h455vb4pex5v6nkc6gd5fdw1")));
  assert(lines.some((line) => line.includes("tkt_01h455vb4pex5v6nkc6gd5fdw1")));
  // ticket 상태와 readiness가 보인다.
  assert(lines.some((line) => line.includes("claimed")));
});

Deno.test("coding-agent/guides#R23: 문제는 최대 3개 뒤 나머지 수를 낸다. 4개 이상을 넣어도 상한을 지킨다", async () => {
  const problems = Array.from({ length: 6 }, (_, i) =>
    problem({
      id: `prb_01h455vb4pex5v6nkc6gd5fdw${String(i + 1).padStart(2, "0")}`,
      repair_state: "ready_to_hand_off",
      symptom: `문제 ${i + 1}`,
    }));
  const text = await runSummaryHook(
    () => Promise.resolve(ok(theSummary(problems, []))),
    APP,
  );
  assert(text !== "");
  const lines = text.split("\n");
  // 첫 줄 + 문제 3줄 + 나머지 수 + 마지막 안내 = 6줄이다.
  assertEquals(lines.length, 6, text);
  // 문제 줄은 3개다.
  const shown = lines.filter((line) => line.startsWith("- prb_"));
  assertEquals(shown.length, HOOK_MAX_PROBLEMS);
  // 나머지 수가 있다.
  assert(lines.some((line) => line.includes("나머지 문제 3개")));
});

Deno.test("coding-agent/guides#R23: 사람이 먼저 확인할 문제와 info 자료는 제외된다", async () => {
  const problems = [
    problem({
      id: "prb_01h455vb4pex5v6nkc6gd5fdw1",
      repair_state: "ready_to_hand_off",
      symptom: "agent가 맡는 문제",
    }),
    // 사람 확인이 먼저인 문제다.
    problem({
      id: "prb_01h455vb4pex5v6nkc6gd5fdw2",
      repair_state: "needs_confirmation",
      symptom: "사람이 확인할 문제",
    }),
    // 수리 작업이 없는 문제다.
    problem({
      id: "prb_01h455vb4pex5v6nkc6gd5fdw3",
      repair_state: "none",
      symptom: "수리 작업이 없는 문제",
    }),
    // 읽지 못한 문제다.
    problem({
      id: "prb_01h455vb4pex5v6nkc6gd5fdw4",
      repair_state: "unknown",
      symptom: "담당을 모르는 문제",
    }),
  ];
  const text = await runSummaryHook(
    () => Promise.resolve(ok(theSummary(problems, []))),
    APP,
  );
  assert(text !== "", text);
  assert(text.includes("prb_01h455vb4pex5v6nkc6gd5fdw1"));
  // 사람 확인이 먼저인 문제와 수리 작업이 없는 문제는 빠진다.
  assertEquals(text.includes("prb_01h455vb4pex5v6nkc6gd5fdw2"), false, text);
  assertEquals(text.includes("prb_01h455vb4pex5v6nkc6gd5fdw3"), false, text);
  assertEquals(text.includes("prb_01h455vb4pex5v6nkc6gd5fdw4"), false, text);
});

Deno.test("coding-agent/guides#R23: 문제와 연결되지 않은 ready ticket도 본다. 사람이 처리할 ticket은 빠진다", async () => {
  const tickets = [
    // 사람 확인이 먼저인 ticket이다.
    ticket({
      id: "tkt_01h455vb4pex5v6nkc6gd5fdw1",
      readiness: "needs_confirmation",
    }),
    // ready ticket이다.
    ticket({
      id: "tkt_01h455vb4pex5v6nkc6gd5fdw2",
      problems: [],
    }),
  ];
  const text = await runSummaryHook(
    () => Promise.resolve(ok(theSummary([], tickets))),
    APP,
  );
  assert(text !== "", text);
  assert(text.includes("tkt_01h455vb4pex5v6nkc6gd5fdw2"), text);
  assertEquals(text.includes("tkt_01h455vb4pex5v6nkc6gd5fdw1"), false, text);
});

Deno.test("coding-agent/guides#R23: 아직 읽지 않은 쪽이 있으면 나머지 수가 애매하다. 이상 표시를 낸다", () => {
  const problems = [problem({ repair_state: "ready_to_hand_off" })];
  const facts: HookFacts = { problems, tickets: [], more: true };
  const text = renderHook(facts);
  assert(text !== "");
  assert(text.includes("개 이상"), text);
  const settled = renderHook({ ...facts, more: false });
  assertEquals(settled.includes("개 이상"), false);
});

Deno.test("coding-agent/guides#R24: 문제와 ticket이 없으면 빈 출력이다", async () => {
  const text = await runSummaryHook(
    () => Promise.resolve(ok(theSummary([], []))),
    APP,
  );
  assertEquals(text, "");
  // 사람이 처리할 문제만 있어도 빈 값이다.
  const text2 = await runSummaryHook(
    () =>
      Promise.resolve(ok(theSummary([
        problem({ id: "prb_01h455vb4pex5v6nkc6gd5fdw2", repair_state: "none" }),
      ], []))),
    APP,
  );
  assertEquals(text2, "");
});

Deno.test("coding-agent/guides#R24: daemon 장애는 빈 출력이고 throw도 빈 값이다. 세션 시작을 막지 않는다", async () => {
  const failed = await runSummaryHook(
    () =>
      Promise.resolve(err({ code: "unavailable", message: "core가 닫혔다" })),
    APP,
  );
  assertEquals(failed, "");
  const thrown = await runSummaryHook(() => {
    throw new Error("transport failed");
  }, APP);
  assertEquals(thrown, "");
});

Deno.test("coding-agent/guides#R24: coreWaitMs 안에 읽기가 끝나지 않으면 빈 값이다. timer는 치운다", async () => {
  const started = Date.now();
  const text = await runSummaryHook(
    () =>
      new Promise<Result<CodingAgentSessionSummary>>((resolve) => {
        setTimeout(
          () => resolve(ok(theSummary([], []))),
          HOOK_CORE_WAIT_MS + 2_000,
        );
      }),
    APP,
    { totalMs: HOOK_TOTAL_TIMEOUT_MS, coreWaitMs: 50 },
  );
  assertEquals(text, "");
  // coreWait를 넘어서 기다리지 않았다.
  assert(Date.now() - started < 2_000);
});

Deno.test("coding-agent/guides#R24: runSummaryHookBounded는 전체 상한 안에서 끝난다. 상수는 계약 값이다", async () => {
  assertEquals(HOOK_TOTAL_TIMEOUT_MS, 5_000);
  assertEquals(HOOK_CORE_WAIT_MS, 3_000);
  const text = await runSummaryHookBounded(
    () => Promise.resolve(ok(theSummary([], []))),
    APP,
    { totalMs: 100, coreWaitMs: 100 },
  );
  assertEquals(text, "");
  const text2 = await runSummaryHookBounded(
    () => Promise.resolve(ok(theSummary([problem()], []))),
    APP,
    { totalMs: 100, coreWaitMs: 100 },
  );
  assert(text2 !== "");
});

Deno.test("coding-agent/guides#R25: hook 출력은 문제와 ticket과 착수 금지 안내뿐이다. receipt·상태 수집 문구와 섞이지 않는다", async () => {
  const text = await runSummaryHook(
    () => Promise.resolve(ok(theSummary([problem()], [ticket()]))),
    APP,
  );
  assert(text !== "");
  assertEquals(text.includes("receipt"), false);
  assertEquals(text.includes("PermissionRequest"), false);
  assertEquals(text.includes("observe"), false);
});
