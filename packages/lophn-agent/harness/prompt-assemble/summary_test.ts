import { assert, assertEquals } from "@std/assert";
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

// 요약 규칙 테스트(R19–R23). 실제 provider를 부르지 않는다. prompt-assemble의 순수 준비는
// summary.ts가 한다.

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
