import { z } from "zod";
import { atSchema, seqSchema, sha256Schema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { defineEvent } from "../base/event.ts";
import { idSchema } from "../base/ids.ts";
import { settingMutationSchema } from "../config/settings.ts";
import { withReadCommon } from "../base/envelope.ts";
import { defineDecision } from "../base/confirmation-handle.ts";
import { readCursorSchema } from "./run-values.ts";
import {
  answerInputSchema,
  answerSchema,
  optionAnswerInputSchema,
  questionActionEvidenceSchema,
  questionClosedReasonSchema,
  questionGroupRefSchema,
  questionStatusSchema,
} from "./decision-values.ts";
import { questionTextSchema } from "./question-text.ts";
import {
  createQuestionGroupInputSchema,
  groupAgreesWithFixedActions,
  optionActionOutputSchema,
  optionActionSchema,
  QUESTION_GROUP_MAX_QUESTIONS,
  QUESTION_GROUP_MIN_QUESTIONS,
  questionOptionOutputSchema,
  questionOutputSchema,
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

// 사람 결정은 묶음 Submit 자체다. 표시는 같은 묶음의 question-groups가 아니라 questions/read를
// 읽는다. 고정 action이 있는 선택지를 고르는 답만 사람 결정 확인(confirmation handle)을
// 요구한다. user token은 직접 사람 클릭의 증거가 아니므로 action 답은
// 이 route로만 받는다. 확인 handle의 결정 이름은 ledger가 검사하는 command 이름(route.name)이다.
export const QUESTION_ANSWER_DECISION = defineDecision("AnswerQuestionAction");

// 묶음의 답 하나: 질문 ID와 그 질문의 답(선택지 key 또는 자유 답 글).
export const groupAnswerInputSchema = z.strictObject({
  question: idSchema("qst"),
  answer: answerInputSchema,
});

function distinctQuestions(answers: readonly { question: string }[]): boolean {
  return new Set(answers.map((entry) => entry.question)).size ===
    answers.length;
}

// 일반 답: action이 없는 선택지 또는 자유 답. 묶음 전체에 한 번이고 질문마다 답 하나씩이다.
// 모든 질문에 답했는지(일부만이면 invalid_input)는 묶음을 아는 owner와 group 검사가 본다.
// 자유 답은 글을 값으로 싣는다.
export const answerQuestionGroupInputSchema = questionGroupRefSchema.extend({
  answers: z.array(groupAnswerInputSchema)
    .min(QUESTION_GROUP_MIN_QUESTIONS)
    .max(QUESTION_GROUP_MAX_QUESTIONS),
}).refine((value) => distinctQuestions(value.answers), {
  message: "a question can be answered once in the submit",
});

// action 답: 고정 action이 있는 선택지를 고른다(질문 하나짜리 묶음). action의 binding_hash와
// evidence가 함께 있어야 하고 evidence는 답한 선택지를 가리켜야 한다.
export const answerQuestionActionInputSchema = questionGroupRefSchema.extend({
  answer: optionAnswerInputSchema,
  binding_hash: sha256Schema,
  evidence: questionActionEvidenceSchema,
}).refine(
  (value) => value.evidence.option === value.answer.option_key,
  { message: "action evidence must match the answered option" },
);

// Skip: 묶음 전체를 답 없이 미룬다.
export const deferQuestionGroupInputSchema = questionGroupRefSchema;

export const cancelQuestionGroupInputSchema = questionGroupRefSchema.extend({
  closed_reason: questionClosedReasonSchema.exclude(["deferred", "expired"]),
  // 취소 이유는 글을 값으로 싣는다. core가 blob으로 준비한다.
  closed_reason_text: questionTextSchema,
});

export const expireQuestionGroupInputSchema = questionGroupRefSchema;

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
  id: idSchema("qgr"),
  status: z.literal("pending"),
  created_seq: seqSchema,
});

const closedOutput = z.object({
  id: idSchema("qgr"),
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

export const createQuestionGroup = defineCommand({
  resource: "questions",
  method: "create",
  name: "CreateQuestionGroup",
  input: createQuestionGroupInputSchema,
  output: createdOutput,
  actors: ["agent"],
  errors: [...commandErrors],
});

export const answerQuestionGroup = defineCommand({
  resource: "questions",
  method: "answer",
  name: "AnswerQuestionGroup",
  input: answerQuestionGroupInputSchema,
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
  binding: ["group", "created_seq", "answer", "binding_hash"],
  display_read: "/v1/questions/read",
});

export const deferQuestionGroup = defineCommand({
  resource: "questions",
  method: "defer",
  name: "DeferQuestionGroup",
  input: deferQuestionGroupInputSchema,
  output: closedOutput,
  compare: z.strictObject({ created_seq: seqSchema }),
  actors: ["user"],
  errors: [...commandErrors],
});

export const cancelQuestionGroup = defineCommand({
  resource: "questions",
  method: "cancel",
  name: "CancelQuestionGroup",
  input: cancelQuestionGroupInputSchema,
  output: closedOutput,
  compare: z.strictObject({ created_seq: seqSchema }),
  actors: ["user", "agent", "machine"],
  errors: [...commandErrors],
});

export const expireQuestionGroup = defineCommand({
  resource: "questions",
  method: "expire",
  name: "ExpireQuestionGroup",
  input: expireQuestionGroupInputSchema,
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

// 묶음이 answered일 때만 모든 질문에 답이 있다. 질문 안의 답은 묶음 상태를 따른다.
const recordedQuestionSchema = questionOutputSchema.and(z.object({
  answer: answerSchema.nullable(),
  applied: z.boolean(),
}));

const questionGroupRecordSchema = z.object({
  id: idSchema("qgr"),
  run: idSchema("run"),
  session: idSchema("ses").nullable(),
  expires_at: atSchema.nullable(),
  status: questionStatusSchema,
  closed_reason: questionClosedReasonSchema.nullable(),
  closed_reason_blob: sha256Schema.nullable(),
  created_seq: seqSchema,
  closed_seq: seqSchema.nullable(),
  questions: z.array(recordedQuestionSchema)
    .min(QUESTION_GROUP_MIN_QUESTIONS)
    .max(QUESTION_GROUP_MAX_QUESTIONS),
}).refine(
  (value) =>
    (value.status === "pending") === (value.closed_seq === null) &&
    value.questions.every((question) =>
      (question.answer !== null) === (value.status === "answered") &&
      (!question.applied || value.status === "answered")
    ) &&
    closureAgrees(value),
  { message: "question group status and closure disagree" },
).refine(
  (value) =>
    value.questions.every((question, index) =>
      question.position === index + 1 && question.group === value.id
    ) &&
    new Set(value.questions.map((question) => question.id)).size ===
      value.questions.length &&
    groupAgreesWithFixedActions(value.questions),
  { message: "question group positions or fixed actions disagree" },
);

export const questionGroupReadInputSchema = z.strictObject({
  group: idSchema("qgr"),
});

export const questionGroupListInputSchema = z.strictObject({
  run: idSchema("run").optional(),
  session: idSchema("ses").optional(),
  assignment: idSchema("asg").optional(),
  status: questionStatusSchema.optional(),
  cursor: readCursorSchema.optional(),
});

export const questionRead = defineRead({
  resource: "questions",
  method: "read",
  name: "ReadQuestionGroup",
  input: questionGroupReadInputSchema,
  output: withReadCommon(z.object({ group: questionGroupRecordSchema })),
  actors: readActors,
  errors: [...readErrors],
});

export const questionList = defineRead({
  resource: "questions",
  method: "list",
  name: "ListQuestionGroups",
  input: questionGroupListInputSchema,
  output: withReadCommon(
    z.object({ groups: z.array(questionGroupRecordSchema) }),
  ),
  actors: readActors,
  errors: [...readErrors],
});

// 묶음의 글. 사람 화면(user)과 질문한 assignment의 agent·machine·coding_agent가 읽고,
// 범위 밖 묶음은 없는 묶음과 똑같이 not_found다. 묶음 안 글 blob 하나라도 읽을 수 없으면
// 일부만 돌려주지 않고 unavailable이다. 답 글과 취소 이유는 사람이 남긴 글이라
// coding_agent에게는 싣지 않는다(사람 답은 노출하지 않는다).
export const questionTextInputSchema = questionGroupReadInputSchema;
export const questionTextOutputSchema = withReadCommon(z.object({
  group: idSchema("qgr"),
  questions: z.array(z.object({
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
  })).min(QUESTION_GROUP_MIN_QUESTIONS).max(QUESTION_GROUP_MAX_QUESTIONS),
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

// 이벤트의 subject는 묶음 하나이고 payload가 질문마다의 값을 담는다.
const questionSubject = idSchema("qgr");

// 질문마다 선택지의 key와, 고정 action이 platform/settings 변경이면 그 변경 목록을 싣는다.
// platform/settings가 machine ApplySettings의 질문 근거를 이 event에서 대조한다.
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
    questions: z.array(z.object({
      id: idSchema("qst"),
      options: z.array(questionCreatedOptionSchema).default([]),
    })).min(QUESTION_GROUP_MIN_QUESTIONS).max(QUESTION_GROUP_MAX_QUESTIONS),
  }),
});

export const questionAnswered = defineEvent("QuestionAnswered", {
  subject: questionSubject,
  payload: z.object({
    created_seq: seqSchema,
    answers: z.array(z.object({
      question: idSchema("qst"),
      answer: answerSchema,
    })).min(QUESTION_GROUP_MIN_QUESTIONS).max(QUESTION_GROUP_MAX_QUESTIONS),
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
  createQuestionGroup,
  answerQuestionGroup,
  answerQuestionAction,
  deferQuestionGroup,
  cancelQuestionGroup,
  expireQuestionGroup,
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
