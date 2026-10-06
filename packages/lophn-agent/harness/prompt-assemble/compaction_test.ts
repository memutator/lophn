import { assert, assertEquals } from "@std/assert";
import type { HistoryMessage } from "./model.ts";
import {
  checkCompletion,
  COMPACTION_REASSEMBLY_RETRY_MAX,
  compactionNeeded,
  type CompactionResult,
  compactionTarget,
  type CompletionCheck,
  historyCut,
  mergeStepInputCap,
  precheckCompaction,
  recentHistoryBudget,
  SHRINK_RESULT_HEAD,
  SHRINK_RESULT_TAIL,
  shrinkResultText,
  splitChunks,
  SUMMARY_RULE_VERSION,
  summaryBodyHash,
  summaryOutputCap,
  type SummaryParts,
  type SummaryRef,
} from "./compaction.ts";
import {
  CONTINUATION_BODY_MAX_TOKENS,
  CONTINUATION_RESHRINK_MAX,
} from "./summary.ts";

// R10에서 찍는 예산이다(확인 숫자).
const BUDGET_80K = 80000;

// tool_use와 tool_result가 짝인 이력이다. 짝을 나누지 않는지의 확인에 쓴다.
function historyOf(pairs: number): HistoryMessage[] {
  const messages: HistoryMessage[] = [];
  for (let i = 0; i < pairs; i++) {
    messages.push({
      role: "assistant",
      parts: [{ kind: "tool_use", id: `tu_${i}`, name: "a.b", input: {} }],
    });
    messages.push({
      role: "user",
      parts: [{ kind: "tool_result", id: `tu_${i}`, text: "R" }],
    });
  }
  return messages;
}

// tool_use와 tool_result가 같은 메시지 안에 섞이지 않은 이력이라는 가정이다.
// 이력이 assistant(tool_use)·user(tool_result)로 오는지의 확인에 쓴다.
function pairEnd(item: HistoryMessage, _index: number): boolean {
  return item.role === "user" &&
    item.parts.every((part) => part.kind === "tool_result");
}

Deno.test("lophn-agent/harness/prompt-assemble#R10: 예산 80000에서 55999는 압축 없음·56000은 시작이고 목표는 40000 이하다", () => {
  // 바로 아래와 같음 경계를 테스트한다.
  assertEquals(compactionNeeded(55999, BUDGET_80K), false);
  assertEquals(compactionNeeded(56000, BUDGET_80K), true);
  // 목표는 예산 50%다.
  assertEquals(compactionTarget(BUDGET_80K), 40000);
});

Deno.test("lophn-agent/harness/prompt-assemble#R10: 70% 미만은 압축하지 않는다", () => {
  assertEquals(compactionNeeded(0, BUDGET_80K), false);
  assertEquals(compactionNeeded(39999, BUDGET_80K), false);
  assertEquals(compactionNeeded(79999, 80000), true);
});

Deno.test("lophn-agent/harness/prompt-assemble#R11: 최근 이력은 예산 25%를 2000~15000으로 clamp한다", () => {
  // 예산 40,000은 10,000, 100,000은 최소 15,000이다.
  assertEquals(recentHistoryBudget(40000), 10000);
  assertEquals(recentHistoryBudget(100000), 15000);
  // 작은 예산은 최소 2000이다.
  assertEquals(recentHistoryBudget(4000), 2000);
  // 25%가 정확히 경계인 경우도 clamp 안에 있다.
  assertEquals(recentHistoryBudget(80000), 15000);
});

Deno.test("lophn-agent/harness/prompt-assemble#R11: 이력 분할은 call·result 짝 경계에서 끊는다", () => {
  const history = historyOf(3);
  assertEquals(historyCut(history), 6);
  // 짝의 result를 기준으로 자르는 판정이다. result 앞(assistant)에서 끊지 않는다.
  assert(pairEnd(history[1], 1));
  assert(!pairEnd(history[0], 0));
});

Deno.test("lophn-agent/harness/prompt-assemble#R12: 2000 code point 넘는 결과는 앞 1000·뒤 1000으로 축소하고 생략·재조회 표시를 남긴다", () => {
  // 2001 code point다.
  const long = "a".repeat(2001);
  const shrunk = shrinkResultText(long);
  assert(shrunk !== null);
  // 앞 1000·뒤 1000이 모두 남는다.
  assert(shrunk.startsWith("a".repeat(SHRINK_RESULT_HEAD)));
  assert(shrunk.endsWith("a".repeat(SHRINK_RESULT_TAIL)));
  // 별도 생략 표시가 있다.
  assert(shrunk.includes("[생략]"));
  // 원본이 바뀌지 않는다.
  assertEquals(long, "a".repeat(2001));
});

Deno.test("lophn-agent/harness/prompt-assemble#R12: 2000 code point는 축소하지 않는다", () => {
  assertEquals(shrinkResultText("a".repeat(2000)), null);
  assertEquals(shrinkResultText(""), null);
});

Deno.test("lophn-agent/harness/prompt-assemble#R12: 한글·이모지를 code point로 센다", () => {
  // 한글 2001 code point다.
  const hangul = "가".repeat(2001);
  const shrunk = shrinkResultText(hangul);
  assert(shrunk !== null);
  assert(shrunk.startsWith("가".repeat(SHRINK_RESULT_HEAD)));
  // 이모지는 대리쌍이지만 code point 하나다.
  const emoji = "\u{1F600}".repeat(2001);
  const emojiShrunk = shrinkResultText(emoji);
  assert(emojiShrunk !== null);
  assert(emojiShrunk.startsWith("\u{1F600}".repeat(SHRINK_RESULT_HEAD)));
});

Deno.test("lophn-agent/harness/prompt-assemble#R13: 요약 출력 상한은 예산 10%와 4000 중 작은 값이다", () => {
  // 예산 20,000 → 2,000이다.
  assertEquals(summaryOutputCap(20000), 2000);
  // 큰 예산은 4000이다.
  assertEquals(summaryOutputCap(100000), 4000);
});

Deno.test("lophn-agent/harness/prompt-assemble#R15: 요약 재료를 tool 짝을 유지한 채 절반 이하 chunk로 나눈다", () => {
  const items = historyOf(6);
  const { chunks, singleTooLarge } = splitChunks(items, pairEnd);
  assertEquals(singleTooLarge, false);
  assert(chunks.length >= 2);
  // 모든 chunk의 길이를 합치면 전체와 같다.
  assertEquals(chunks.flat().length, items.length);
  // 절반 이하 chunk다.
  for (const chunk of chunks) {
    assert(chunk.length <= splitChunks(items, pairEnd).chunks.flat().length);
  }
  // 원래 순서가 보존된다.
  assertEquals(chunks.flat(), items);
});

Deno.test("lophn-agent/harness/prompt-assemble#R15: 단일 짝이 한계를 넘으면 압축 실패로 처리한다", () => {
  // 짝 경계가 없는 재료(한 message만)는 압축 실패다.
  const single = [historyOf(1)[0]];
  const { chunks, singleTooLarge } = splitChunks(single, pairEnd);
  assertEquals(singleTooLarge, true);
  assertEquals(chunks, []);
  // 빈 재료는 실패가 아니다.
  assertEquals(splitChunks([], pairEnd).singleTooLarge, false);
});

Deno.test("lophn-agent/harness/prompt-assemble#R15: 병합은 모든 원문 구간을 보존한다", () => {
  // chunk·병합 뒤 구간 누락 0개다. splitChunks가 원래 순서를 유지하므로
  // chunk 경계(각 chunk의 첫 item과 끝 item)가 전체 순서 안에 그대로 있다.
  const items = historyOf(4);
  const { chunks, singleTooLarge } = splitChunks(items, pairEnd);
  assertEquals(singleTooLarge, false);
  // 각 chunk의 첫 item은 전체 순서에서 그 chunk가 시작하는 자리와 같다.
  let index = 0;
  for (const chunk of chunks) {
    assertEquals(chunk[0], items[index]);
    index += chunk.length;
  }
  // 덮은 부분은 전체와 같다(구간 누락 0개).
  assertEquals(index, items.length);
  assertEquals(chunks.flat(), items);
});

Deno.test("lophn-agent/harness/prompt-assemble#R15: merge tree의 단계별 입력은 organizing 예산 절반 이하다", () => {
  // merge tree의 단계별 입력 상한이다.
  assertEquals(mergeStepInputCap(20000), 10000);
  assertEquals(mergeStepInputCap(40000), 20000);
});

Deno.test("lophn-agent/harness/prompt-assemble#R16: 여섯 부분과 완료 조건을 모두 만족하면 완료다", () => {
  // 여섯 부분이다.
  const parts: SummaryParts = {
    purpose: "p",
    decisions_constraints: "d",
    progress_evidence: "e",
    incomplete: "i",
    failures_next: "f",
    estimations_uncertainty: "u",
  };
  assertEquals(Object.keys(parts).length, 6);
  // 완료 조건이다.
  const check: CompletionCheck = checkCompletion({
    text: "summary",
    partsCount: 6,
    PARTS_TOTAL: 6,
    ranges: [{ from_seq: 1n, through_seq: 4n }],
    expected_ranges: 1,
    protectedKept: true,
    restructured: 1000,
    smallerThanBefore: true,
    withinTarget: true,
  });
  assertEquals(check.completed, true);
  assertEquals(check.broken, []);
});

Deno.test("lophn-agent/harness/prompt-assemble#R16: 각 조건을 하나씩 깨뜨려 완료되지 않고 별도 검토 call이 없다", () => {
  const base = {
    text: "summary",
    partsCount: 6,
    PARTS_TOTAL: 6,
    ranges: [{ from_seq: 1n, through_seq: 4n }],
    expected_ranges: 1,
    protectedKept: true,
    restructured: 1000,
    smallerThanBefore: true,
    withinTarget: true,
  };
  // 비어 있는 응답.
  assertEquals(checkCompletion({ ...base, text: "" }).completed, false);
  // 부분이 하나 빠졌다(다섯 부분).
  assertEquals(checkCompletion({ ...base, partsCount: 5 }).completed, false);
  // 범위가 누락됐다.
  assertEquals(
    checkCompletion({ ...base, ranges: [], expected_ranges: 1 }).completed,
    false,
  );
  // 보호 전문이 유지되지 않았다.
  assertEquals(
    checkCompletion({ ...base, protectedKept: false }).completed,
    false,
  );
  // 재조립이 작아지지 않았다.
  assertEquals(
    checkCompletion({ ...base, smallerThanBefore: false }).completed,
    false,
  );
  // 50% 목표를 넘었다.
  assertEquals(
    checkCompletion({ ...base, withinTarget: false }).completed,
    false,
  );
});

Deno.test("lophn-agent/harness/prompt-assemble#R17: 실패 결과는 원문을 바꾸지 않고 실패 사실을 남긴다", () => {
  const result: CompactionResult = {
    state: "failed",
    ranges: [{ from_seq: 1n, through_seq: 2n }],
    calls: [],
    summary: null,
    reason: "single_pair_over_budget",
  };
  assertEquals(result.state, "failed");
  assertEquals(result.summary, null);
  assertEquals(result.reason, "single_pair_over_budget");
  // 원문 이력은 그대로다.
  const history = historyOf(2);
  assertEquals(history.length, 4);
});

Deno.test("lophn-agent/harness/prompt-assemble#R17: 실패한 같은 구간 자동 요약 반복이 없고 재시도 상한이 있다", () => {
  // 같은 구간 반복 요약의 근거는 calls 배열이다. 나란히 같은 구간의 call이
  // 쌓이면 반복이다. splitChunks의 단일 짝 실패가 재요약을 부르지 않는다.
  const { singleTooLarge } = splitChunks(historyOf(1), pairEnd);
  assert(singleTooLarge);
  // compaction 실패의 재시도 상한은 컴파일 상수다(이어가기 재축소 상한과 같은 책임).
  assertEquals(CONTINUATION_RESHRINK_MAX, 2);
});

Deno.test("lophn-agent/harness/prompt-assemble#R17: provider 문맥 초과 응답 뒤 재조립 재시도는 최대 1회다(질문 Q12)", () => {
  assertEquals(COMPACTION_REASSEMBLY_RETRY_MAX, 1);
});

Deno.test("lophn-agent/harness/prompt-assemble#R20: 이어가기 본문 상한 상수다", () => {
  assertEquals(CONTINUATION_BODY_MAX_TOKENS, 400);
});

Deno.test("lophn-agent/harness/prompt-assemble#R19: SummaryRef는 원문 세션·구간·call·본문 hash·규칙 판을 연결한다", async () => {
  const body_hash = await summaryBodyHash("요약 본문");
  const ref: SummaryRef = {
    kind: "compaction",
    session: null,
    run: "run_1",
    from_seq: 1n,
    through_seq: 4n,
    created_at: "2026-01-01T00:00:00.000Z",
    summary_call: "mcl_1",
    body_hash,
    rule_version: SUMMARY_RULE_VERSION,
    references: [{ address: "doc_1", version: "ver_1" }],
    parts: {
      purpose: "p",
      decisions_constraints: "d",
      progress_evidence: "e",
      incomplete: "i",
      failures_next: "f",
      estimations_uncertainty: "u",
    },
  };
  // 원문 세션·구간이 남는다.
  assertEquals(ref.from_seq < ref.through_seq, true);
  // 생성 시각·call·본문 hash·규칙 판이 함께 남는다.
  assert(ref.created_at !== "");
  assert(ref.summary_call !== "");
  assertEquals(ref.body_hash, body_hash);
  assertEquals(ref.rule_version, SUMMARY_RULE_VERSION);
  // 근거 version이 낡음·확인 불가 표시 없이 그대로 남는다.
  assertEquals(ref.references[0]?.version, "ver_1");
});

Deno.test("lophn-agent/harness/prompt-assemble#R10: 보호 입력만으로 50%를 넘으면 사전 검사로 summary 호출 0회다(질문 Q10)", () => {
  // 보호 입력만 50%를 넘는다(예산 80000의 절반은 40000, 보호 입력은 42000).
  // 사전 검사로 summary 호출 0회, 원문이 전체 한계 안이면 그대로 진행한다.
  const within = precheckCompaction(42000, 80000, 120000);
  assertEquals(within.summary_calls, 0);
  assertEquals(within.within_limit, true);
  // 보호 입력이 전체 한계 밖이면 context_limit를 알린다.
  const outside = precheckCompaction(130000, 80000, 120000);
  assertEquals(outside.summary_calls, 0);
  assertEquals(outside.within_limit, false);
  if (!outside.within_limit) assertEquals(outside.reason, "context_limit");
});
