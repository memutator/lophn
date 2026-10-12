import { z } from "zod";
import { defineWorker } from "../base/route.ts";
import { sha256Schema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import { relativePathSchema } from "./values.ts";
import {
  contentFileOutputSchema,
  contentFilesOutputSchema,
  formatRefOutputSchema,
} from "./versions.ts";
import { extractedSectionSchema } from "./sections.ts";
import {
  readResultFields,
  readSelectionFields,
  validExtractionFallback,
  validReadSelection,
} from "./read.ts";
import {
  boundedJson,
  countSchema,
  cursorInputFields,
  DOCUMENT_ESTIMATED_TOKEN_BUDGET,
  DOCUMENT_OUTLINE_DEPTH,
  estimatedBudgetSchema,
  nonblankSchema,
  publicPage,
  publicRead,
  readActors,
  readErrors,
  sectionStatusSchema,
  validPagination,
} from "./read-values.ts";

const guideReferenceFields = {
  lophn_version: nonblankSchema,
  title: nonblankSchema,
  content_hash: sha256Schema,
};
export const guideReferenceSchema = z.strictObject(guideReferenceFields);
export const guideReferenceOutputSchema = z.object(guideReferenceFields);
export type GuideReference = z.infer<typeof guideReferenceSchema>;
export const bundledGuideSchema = z.object({
  ...guideReferenceFields,
  files: contentFilesOutputSchema,
});
export type BundledGuide = z.infer<typeof bundledGuideSchema>;
export const guideSectionSchema = z.object({
  ...extractedSectionSchema.shape,
  estimated_tokens: countSchema,
  children_count: countSchema,
  hidden_children_count: countSchema,
}).refine((value) => extractedSectionSchema.safeParse(value).success).refine((
  value,
) =>
  value.estimated_tokens === Math.ceil(value.characters / 3) &&
  value.hidden_children_count <= value.children_count
);
export const guideListPageSchema = publicPage(z.object({
  lophn_version: nonblankSchema,
  guides: z.array(bundledGuideSchema),
})).refine((value) =>
  value.guides.every((guide) => guide.lophn_version === value.lophn_version) &&
  new Set(
      value.guides.map((guide) =>
        JSON.stringify([guide.lophn_version, guide.title, guide.content_hash])
      ),
    ).size === value.guides.length
);
export const guideList = defineWorker({
  resource: "guides",
  method: "list",
  name: "guide.list",
  input: z.strictObject({ ...cursorInputFields }),
  output: guideListPageSchema,
  actors: readActors,
  errors: readErrors,
});
export const guideGetResultSchema = publicRead(
  z.object({ guide: bundledGuideSchema }),
);
export const guideGet = defineWorker({
  resource: "guides",
  method: "get",
  name: "guide.get",
  input: z.strictObject({ reference: guideReferenceSchema }),
  output: guideGetResultSchema,
  actors: readActors,
  errors: readErrors,
});
const guideExtractionFields = {
  reference: guideReferenceOutputSchema,
  path: relativePathSchema,
  format: formatRefOutputSchema,
  module_hash: sha256Schema,
  section_status: sectionStatusSchema,
};
export const guideFileReferenceSchema = z.object({
  reference: guideReferenceOutputSchema,
  ...contentFileOutputSchema.shape,
});
function validGuideFile(value: {
  reference: GuideReference;
  path: string;
  file: z.infer<typeof guideFileReferenceSchema> | null;
}): boolean {
  return value.file === null ||
    (value.file.reference.lophn_version === value.reference.lophn_version &&
      value.file.reference.title === value.reference.title &&
      value.file.reference.content_hash === value.reference.content_hash &&
      value.file.path === value.path);
}
export const guideOutlinePageSchema = publicPage(z.object({
  ...guideExtractionFields,
  failure_reason: nonblankSchema.nullable(),
  file: guideFileReferenceSchema.nullable(),
  entries: z.array(guideSectionSchema),
})).refine(validExtractionFallback).refine(validGuideFile).refine((value) =>
  value.module_hash === value.format.module_hash
);
export const guideOutline = defineWorker({
  resource: "guides",
  method: "outline",
  name: "guide.outline",
  input: z.strictObject({
    reference: guideReferenceSchema,
    path: relativePathSchema,
    depth: z.number().int().nonnegative().max(6).default(
      DOCUMENT_OUTLINE_DEPTH,
    ),
    estimated_token_budget: estimatedBudgetSchema.default(
      DOCUMENT_ESTIMATED_TOKEN_BUDGET,
    ),
    ...cursorInputFields,
  }),
  output: guideOutlinePageSchema,
  actors: readActors,
  errors: readErrors,
});
export const guideReadResultSchema = boundedJson(
  withReadCommon(z.object({
    ...guideExtractionFields,
    ...readResultFields,
    file: guideFileReferenceSchema.nullable(),
  })).refine(validPagination).refine(validReadSelection).refine(validGuideFile)
    .refine((value) =>
      value.module_hash === value.format.module_hash &&
      (!["unverified", "unsupported"].includes(value.section_status) ||
        value.file !== null)
    ),
);
export type GuideReadResult = z.infer<typeof guideReadResultSchema>;
export const guideRead = defineWorker({
  resource: "guides",
  method: "read",
  name: "guide.read",
  input: z.strictObject({
    reference: guideReferenceSchema,
    path: relativePathSchema,
    ...readSelectionFields,
  }),
  output: guideReadResultSchema,
  actors: readActors,
  errors: readErrors,
});
// 설치 manifest/files는 offline·read-only worker에서 읽는다. ledger Document/ver/place 생성은 없다.
// reference와 manifest membership/설치 판의 불변성은 host가 매 요청 확인한다.
export const GUIDE_ROUTES = [
  guideList,
  guideGet,
  guideOutline,
  guideRead,
] as const;
