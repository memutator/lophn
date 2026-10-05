import { z } from "zod";
import { idSchema, seqSchema, sha256Schema } from "../platform/mod.ts";

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
