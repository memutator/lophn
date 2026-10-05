import { z } from "zod";
import {
  atSchema,
  idSchema,
  jsonObjectSchema,
  sha256Schema,
} from "../platform/mod.ts";
import { approvalActionSchema } from "../platform/mod.ts";
import { sectionKeySchema } from "../documents/mod.ts";
import { questionTextSchema } from "./question-text.ts";

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});

const fixedVersionReferenceFields = {
  document: idSchema("doc"),
  version: idSchema("ver"),
  section: sectionKeySchema.nullable(),
};
export const fixedVersionReferenceSchema = z.strictObject(
  fixedVersionReferenceFields,
);
export const fixedVersionReferenceOutputSchema = z.object(
  fixedVersionReferenceFields,
);

// OptionAction은 caller 없이 고정한다. 실제 owner 허용·hash 검증은 runtime이다.
export const optionActionSchema = approvalActionSchema.omit({ caller: true });
export const optionActionOutputSchema = z.object({
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

export const questionOptionSchema = z.strictObject({
  ...optionBase,
  description: questionTextSchema,
}).refine(
  uniqueReferences,
  { message: "duplicate fixed version reference" },
);
export const questionOptionOutputSchema = z.object({
  ...optionFields,
  evidence: z.array(fixedVersionReferenceOutputSchema),
  adoption: fixedVersionReferenceOutputSchema.nullable(),
  action: optionActionOutputSchema.nullable(),
}).refine(uniqueReferences, { message: "duplicate fixed version reference" });

const recommendationFields = {
  option_key: nonblankSchema.nullable(),
  explanation_blob: sha256Schema,
};
export const recommendationSchema = z.strictObject({
  option_key: nonblankSchema.nullable(),
  explanation: questionTextSchema,
});
export const recommendationOutputSchema = z.object(recommendationFields);

const createQuestionBase = {
  id: idSchema("qst"),
  run: idSchema("run"),
  session: idSchema("ses").nullable(),
  expires_at: atSchema.nullable(),
};
const createQuestionInputFields = {
  ...createQuestionBase,
  prompt: questionTextSchema,
  reason: questionTextSchema,
  options: z.array(questionOptionSchema),
  recommendation: recommendationSchema.nullable(),
};
const createQuestionFields = {
  ...createQuestionBase,
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

export const createQuestionInputSchema = z.strictObject(
  createQuestionInputFields,
).refine(questionShape, {
  message: "question options and recommendation disagree",
});
export const createQuestionSubmissionOutputSchema = z.object(
  createQuestionFields,
).refine(questionShape, {
  message: "question options and recommendation disagree",
});

export type FixedVersionReference = z.infer<typeof fixedVersionReferenceSchema>;
export type OptionAction = z.infer<typeof optionActionSchema>;
export type QuestionOption = z.infer<typeof questionOptionSchema>;
export type Recommendation = z.infer<typeof recommendationSchema>;
export type CreateQuestionInput = z.infer<typeof createQuestionInputSchema>;
