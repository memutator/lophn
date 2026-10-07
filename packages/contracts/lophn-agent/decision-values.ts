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

export const questionRefSchema = z.strictObject({
  question: idSchema("qst"),
  created_seq: seqSchema,
});

export const revertOutcomeSchema = z.enum([
  "applying",
  "applied",
  "partial",
  "uncertain",
  "blocked",
]);

export const revertCapabilitySchema = z.enum([
  "reversible",
  "retained",
  "irreversible",
  "conflict",
]);

// 분류·차단 이유 코드. 화면 문장은 이 코드로 wording을 고른다. 값은 글이나 secret이 아니다.
export const REVERT_REASON_CODES = [
  "audit_fact",
  "external_effect",
  "later_change",
  "linked_document",
  "not_agent_output",
  "title_change",
  "no_previous_version",
  "unclassified_document_event",
  "unclassified_event",
  "blocked_conflict",
  "blocked_irreversible",
  "blocked_dependency",
  "blocked_not_prepared",
  "stale_preview",
  // 앱 revert 단계의 결과(lophn-agent#T48). checkpoint가 단계 실패·응답 유실을 기록한다.
  "app_failed",
  "app_uncertain",
] as const;
export const revertReasonSchema = z.enum(REVERT_REASON_CODES);
export type RevertReason = z.infer<typeof revertReasonSchema>;

export const revertResultSchema = z.enum([
  "restored",
  "retained",
  "irreversible",
  "conflict",
  "unchanged",
  "failure",
  "uncertain",
]);

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
