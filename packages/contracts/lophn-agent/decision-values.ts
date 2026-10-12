import { z } from "zod";
import { idSchema, seqSchema, sha256Schema } from "../platform/mod.ts";
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

// 요청의 답. 자유 답은 글을 값으로 싣고 core가 blob으로 준비한다(Q38). 저장·event·record의
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

export type QuestionActionEvidence = z.infer<
  typeof questionActionEvidenceSchema
>;

// 묶음 전체가 명시 Submit·Skip·취소·만료의 대상이다(questions#R6). 질문 하나만 따로 닫지 않는다.
export const questionGroupRefSchema = z.strictObject({
  group: idSchema("qgr"),
  created_seq: seqSchema,
});

export const roleKindSchema = z.enum([
  "lophn",
  "app_engineer",
  "context_engineer",
  "operator",
]);

// 허용 방향은 lophn-agent/handoff의 현재 집합이다. Operator는 양방향 모두 없다.
export const HANDOFF_DIRECTIONS = [
  ["lophn", "app_engineer"],
  ["lophn", "context_engineer"],
  ["app_engineer", "lophn"],
  ["app_engineer", "context_engineer"],
  ["context_engineer", "lophn"],
] as const;

export function handoffAllowed(from: string, to: string): boolean {
  return HANDOFF_DIRECTIONS.some(([sender, receiver]) =>
    sender === from && receiver === to
  );
}

export const handoffContentSchema = z.strictObject({
  what: z.string().regex(/\S/),
  why: z.string().regex(/\S/),
  excludes: z.array(z.string().regex(/\S/)),
  expected_outputs: z.array(z.string().regex(/\S/)).min(1),
});

export type HandoffContent = z.infer<typeof handoffContentSchema>;
