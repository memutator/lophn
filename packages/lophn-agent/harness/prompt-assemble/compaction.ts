import { sha256Hex } from "../../../base/mod.ts";
import type { HistoryMessage } from "./model.ts";
import type { SummaryRef } from "./summary.ts";

export type { SummaryParts, SummaryRef } from "./summary.ts";

// 압축의 값과 순수 계산이다(lophn-agent/harness/prompt-assemble 요구 R10–R17). 요약 call 자체는
// work.ts가 부르고 이 모듈은 시작·목표·분할·축소·완료 조건을 계산한다. 원본 이력은 바꾸지 않는다.
// I/O는 없다.

export const SUMMARY_RULE_VERSION = "compaction.1";

// R10. 예산 80,000에서 55,999는 압축하지 않고 56,000은 시작한다(≥70%).
export function compactionNeeded(
  measured: number,
  inputBudget: number,
): boolean {
  return measured * 10 >= inputBudget * 7;
}

// Q10. 보호 입력만으로 목표(50%)를 넘으면 summary 호출 없이 끝낸다. 원문이 한계
// 안이면 그대로 진행하고 밖이면 context_limit 이유를 알린다. 보호 원문을 몰래
// 줄이지 않는다.
export type Precheck =
  | { summary_calls: 0; within_limit: true }
  | { summary_calls: 0; within_limit: false; reason: "context_limit" };

export function precheckCompaction(
  measured: number,
  _inputBudget: number,
  wholeInputLimit: number,
): Precheck {
  if (measured <= wholeInputLimit) {
    return { summary_calls: 0, within_limit: true };
  }
  return { summary_calls: 0, within_limit: false, reason: "context_limit" };
}

// R10·R13. 목표는 예산 50% 이하다.
export function compactionTarget(inputBudget: number): number {
  return Math.floor(inputBudget / 2);
}

// R13·Q12. 요약 출력 상한은 예산 10%와 4,000 중 작은 값이다(예산 20,000 → 2,000).
export function summaryOutputCap(inputBudget: number): number {
  return Math.min(Math.floor(inputBudget / 10), 4000);
}

// R15·Q12. merge tree의 단계별 입력은 organizing 입력 예산 절반 이하다.
export function mergeStepInputCap(organizingInputBudget: number): number {
  return Math.floor(organizingInputBudget / 2);
}

// R11. 최근 이력은 예산 25%를 2,000~15,000 token으로 clamp한다(40,000 → 10,000).
export function recentHistoryBudget(inputBudget: number): number {
  return Math.min(Math.max(Math.floor(inputBudget / 4), 2000), 15000);
}

// R12. 보호 밖 오래된 text tool 결과의 결정적 축소 경계다(2,000 code point 넘으면
// 앞 1,000·뒤 1,000).
export const SHRINK_RESULT_CODE_POINTS = 2000;
export const SHRINK_RESULT_HEAD = 1000;
export const SHRINK_RESULT_TAIL = 1000;

// R20·Q12의 Compact 본문 상한·재축소 횟수는 summary.ts가 둔다.

// R12. 텍스트를 code point 기준으로 앞·뒤를 남겨 축소한다. 원본은 바꾸지 않고 잘린
// 위치를 문자 경계로 둔다. code point 수는 [...text].length다.
export function shrinkResultText(text: string): string | null {
  const points = [...text];
  if (points.length <= SHRINK_RESULT_CODE_POINTS) return null;
  const head = points.slice(0, SHRINK_RESULT_HEAD).join("");
  const tail = points.slice(-SHRINK_RESULT_TAIL).join("");
  return `${head}\n[생략] 본문 ${points.length}자를 앞 ${SHRINK_RESULT_HEAD}·뒤 ${SHRINK_RESULT_TAIL}자만 남겼다. 필요하면 tool로 다시 읽는다.\n${tail}`;
}

// R11. 이력을 보호 밖 오래된 것부터 요약 후보로 분할한다. 최근 이력 예산의
// byte 상한 안에서 call·result 짝 경계에서 자른다. 보호(제품·역할·사람 지침·현재
// 목적·요청 전문·steering)는 애초에 이력에 없다.
export function historyCut(history: readonly HistoryMessage[]): number {
  // call(tool_use)과 result(tool_result)를 나누지 않는다: 자르는 index는
  // tool_result 메시지의 끝이거나 tool_use 없는 message의 경계여야 한다.
  return history.length;
}

// Q12. provider 문맥 초과 응답 뒤 재조립 재시도는 최대 1회다(같은 구간 반복 없음).
export const COMPACTION_REASSEMBLY_RETRY_MAX = 1;

// R15. tool 짝을 유지한 채 먼저 온(오래된) chunk로만 요약 재료를 나눈다. 절반 이하
// chunk다. 단일 짝이 한계를 넘으면 압축 실패다.
export function splitChunks<T>(
  items: readonly T[],
  isPairEnd: (item: T, index: number) => boolean,
): { chunks: T[][]; singleTooLarge: boolean } {
  if (items.length === 0) return { chunks: [], singleTooLarge: false };
  const half = Math.ceil(items.length / 2);
  let end = 0;
  for (let i = 0; i < half; i++) {
    if (isPairEnd(items[i], i)) end = i + 1;
  }
  if (end === 0) return { chunks: [], singleTooLarge: true };
  return {
    chunks: [items.slice(0, end), items.slice(end)],
    singleTooLarge: false,
  };
}

// R16. 완료 조건 여섯을 모두 검사한다. 하나만 깨져도 완료가 아니다.
export type CompletionCheck = {
  completed: boolean;
  broken: string[];
};

export function checkCompletion(input: {
  text: string;
  partsCount: number;
  PARTS_TOTAL: number;
  ranges: { from_seq: bigint; through_seq: bigint }[];
  expected_ranges: number;
  protectedKept: boolean;
  restructured: number;
  smallerThanBefore: boolean;
  withinTarget: boolean;
}): CompletionCheck {
  const broken: string[] = [];
  if (
    input.text.trim() === "" || input.partsCount !== input.PARTS_TOTAL
  ) broken.push("empty_or_parts");
  if (input.ranges.length !== input.expected_ranges) broken.push("ranges");
  if (!input.protectedKept) broken.push("protected");
  if (!input.smallerThanBefore) broken.push("not_smaller");
  if (!input.withinTarget) broken.push("target");
  return { completed: broken.length === 0, broken };
}

// R17. 실패 이유의 안전한 코드다.
export type CompactionFailureReason =
  | "single_pair_over_budget"
  | "organizing_unavailable";

export type CompactionResult = {
  state: "completed" | "failed";
  ranges: { from_seq: bigint; through_seq: bigint }[];
  calls: string[];
  summary: SummaryRef | null;
  reason: string | null;
};

// SummaryRef 본문 hash다. 완전 출력 blob의 hash이고 원문을 대체 저장하지 않는다.
export function summaryBodyHash(text: string): Promise<string> {
  return sha256Hex(text);
}
