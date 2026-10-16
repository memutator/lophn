import { z } from "zod";
import { atSchema, sha256Schema } from "../base/values.ts";
import { idSchema } from "../base/ids.ts";
import { jsonObjectSchema } from "../base/json-values.ts";
import { approvalActionSchema } from "../approvals/approvals.ts";
import { sectionKeySchema } from "../projects/mod.ts";
import { questionTextSchema } from "./question-text.ts";

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});

const fixedVersionReferenceFields = {
  document: idSchema("doc"),
  version: idSchema("ver"),
  section: sectionKeySchema.nullable(),
};
const fixedVersionReferenceSchema = z.strictObject(
  fixedVersionReferenceFields,
);
const fixedVersionReferenceOutputSchema = z.object(
  fixedVersionReferenceFields,
);

// OptionAction은 caller 없이 고정한다. 실제 owner 허용·hash 검증은 runtime이다.
export const optionActionSchema = approvalActionSchema.omit({ caller: true });
const optionActionOutputSchema = z.object({
  ...optionActionSchema.shape,
  input: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("inline"), value: jsonObjectSchema }),
    z.object({ kind: z.literal("blob"), sha256: sha256Schema }),
  ]),
});

// 요청의 글은 값이고(description) 저장된 질문은 그 blob의 hash를 가리킨다(description_blob).
const optionBase = {
  key: nonblankSchema,
  label: nonblankSchema,
  evidence: z.array(fixedVersionReferenceSchema),
  adoption: fixedVersionReferenceSchema.nullable(),
  action: optionActionSchema.nullable(),
};
const optionFields = { ...optionBase, description_blob: sha256Schema };

function uniqueReferences(value: {
  evidence: readonly {
    document: string;
    version: string;
    section: string | null;
  }[];
}): boolean {
  const keys = value.evidence.map((reference) =>
    JSON.stringify([reference.document, reference.version, reference.section])
  );
  return new Set(keys).size === keys.length;
}

const questionOptionSchema = z.strictObject({
  ...optionBase,
  description: questionTextSchema,
}).refine(
  uniqueReferences,
  { message: "duplicate fixed version reference" },
);
const questionOptionOutputSchema = z.object({
  ...optionFields,
  evidence: z.array(fixedVersionReferenceOutputSchema),
  adoption: fixedVersionReferenceOutputSchema.nullable(),
  action: optionActionOutputSchema.nullable(),
}).refine(uniqueReferences, { message: "duplicate fixed version reference" });

const recommendationFields = {
  option_key: nonblankSchema.nullable(),
  explanation_blob: sha256Schema,
};
const recommendationSchema = z.strictObject({
  option_key: nonblankSchema.nullable(),
  explanation: questionTextSchema,
});
const recommendationOutputSchema = z.object(recommendationFields);

// 묶음은 질문 1~4개다. 질문 하나는 독립 결정 하나만 담는다.
export const QUESTION_GROUP_MIN_QUESTIONS = 1;
export const QUESTION_GROUP_MAX_QUESTIONS = 4;

const questionInputFields = {
  id: idSchema("qst"),
  prompt: questionTextSchema,
  reason: questionTextSchema,
  options: z.array(questionOptionSchema),
  recommendation: recommendationSchema.nullable(),
};
// 저장된 질문. 묶음 안 순서(position)는 1부터 연속이다.
const questionFields = {
  id: idSchema("qst"),
  group: idSchema("qgr"),
  position: z.number().int().min(1).max(QUESTION_GROUP_MAX_QUESTIONS),
  prompt_blob: sha256Schema,
  reason_blob: sha256Schema,
  options: z.array(questionOptionOutputSchema),
  recommendation: recommendationOutputSchema.nullable(),
};

function questionShape(value: {
  options: readonly { key: string }[];
  recommendation: { option_key: string | null } | null;
}): boolean {
  const keys = value.options.map((option) => option.key);
  if (new Set(keys).size !== keys.length) return false;
  if (value.recommendation === null) return true;
  return keys.length === 0
    ? value.recommendation.option_key === null
    : value.recommendation.option_key !== null &&
      keys.includes(value.recommendation.option_key);
}

const questionInputSchema = z.strictObject(questionInputFields).refine(
  questionShape,
  { message: "question options and recommendation disagree" },
);
export const questionOutputSchema = z.object(questionFields).refine(
  questionShape,
  { message: "question options and recommendation disagree" },
);

type FixedActionQuestion = {
  options: readonly { action: unknown }[];
};

// 고정 action이 있는 선택지를 가진 질문은 질문 하나짜리 묶음으로만 낸다.
// 다른 질문의 답과 한 Submit에 섞으면 무엇을 확정했는지 흐려진다.
export function groupAgreesWithFixedActions(
  questions: readonly FixedActionQuestion[],
): boolean {
  return questions.length === 1 ||
    questions.every((question) =>
      question.options.every((option) => option.action === null)
    );
}

const questionGroupBase = {
  id: idSchema("qgr"),
  turn: idSchema("trn"),
  session: idSchema("ses").nullable(),
  expires_at: atSchema.nullable(),
};

function uniqueIds(questions: readonly { id: string }[]): boolean {
  return new Set(questions.map((question) => question.id)).size ===
    questions.length;
}

export const createQuestionGroupInputSchema = z.strictObject({
  ...questionGroupBase,
  questions: z.array(questionInputSchema)
    .min(QUESTION_GROUP_MIN_QUESTIONS)
    .max(QUESTION_GROUP_MAX_QUESTIONS),
}).refine((value) => uniqueIds(value.questions), {
  message: "duplicate question id in the group",
}).refine((value) => groupAgreesWithFixedActions(value.questions), {
  message: "a question with a fixed action must be a group of one",
});

// 저장된 묶음 제출. 질문마다 설명 글은 blob hash이고 position은 1부터 연속이다.

export type OptionAction = z.infer<typeof optionActionSchema>;
export type QuestionOption = z.infer<typeof questionOptionSchema>;
export type CreateQuestionGroupInput = z.infer<
  typeof createQuestionGroupInputSchema
>;
