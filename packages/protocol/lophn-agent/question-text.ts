import { z } from "zod";

// 질문의 글(본문·이유·선택지 설명·추천 이유·자유 답·취소 이유)은 요청에 값으로 싣는다.
// 호출자는 hash를 만들지도 blob을 준비하지도 않는다: core가 redaction을 거친 글을
// UTF-8 bytes로 blob으로 준비하고 command가 같은 transaction에서 영구 참조를 등록한다
// (메시지 본문과 같은 길). ledger에는 그 blob의 hash만 남는다.

// 글 하나의 상한(UTF-8 bytes). 요청 전체는 RPC JSON 상한 안이어야 한다.
export const QUESTION_TEXT_MAX_BYTES = 32768;
// 글 blob 준비·참조의 이름. 준비 주체는 보낸 쪽의 자격이고 참조는 permanent다.
export const QUESTION_TEXT_PURPOSE = "question_text";
export const QUESTION_BLOB_OWNER_KIND = "question";
export const QUESTION_BLOB_FIELDS = {
  prompt: "prompt",
  reason: "reason",
  optionDescription: "option_description",
  recommendation: "recommendation",
  answer: "answer",
  closed: "closed",
} as const;

const encoder = new TextEncoder();

export function questionTextBytes(text: string): Uint8Array {
  return encoder.encode(text);
}

// 비어 있거나 공백뿐인 글은 글이 아니다(domain model: 질문·답·이유 모두).
export const questionTextSchema = z.string()
  .refine((value) => value.trim().length > 0, {
    message: "expected nonblank text",
  })
  .refine(
    (value) => questionTextBytes(value).length <= QUESTION_TEXT_MAX_BYTES,
    { message: "question text is too large" },
  );
