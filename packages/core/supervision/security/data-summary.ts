import type { DataEnvelope } from "../../../protocol/base/mod.ts";
import { dataEnvelope } from "./data-envelope.ts";

// summary·compaction은 원래 범위·고정 판·출처·data 분류를 유지한다.
// 분류 없는 문자열은 만들지 않고, 출처가 섞인 결과는 가장 낮은 신뢰인 data다.

export type SummaryOrigin = {
  source: string;
  revision?: string;
};

// 분류 없이 내보내는 곳이 없다. summary도 data로 감싼다.
export function summaryEnvelope(text: string, origin: SummaryOrigin) {
  return dataEnvelope(text, origin);
}

// compaction의 입력 자료가 하나라도 있으면 결과 전체를 data로 감싸고
// 출처·고정 판을 그대로 남긴다. 입력이 없으면 출처 불명과 같아서 data다.
export function compactedEnvelope(
  summary: string,
  inputs: readonly DataEnvelope[],
  origin: SummaryOrigin,
): ReturnType<typeof dataEnvelope> {
  return dataEnvelope(summary, inputs.length === 0 ? undefined : origin);
}
