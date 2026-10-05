import { z } from "zod";
import {
  defineCommand,
  defineEvent,
  defineRead,
  idSchema,
  seqSchema,
  settingMutationSchema,
  sha256Schema,
  withReadCommon,
} from "../platform/mod.ts";
import { defineDecision } from "../platform/confirmation-handle.ts";
import { readCursorSchema } from "./run-values.ts";
import {
  answerSchema,
  questionActionEvidenceSchema,
  questionClosedReasonSchema,
  questionRefSchema,
  questionStatusSchema,
} from "./decision-values.ts";
import {
  createQuestionInputSchema,
  createQuestionSubmissionOutputSchema,
  optionActionOutputSchema,
  optionActionSchema,
  questionOptionOutputSchema,
  recommendationOutputSchema,
} from "./question-submission.ts";

const commandErrors = [
  "invalid_input",
  "forbidden",
  "not_found",
  "conflict",
  "unauthorized",
] as const;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

const readActors = ["user", "agent", "machine", "coding_agent"] as const;

// 사람 결정은 답 자체다. 표시는 같은 질문의 questions/read를 읽는다.
export const QUESTION_ANSWER_DECISION = defineDecision("answer_question");

export const answerQuestionInputSchema = questionRefSchema.extend({
  answer: answerSchema,
  binding_hash: sha256Schema.nullable(),
  evidence: questionActionEvidenceSchema.nullable(),
}).refine(
  (value) =>
    (value.binding_hash === null) === (value.evidence === null) &&
    (value.evidence === null ||
      (value.evidence.question === value.question &&
        value.answer.kind === "option" &&
        value.evidence.option === value.answer.option_key)),
  { message: "action evidence must match the answered option" },
);

export const deferQuestionInputSchema = questionRefSchema;

export const cancelQuestionInputSchema = questionRefSchema.extend({
  closed_reason: questionClosedReasonSchema.exclude(["deferred", "expired"]),
  closed_reason_blob: sha256Schema,
});

export const expireQuestionInputSchema = questionRefSchema;

export const applyQuestionOptionInputSchema = z.strictObject({
  question: idSchema("qst"),
  answered_seq: seqSchema,
  option_key: z.string().min(1),
  action: optionActionSchema,
  evidence: questionActionEvidenceSchema,
}).refine(
  (value) =>
    value.evidence.question === value.question &&
    value.evidence.option === value.option_key,
  { message: "evidence must name the applied option" },
);

const createdOutput = z.object({
  id: idSchema("qst"),
  status: z.literal("pending"),
  created_seq: seqSchema,
});

const closedOutput = z.object({
  id: idSchema("qst"),
  status: questionStatusSchema.exclude(["pending"]),
  closed_seq: seqSchema,
  replayed: z.boolean(),
});

const appliedOutput = z.object({
  question: idSchema("qst"),
  option_key: z.string().min(1),
  applied: z.boolean(),
  receipt_seq: seqSchema.nullable(),
});

export const createQuestion = defineCommand({
  resource: "questions",
  method: "create",
  name: "CreateQuestion",
  input: createQuestionInputSchema,
  output: createdOutput,
  actors: ["agent"],
  errors: [...commandErrors],
});

export const answerQuestion = defineCommand({
  resource: "questions",
  method: "answer",
  name: "AnswerQuestion",
  input: answerQuestionInputSchema,
  output: closedOutput,
  compare: z.strictObject({ created_seq: seqSchema }),
  actors: ["user"],
  errors: [...commandErrors],
  confirmation: "required",
  binding: ["question", "created_seq", "answer"],
  display_read: "/v1/questions/read",
});

export const deferQuestion = defineCommand({
  resource: "questions",
  method: "defer",
  name: "DeferQuestion",
  input: deferQuestionInputSchema,
  output: closedOutput,
  compare: z.strictObject({ created_seq: seqSchema }),
  actors: ["user"],
  errors: [...commandErrors],
});

export const cancelQuestion = defineCommand({
  resource: "questions",
  method: "cancel",
  name: "CancelQuestion",
  input: cancelQuestionInputSchema,
  output: closedOutput,
  compare: z.strictObject({ created_seq: seqSchema }),
  actors: ["user", "agent", "machine"],
  errors: [...commandErrors],
});

export const expireQuestion = defineCommand({
  resource: "questions",
  method: "expire",
  name: "ExpireQuestion",
  input: expireQuestionInputSchema,
  output: closedOutput,
  compare: z.strictObject({ created_seq: seqSchema }),
  actors: ["machine"],
  errors: [...commandErrors],
});

export const applyQuestionOption = defineCommand({
  resource: "questions",
  method: "apply-option",
  name: "ApplyQuestionOption",
  input: applyQuestionOptionInputSchema,
  output: appliedOutput,
  actors: ["machine"],
  errors: [...commandErrors],
});

const questionRecordSchema = createQuestionSubmissionOutputSchema.and(z.object({
  status: questionStatusSchema,
  answer: answerSchema.nullable(),
  closed_reason: questionClosedReasonSchema.nullable(),
  closed_reason_blob: sha256Schema.nullable(),
  created_seq: seqSchema,
  closed_seq: seqSchema.nullable(),
  applied: z.boolean(),
})).refine(
  (value) =>
    (value.status === "pending") === (value.closed_seq === null) &&
    (value.status === "answered") === (value.answer !== null) &&
    (value.status === "pending" || value.status === "answered"
      ? value.closed_reason === null && value.closed_reason_blob === null
      : value.closed_reason !== null && value.closed_reason_blob !== null),
  { message: "question status and closure disagree" },
);

export const questionReadInputSchema = z.strictObject({
  question: idSchema("qst"),
});

export const questionListInputSchema = z.strictObject({
  run: idSchema("run").optional(),
  assignment: idSchema("asg").optional(),
  status: questionStatusSchema.optional(),
  cursor: readCursorSchema.optional(),
});

export const questionRead = defineRead({
  resource: "questions",
  method: "read",
  name: "ReadQuestion",
  input: questionReadInputSchema,
  output: withReadCommon(z.object({ question: questionRecordSchema })),
  actors: readActors,
  errors: [...readErrors],
});

export const questionList = defineRead({
  resource: "questions",
  method: "list",
  name: "ListQuestions",
  input: questionListInputSchema,
  output: withReadCommon(
    z.object({ questions: z.array(questionRecordSchema) }),
  ),
  actors: readActors,
  errors: [...readErrors],
});

const questionSubject = idSchema("qst");

// 선택지마다 key와, 고정 action이 platform/settings 변경이면 그 변경 목록을 싣는다.
// platform/settings#R29가 machine ApplySettings의 질문 근거를 이 event에서 대조한다.
// settings 변경이 아닌 선택지(자유 답·설명 요청·다른 owner action)는 changes가 null이다.
export const questionCreatedOptionSchema = z.object({
  key: z.string().min(1),
  changes: z.array(settingMutationSchema).nullable(),
});

export const questionCreated = defineEvent("QuestionCreated", {
  subject: questionSubject,
  payload: z.object({
    run: idSchema("run"),
    session: idSchema("ses").nullable(),
    options: z.array(questionCreatedOptionSchema).default([]),
  }),
});

export const questionAnswered = defineEvent("QuestionAnswered", {
  subject: questionSubject,
  payload: z.object({
    created_seq: seqSchema,
    answer: answerSchema,
    binding_hash: sha256Schema.nullable(),
  }),
});

export const questionExpired = defineEvent("QuestionExpired", {
  subject: questionSubject,
  payload: z.object({
    created_seq: seqSchema,
    closed_reason_blob: sha256Schema,
  }),
});

export const questionCancelled = defineEvent("QuestionCancelled", {
  subject: questionSubject,
  payload: z.object({
    created_seq: seqSchema,
    closed_reason_blob: sha256Schema,
    deferred: z.boolean(),
  }),
});

export const QUESTION_COMMANDS = [
  createQuestion,
  answerQuestion,
  deferQuestion,
  cancelQuestion,
  expireQuestion,
  applyQuestionOption,
  questionRead,
  questionList,
] as const;

export const QUESTION_EVENTS = [
  questionCreated,
  questionAnswered,
  questionExpired,
  questionCancelled,
] as const;

export {
  optionActionOutputSchema,
  optionActionSchema,
  questionOptionOutputSchema,
  recommendationOutputSchema,
};
