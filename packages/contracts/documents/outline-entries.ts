import { z } from "zod";
import {
  actorSchema,
  archiveStateSchema,
  atSchema,
  idSchema,
  seqSchema,
  sha256Schema,
} from "../platform/mod.ts";
import { SECTION_STATUSES } from "./address.ts";
import {
  appIdSchema,
  documentIdSchema,
  projectIdSchema,
  sectionKeySchema,
  slugSchema,
  versionIdSchema,
} from "./values.ts";
import { formatRefOutputSchema } from "./versions.ts";
import {
  type ExtractedSection,
  extractedSectionSchema,
  lineRangeOutputSchema,
} from "./sections.ts";
import {
  countSchema,
  EXCERPT_CODEPOINT_LIMIT,
  nonblankSchema,
} from "./read-values.ts";

export const summaryCacheSchema = z.object({
  version: versionIdSchema,
  section: sectionKeySchema.nullable(),
  text: z.string(),
  input_hash: sha256Schema,
  stale: z.boolean(),
});
export type SummaryCache = z.infer<typeof summaryCacheSchema>;
export const excerptSchema = z.string().refine((value) =>
  [...value].length <= EXCERPT_CODEPOINT_LIMIT
);
export const placeOutlineEntrySchema = z.object({
  document: documentIdSchema,
  name: slugSchema.nullable(),
  title: z.string(),
  version: versionIdSchema,
  latest_version: versionIdSchema,
  format: formatRefOutputSchema,
  saved_by: actorSchema,
  saved_at: atSchema,
  excerpt: excerptSchema.nullable(),
  summary: summaryCacheSchema.nullable(),
  section_count: countSchema,
}).refine((value) => value.summary === null || value.excerpt === null).refine(
  (value) =>
    value.summary === null ||
    value.summary.stale === (value.summary.version !== value.version),
);
export type PlaceOutlineEntry = z.infer<typeof placeOutlineEntrySchema>;

const rootFields = {
  title: z.string(),
  purpose: z.string(),
  activity_seq: seqSchema,
};
export const rootOutlineEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("project"),
    id: projectIdSchema,
    ...rootFields,
    document_count: countSchema,
  }),
  z.object({
    kind: z.literal("app"),
    id: appIdSchema,
    ...rootFields,
    document_count: countSchema,
  }),
  z.object({
    kind: z.literal("context"),
    id: idSchema("ctx"),
    ...rootFields,
    basis_count: countSchema,
    reference_app_count: countSchema,
  }),
  z.object({ kind: z.literal("unplaced"), document_count: countSchema }),
]);
export type RootOutlineEntry = z.infer<typeof rootOutlineEntrySchema>;

export const contextTargetOutputSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("document"),
    document: documentIdSchema,
    section: sectionKeySchema.nullable(),
  }),
  z.object({
    kind: z.literal("app_command"),
    app: appIdSchema,
    command: nonblankSchema,
  }),
]);
const contextItemFields = {
  perspective: z.enum(["basis", "reference", "watch"]),
  reason: nonblankSchema,
  title: z.string(),
  readable: z.boolean(),
};
export const contextOutlineEntrySchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("document"),
    ...contextItemFields,
    target: contextTargetOutputSchema.options[0],
    version: versionIdSchema.nullable(),
    latest_version: versionIdSchema.nullable(),
    format: formatRefOutputSchema.nullable(),
    module_hash: sha256Schema.nullable(),
    section_status: z.enum(SECTION_STATUSES),
  }).refine((value) =>
    (!value.readable ||
      (value.version !== null && value.latest_version !== null)) &&
    ((value.version === null) === (value.format === null)) &&
    ((value.format === null) === (value.module_hash === null)) &&
    (value.format === null || value.format.module_hash === value.module_hash)
  ),
  z.object({
    kind: z.literal("app_command"),
    ...contextItemFields,
    target: contextTargetOutputSchema.options[1],
  }),
]);
export type ContextOutlineEntry = z.infer<typeof contextOutlineEntrySchema>;
export const termEvidenceOutputSchema = z.object({
  document: documentIdSchema,
  version: versionIdSchema,
  section: sectionKeySchema.nullable(),
  range: lineRangeOutputSchema.nullable(),
});
const termFields = {
  id: idSchema("trm"),
  context: idSchema("ctx"),
  name: nonblankSchema,
  evidence: z.array(termEvidenceOutputSchema),
  revision: seqSchema,
  status: archiveStateSchema,
};
export const definedTermOutputSchema = z.object({
  ...termFields,
  definition: nonblankSchema,
});
export const candidateTermOutputSchema = z.object({
  ...termFields,
  definition: z.null(),
});

// SectionExtraction과 같은 key/range 규약을 재사용하되 문서 고정 판 통계를 더한다.
export const sectionSchema = z.object({
  ...extractedSectionSchema.shape,
  version: versionIdSchema,
  estimated_tokens: countSchema,
  children_count: countSchema,
  hidden_children_count: countSchema,
}).refine((value) => extractedSectionSchema.safeParse(value).success).refine(
  (value) =>
    value.estimated_tokens === Math.ceil(value.characters / 3) &&
    value.hidden_children_count <= value.children_count,
);
export type Section = ExtractedSection & z.infer<typeof sectionSchema>;
export const seriesOutlineEntrySchema = z.object({
  key: nonblankSchema,
  document: documentIdSchema,
  title: z.string(),
  version: versionIdSchema,
  latest_version: versionIdSchema,
  status: archiveStateSchema,
});
