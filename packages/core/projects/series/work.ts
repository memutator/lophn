// 준비 worker의 series-next 계산. 가족 revision·멤버·예약 key·draft를 host가
// 넘기면 규칙으로 다음 제안을 계산한다. 이 파일은 검사·저장을 하지 않는다.

import { z } from "zod";
import {
  type NextSuggestion,
  nextSuggestion,
} from "../../../protocol/projects/mod.ts";

// host가 준 가족 상태의 payload 모양. NextRule은 규칙 문자열 그대로다.
const seriesNextPayloadSchema = z.strictObject({
  rule: z.string(),
  revision: z.string(),
  members: z.array(
    z.object({ key: z.string(), document_name: z.string().nullable() }),
  ),
  reserved_keys: z.array(z.string()),
  draft_key: z.string().nullable(),
});

export type SeriesNextPayload = {
  rule: string;
  revision: string;
  members: { key: string; document_name: string | null }[];
  reserved_keys: string[];
  draft_key: string | null;
};

// host가 준 가족 상태로 다음 key 제안을 계산한다. payload가 어긋나면 빈 제안 대신
// null로 돌려 host가 잘못된 payload를 알게 한다.
export function seriesNext(payload: unknown): NextSuggestion | null {
  const input = nextSuggestionInput(payload);
  if (input === null) return null;
  return nextSuggestion(input);
}

function nextSuggestionInput(
  payload: unknown,
): Parameters<typeof nextSuggestion>[0] | null {
  const parsed = seriesNextPayloadSchema.safeParse(payload);
  return parsed.success ? parsed.data : null;
}
