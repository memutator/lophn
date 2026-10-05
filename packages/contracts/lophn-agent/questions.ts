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
  answerInputSchema,
  answerSchema,
  optionAnswerInputSchema,
  questionActionEvidenceSchema,
  questionClosedReasonSchema,
  questionRefSchema,
  questionStatusSchema,
} from "./decision-values.ts";
import { questionTextSchema } from "./question-text.ts";
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
  "unavailable",
] as const;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

const readActors = ["user", "agent", "machine", "coding_agent"] as const;

// 사람 결정은 답 자체다. 표시는 같은 질문의 questions/read를 읽는다. 고정 action이 있는
// 선택지를 고르는 답만 사람 결정 확인(confirmation handle)을 요구한다. user token은 직접
// 사람 클릭의 증거가 아니므로(platform/identity#R14) action 답은 이 route로만 받는다.
export const QUESTION_ANSWER_DECISION = defineDecision("answer_question");

// 일반 답: action이 없는 선택지 또는 자유 답. 자유 답은 글을 값으로 싣는다(Q38).
export const answerQuestionInputSchema = questionRefSchema.extend({
  answer: answerInputSchema,
});

// action 답: 고정 action이 있는 선택지를 고른다. action의 binding_hash와 evidence가 함께
// 있어야 하고 evidence는 답한 선택지를 가리켜야 한다.
export const answerQuestionActionInputSchema = questionRefSchema.extend({
  answer: optionAnswerInputSchema,
  binding_hash: sha256Schema,
  evidence: questionActionEvidenceSchema,
}).refine(
  (value) =>
    value.evidence.question === value.question &&
    value.evidence.option === value.answer.option_key,
  { message: "action evidence must match the answered option" },
);

export const deferQuestionInputSchema = questionRefSchema;

export const cancelQuestionInputSchema = questionRefSchema.extend({
  closed_reason: questionClosedReasonSchema.exclude(["deferred", "expired"]),
  // 취소 이유는 글을 값으로 싣는다. core가 blob으로 준비한다(Q38).
  closed_reason_text: questionTextSchema,
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
});

export const answerQuestionAction = defineCommand({
  resource: "questions",
  method: "answer-action",
  name: "AnswerQuestionAction",
  input: answerQuestionActionInputSchema,
  output: closedOutput,
  compare: z.strictObject({ created_seq: seqSchema }),
  actors: ["user"],
  errors: [...commandErrors],
  confirmation: "required",
  binding: ["question", "created_seq", "answer", "binding_hash"],
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

// 닫은 이유는 고정 코드다. 사람이 글을 남기는 취소(cancelled·superseded)만 이유 blob이
// 있고, 미루기(deferred)와 기한 만료(expired)는 사람 글이 없으므로 blob이 없다.
// 저장하지 않은 blob을 가리키지 않는다.
function closureAgrees(value: {
  status: string;
  closed_reason: string | null;
  closed_reason_blob: string | null;
}): boolean {
  switch (value.status) {
    case "pending":
    case "answered":
      return value.closed_reason === null && value.closed_reason_blob === null;
    case "expired":
      return value.closed_reason === "expired" &&
        value.closed_reason_blob === null;
    case "cancelled":
      return value.closed_reason === "deferred"
        ? value.closed_reason_blob === null
        : (value.closed_reason === "cancelled" ||
          value.closed_reason === "superseded") &&
          value.closed_reason_blob !== null;
    default:
      return false;
  }
}

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
    closureAgrees(value),
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

// 질문의 글. 사람 화면(user)과 질문한 assignment의 agent·machine·coding_agent가 읽고,
// 범위 밖 질문은 없는 질문과 똑같이 not_found다. 글 blob 하나라도 읽을 수 없으면 일부만
// 돌려주지 않고 unavailable이다. 답 글과 취소 이유는 사람이 남긴 글이라 coding_agent에게는
// 싣지 않는다(coding-agent/mcp-server#R18: 사람 답은 노출하지 않는다).
export const questionTextInputSchema = questionReadInputSchema;
export const questionTextOutputSchema = withReadCommon(z.object({
  question: idSchema("qst"),
  prompt: z.string(),
  reason: z.string(),
  options: z.array(z.object({
    key: z.string().min(1),
    description: z.string(),
  })),
  recommendation: z.object({
    option_key: z.string().min(1).nullable(),
    explanation: z.string(),
  }).nullable(),
  // 자유 답의 글. 선택지 답·미답이면 null이다.
  answer_text: z.string().nullable(),
  // 취소 이유의 글. 미루기·만료·미종료면 null이다.
  closed_reason_text: z.string().nullable(),
}));

export const questionText = defineRead({
  resource: "questions",
  method: "text",
  name: "ReadQuestionText",
  input: questionTextInputSchema,
  output: questionTextOutputSchema,
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

// 기한 만료는 사람 글이 없는 닫힘이다. 이유 blob이 없다.
export const questionExpired = defineEvent("QuestionExpired", {
  subject: questionSubject,
  payload: z.object({
    created_seq: seqSchema,
  }),
});

export const questionCancelled = defineEvent("QuestionCancelled", {
  subject: questionSubject,
  payload: z.object({
    created_seq: seqSchema,
    // 미루기(deferred=true)는 사람 글이 없어 null이고 취소는 이유 blob이 있다.
    closed_reason_blob: sha256Schema.nullable(),
    deferred: z.boolean(),
  }).refine(
    (value) => value.deferred === (value.closed_reason_blob === null),
    { message: "only a deferral has no reason blob" },
  ),
});

export const QUESTION_COMMANDS = [
  createQuestion,
  answerQuestion,
  answerQuestionAction,
  deferQuestion,
  cancelQuestion,
  expireQuestion,
  applyQuestionOption,
  questionRead,
  questionList,
  questionText,
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
