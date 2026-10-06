import { sha256Hex } from "../../../base/mod.ts";

// 이어가기 summary의 준비이다(lophn-agent/harness/prompt-assemble 요구 R19–R23). 순수 값과 계산만
// 두고 I/O는 없다. 요약 call과 저장은 compaction·work가 하고, 여기는 본문 상한·재축소·재사용
// 범위를 정한다.

export const SUMMARY_RULE_VERSION = "compaction.1";

// R20·Q12. 이어가기 본문 상한과 재축소 횟수다. 401 token이면 저장된 완성 summary로
// 쓰지 않고 다시 줄인다. token 상한은 COUNT_METHOD에 따라 UTF-8 byte를 쓴다.
export const CONTINUATION_BODY_MAX_TOKENS = 400;
export const CONTINUATION_RESHRINK_MAX = 2;

export type SummaryParts = {
  purpose: string;
  decisions_constraints: string;
  progress_evidence: string;
  incomplete: string;
  failures_next: string;
  estimations_uncertainty: string;
};

// R14. 여섯 부분의 이름과 순서다. 없는 내용은 없다고 쓴다.
export const SUMMARY_PART_KEYS: readonly (keyof SummaryParts)[] = [
  "purpose",
  "decisions_constraints",
  "progress_evidence",
  "incomplete",
  "failures_next",
  "estimations_uncertainty",
];

export type SummaryRef = {
  kind: "continuation" | "compaction";
  // continuation은 원문 세션이 필수고 compaction은 적용 run이 필수다.
  session: string | null;
  run: string | null;
  // 실제 포함한 완료 구간(from ≤ through)이다.
  from_seq: bigint;
  through_seq: bigint;
  created_at: string;
  // organizing·conversation_compression 완전 성공 call이다.
  summary_call: string;
  // 완전 출력 blob의 hash다. 원문 대체 저장 아니다.
  body_hash: string;
  rule_version: string;
  references: readonly { address: string; version: string | null }[];
  parts: SummaryParts;
};

export function summaryBodyTokens(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

export function summaryBodyHash(text: string): Promise<string> {
  return sha256Hex(text);
}

export type ClampResult =
  | { status: "within"; text: string }
  // 다시 줄여야 한다. 문장 중간을 잘라 맞춘 결과는 내보내지 않는다(R20).
  | { status: "over"; text: string | null; attempt: number };

// 마지막 온전한 문장 경계만 남긴 줄임이다. 쉼표·공백 같은 중간 경계는 잘라 맞추지 않는다.
// code point 단위로 문장 끝(., !, ?)만 본다.
function lastSentenceEnd(text: string): number {
  const points = [...text];
  for (let i = points.length - 1; i >= 0; i--) {
    if (points[i] === "." || points[i] === "!" || points[i] === "?") {
      return i + 1;
    }
  }
  return 0;
}

// 400 token 안으로 문장 경계에서 다시 줄인다. 문장 경계가 없으면 줄이지 못하므로
// 원문을 내보내지 않는다(R20). attempt는 이번이 몇째 재축소인지고, 상한을 넘으면
// "over"를 돌려 저장된 완성 summary로 쓰지 않는다.
export function clampSummaryText(
  text: string,
  attempt: number,
): ClampResult {
  if (summaryBodyTokens(text) <= CONTINUATION_BODY_MAX_TOKENS) {
    return { status: "within", text };
  }
  if (attempt > CONTINUATION_RESHRINK_MAX) {
    return { status: "over", text: null, attempt };
  }
  const points = [...text];
  const end = lastSentenceEnd(text);
  if (end === 0) return { status: "over", text: null, attempt };
  return { status: "over", text: points.slice(0, end).join(""), attempt };
}

// R23. 이어가기 재사용은 사람이 지정한 같은 세션의 최신 완성본 하나다. 다른 세션·주기
// run·handoff에 자동 주입하지 않는다. session을 지정하지 않으면 아무 것도 고르지 않는다.
export function latestContinuationSummary(
  summaries: readonly SummaryRef[],
  session: string,
): SummaryRef | null {
  let chosen: SummaryRef | null = null;
  for (const summary of summaries) {
    if (summary.kind !== "continuation" || summary.session !== session) {
      continue;
    }
    if (summary.session === null || summary.run !== null) continue;
    if (chosen === null || summary.created_at > chosen.created_at) {
      chosen = summary;
    }
  }
  return chosen;
}

// R21. 일회 선호를 영구 취향으로 일반화하지 않는지의 확인이다. 요약 문장 안에
// 일회 표현("이번"·"이번 한 번")이 남아야 하고 영구 표현("늘"·"항상")으로 바꾸지 않는다.
export function assertsNoPreferenceGeneralization(
  summary: SummaryParts,
): boolean {
  const joined = SUMMARY_PART_KEYS.map((key) => summary[key]).join(" ");
  return !joined.includes("늘") && !joined.includes("항상");
}
