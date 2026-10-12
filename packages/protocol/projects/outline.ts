import { z } from "zod";
import {
  defineRead,
  defineWorker,
  idSchema,
  seqSchema,
  sha256Schema,
} from "../platform/mod.ts";
import { placeRefSchema } from "./address.ts";
import { documentIdSchema, slugSchema, versionIdSchema } from "./values.ts";
import { formatRefOutputSchema } from "./versions.ts";
import { indexCoverageSchema } from "./search.ts";
import { validExtractionFallback } from "./read.ts";
import {
  placeOutlineEntrySchema,
  rootOutlineEntrySchema,
  sectionSchema,
  seriesOutlineEntrySchema,
} from "./outline-entries.ts";
import {
  contentFileReferenceSchema,
  cursorInputFields,
  DOCUMENT_ESTIMATED_TOKEN_BUDGET,
  DOCUMENT_OUTLINE_DEPTH,
  estimatedBudgetSchema,
  nonblankSchema,
  PLACE_ESTIMATED_TOKEN_BUDGET,
  publicPage,
  readActors,
  readErrors,
  ROOT_ESTIMATED_TOKEN_BUDGET,
  sectionStatusSchema,
  selectedDocumentInputSchema,
} from "./read-values.ts";
export * from "./outline-entries.ts";
export * from "./read-values.ts";

const rootInputSchema = z.strictObject({
  estimated_token_budget: estimatedBudgetSchema.default(
    ROOT_ESTIMATED_TOKEN_BUDGET,
  ),
  ...cursorInputFields,
});
export const rootOutlinePageSchema = publicPage(z.object({
  kind: z.literal("root"),
  basis_seq: seqSchema,
  entries: z.array(rootOutlineEntrySchema),
}));
export const outlineRoot = defineRead({
  resource: "outline",
  method: "root",
  name: "outline.root",
  input: rootInputSchema,
  output: rootOutlinePageSchema,
  actors: readActors,
  errors: readErrors,
});
export const placeOutlinePageSchema = publicPage(z.object({
  kind: z.literal("place"),
  basis_seq: seqSchema,
  entries: z.array(placeOutlineEntrySchema),
  coverage: indexCoverageSchema,
}));
export const outlinePlace = defineWorker({
  resource: "outline",
  method: "place",
  name: "outline.place",
  input: z.strictObject({
    place: placeRefSchema,
    estimated_token_budget: estimatedBudgetSchema.default(
      PLACE_ESTIMATED_TOKEN_BUDGET,
    ),
    ...cursorInputFields,
  }),
  output: placeOutlinePageSchema,
  actors: readActors,
  errors: readErrors,
});
export const documentOutlinePageSchema = publicPage(z.object({
  kind: z.literal("document"),
  basis_seq: seqSchema,
  document: documentIdSchema,
  version: versionIdSchema,
  latest_version: versionIdSchema,
  format: formatRefOutputSchema,
  module_hash: sha256Schema,
  section_status: sectionStatusSchema,
  failure_reason: nonblankSchema.nullable(),
  file: contentFileReferenceSchema.nullable(),
  entries: z.array(sectionSchema),
})).refine(validExtractionFallback).refine((value) =>
  value.module_hash === value.format.module_hash &&
  value.entries.every((section) => section.version === value.version) &&
  (value.file === null || value.file.version === value.version)
);
export const outlineDocument = defineWorker({
  resource: "outline",
  method: "document",
  name: "outline.document",
  input: z.strictObject({
    reference: selectedDocumentInputSchema,
    depth: z.number().int().nonnegative().max(6).default(
      DOCUMENT_OUTLINE_DEPTH,
    ),
    estimated_token_budget: estimatedBudgetSchema.default(
      DOCUMENT_ESTIMATED_TOKEN_BUDGET,
    ),
    ...cursorInputFields,
  }),
  output: documentOutlinePageSchema,
  actors: readActors,
  errors: readErrors,
});
const seriesSelectorSchema = z.union([
  z.strictObject({ series: idSchema("ser") }),
  z.strictObject({ place: placeRefSchema, name: slugSchema }),
]);
export const seriesOutlinePageSchema = publicPage(z.object({
  kind: z.literal("series"),
  basis_seq: seqSchema,
  series: idSchema("ser"),
  entries: z.array(seriesOutlineEntrySchema),
}));
export const outlineSeries = defineRead({
  resource: "outline",
  method: "series",
  name: "outline.series",
  input: z.strictObject({
    selector: seriesSelectorSchema,
    estimated_token_budget: estimatedBudgetSchema.default(
      PLACE_ESTIMATED_TOKEN_BUDGET,
    ),
    ...cursorInputFields,
  }),
  output: seriesOutlinePageSchema,
  actors: readActors,
  errors: readErrors,
});
export type OutlinePage =
  | z.infer<typeof rootOutlinePageSchema>
  | z.infer<typeof placeOutlinePageSchema>
  | z.infer<typeof documentOutlinePageSchema>
  | z.infer<typeof seriesOutlinePageSchema>;

// root/series는 ledger metadata만 읽는다. place/document는 metadata와
// 비동기 extraction/cache를 worker에서 조립하여 core read queue를 막지 않는다.
export const OUTLINE_ROUTES = [
  outlineRoot,
  outlinePlace,
  outlineDocument,
  outlineSeries,
] as const;
