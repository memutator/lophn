import { z } from "zod";
import {
  actorSchema,
  archiveStateSchema,
  atSchema,
  seqSchema,
  sha256Schema,
} from "../platform/mod.ts";
import {
  appIdSchema,
  documentIdSchema,
  projectIdSchema,
  sectionKeySchema,
  slugSchema,
  versionIdSchema,
} from "./values.ts";
import { formatRefOutputSchema } from "./versions.ts";
import { type ExtractedSection, extractedSectionSchema } from "./sections.ts";
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
  z.object({ kind: z.literal("unplaced"), document_count: countSchema }),
]);
export type RootOutlineEntry = z.infer<typeof rootOutlineEntrySchema>;

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
