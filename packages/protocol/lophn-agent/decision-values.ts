import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { seqSchema, sha256Schema } from "../base/values.ts";
import { questionTextSchema } from "./question-text.ts";

export const questionStatusSchema = z.enum([
  "pending",
  "answered",
  "expired",
  "cancelled",
]);

// expired는 기한이 지나 machine이 닫은 질문의 이유다. 사람·agent의 취소 입력에는 쓰지 않는다.
export const questionClosedReasonSchema = z.enum([
  "deferred",
  "cancelled",
  "superseded",
  "expired",
]);

export const answerSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("option"),
    option_key: z.string().min(1),
    text_blob: z.null(),
  }),
  z.strictObject({
    kind: z.literal("text"),
    option_key: z.null(),
    text_blob: sha256Schema,
  }),
]);

// 요청의 답. 자유 답은 글을 값으로 싣고 core가 blob으로 준비한다. 저장·event·record의
// 답(answerSchema)은 그 blob의 hash를 가리킨다.
export const optionAnswerInputSchema = z.strictObject({
  kind: z.literal("option"),
  option_key: z.string().min(1),
});

export const answerInputSchema = z.discriminatedUnion("kind", [
  optionAnswerInputSchema,
  z.strictObject({
    kind: z.literal("text"),
    text: questionTextSchema,
  }),
]);

export const questionActionEvidenceSchema = z.strictObject({
  question: idSchema("qst"),
  option: z.string().min(1),
});

// 묶음 전체가 명시 Submit·Skip·취소·만료의 대상이다. 질문 하나만 따로 닫지 않는다.
export const questionGroupRefSchema = z.strictObject({
  group: idSchema("qgr"),
  created_seq: seqSchema,
});

