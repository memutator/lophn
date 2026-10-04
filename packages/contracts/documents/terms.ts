import { z } from "zod";
import {
  archiveStateSchema,
  defineEvent,
  idSchema,
  sha256Schema,
} from "../platform/mod.ts";
import { documentIdSchema, revisionSchema, versionIdSchema } from "./values.ts";
import { sectionKeySchema } from "./values.ts";
import { contextIdSchema } from "./contexts.ts";

export const termIdSchema = idSchema("trm");

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});

const evidenceFields = {
  document: documentIdSchema,
  version: versionIdSchema,
  section: sectionKeySchema.nullable(),
  start_line: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(),
  end_line: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).nullable(),
};
export const termEvidenceSchema = z.strictObject(evidenceFields).refine(
  (value) =>
    (value.start_line === null) === (value.end_line === null) &&
    (value.start_line === null || value.end_line! >= value.start_line),
  { message: "line range must be ordered and paired" },
);
export const termEvidenceRecordSchema = z.object(evidenceFields).refine(
  (value) =>
    (value.start_line === null) === (value.end_line === null) &&
    (value.start_line === null || value.end_line! >= value.start_line),
  { message: "line range must be ordered and paired" },
);
export type TermEvidence = z.infer<typeof termEvidenceSchema>;

function evidenceKey(value: TermEvidence): string {
  return JSON.stringify([
    value.document,
    value.version,
    value.section,
    value.start_line,
    value.end_line,
  ]);
}

export const termEvidenceListSchema = z.array(termEvidenceSchema).refine(
  (items) => new Set(items.map(evidenceKey)).size === items.length,
  { message: "duplicate term evidence" },
);
export const termEvidenceListOutputSchema = z.array(termEvidenceRecordSchema)
  .refine(
    (items) => new Set(items.map(evidenceKey)).size === items.length,
    { message: "duplicate term evidence" },
  );

// agent 후보는 고정 판의 section 또는 줄 범위를 반드시 지정한다.
export const agentTermEvidenceListSchema = termEvidenceListSchema.min(1)
  .refine(
    (items) =>
      items.every((item) => item.section !== null || item.start_line !== null),
    { message: "agent evidence locates a section or line range" },
  );

const termFields = {
  id: termIdSchema,
  context: contextIdSchema,
  name: nonblankSchema,
  definition: nonblankSchema.nullable(),
  evidence: termEvidenceListOutputSchema,
  revision: revisionSchema,
  status: archiveStateSchema,
};
export const termSchema = z.object(termFields);
export type Term = z.infer<typeof termSchema>;

export const termProposeInputSchema = z.strictObject({
  id: termIdSchema,
  context: contextIdSchema,
  name: nonblankSchema,
  evidence: agentTermEvidenceListSchema,
});
export const termCompareSchema = z.strictObject({
  base_revision: revisionSchema,
});
export const termInputSchema = z.strictObject({ term: termIdSchema });

const defineFields = {
  id: termIdSchema.optional(),
  context: contextIdSchema.optional(),
  term: termIdSchema.optional(),
  name: nonblankSchema,
  definition: nonblankSchema,
  evidence: termEvidenceListSchema.optional(),
};
export const termDefineInputSchema = z.strictObject(defineFields).refine(
  (value) =>
    (value.term !== undefined && value.id === undefined &&
      value.context === undefined) ||
    (value.term === undefined && value.id !== undefined &&
      value.context !== undefined),
  { message: "define an existing term or a new id and context" },
);

const updateFields = {
  name: nonblankSchema.optional(),
  definition: nonblankSchema.optional(),
  evidence: termEvidenceListSchema.optional(),
};
export const termUpdateInputSchema = z.strictObject({
  term: termIdSchema,
  ...updateFields,
}).refine(
  (value) =>
    Object.keys(updateFields).some((field) =>
      value[field as keyof typeof updateFields] !== undefined
    ),
  { message: "update must change at least one field" },
);

const blobReferenceSchema = z.object({
  hash: sha256Schema,
  size_bytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
});
const evidenceValueSchema = z.union([
  termEvidenceListOutputSchema,
  blobReferenceSchema,
]);
export const termProposed = defineEvent("TermProposed", {
  subject: termIdSchema,
  payload: z.union([
    z.object({
      context: contextIdSchema,
      name: nonblankSchema,
      evidence: evidenceValueSchema,
    }),
    blobReferenceSchema,
  ]),
});
export const termDefined = defineEvent("TermDefined", {
  subject: termIdSchema,
  payload: z.object({
    context: contextIdSchema,
    name: nonblankSchema,
    before_definition: nonblankSchema.nullable(),
    definition: nonblankSchema,
    before_revision: revisionSchema.nullable(),
  }),
});
export const termUpdated = defineEvent("TermUpdated", {
  subject: termIdSchema,
  payload: z.object({
    before: z.object({
      ...updateFields,
      evidence: evidenceValueSchema.optional(),
    }),
    after: z.object({
      ...updateFields,
      evidence: evidenceValueSchema.optional(),
    }),
    before_revision: revisionSchema,
  }).refine(
    (value) =>
      Object.values(value.before).some((field) => field !== undefined) &&
      Object.values(value.after).some((field) => field !== undefined),
    { message: "update event names the changed fields" },
  ),
});
export const termArchived = defineEvent("TermArchived", {
  subject: termIdSchema,
  payload: z.object({
    context: contextIdSchema,
    before_revision: revisionSchema,
  }),
});
export const termUnarchived = defineEvent("TermUnarchived", {
  subject: termIdSchema,
  payload: z.object({
    context: contextIdSchema,
    before_revision: revisionSchema,
  }),
});

export const TERM_EVENTS = [
  termProposed,
  termDefined,
  termUpdated,
  termArchived,
  termUnarchived,
] as const;
