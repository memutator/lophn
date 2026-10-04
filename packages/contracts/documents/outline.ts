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
  candidateTermOutputSchema,
  contextOutlineEntrySchema,
  definedTermOutputSchema,
  placeOutlineEntrySchema,
  rootOutlineEntrySchema,
  sectionSchema,
  seriesOutlineEntrySchema,
} from "./outline-entries.ts";
import {
  contentFileReferenceSchema,
  CONTEXT_ESTIMATED_TOKEN_BUDGET,
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
export const contextOutlinePageSchema = publicPage(z.object({
  kind: z.literal("context"),
  basis_seq: seqSchema,
  context: idSchema("ctx"),
  title: z.string(),
  purpose: nonblankSchema,
  entries: z.array(contextOutlineEntrySchema),
  coverage: indexCoverageSchema,
  // 빈 관점도 사라지지 않게 세 key를 항상 보낸다.
  perspectives: z.object({
    basis: z.array(contextOutlineEntrySchema),
    reference: z.array(contextOutlineEntrySchema),
    watch: z.array(contextOutlineEntrySchema),
  }),
  glossary: z.array(definedTermOutputSchema),
  candidates: z.array(candidateTermOutputSchema),
})).refine((value) =>
  value.perspectives.basis.every((item) => item.perspective === "basis") &&
  value.perspectives.reference.every((item) =>
    item.perspective === "reference"
  ) &&
  value.perspectives.watch.every((item) => item.perspective === "watch") &&
  JSON.stringify(value.entries) === JSON.stringify([
      ...value.perspectives.basis,
      ...value.perspectives.reference,
      ...value.perspectives.watch,
    ]) &&
  [...value.glossary, ...value.candidates].every((term) =>
    term.context === value.context
  )
);
export const outlineContext = defineWorker({
  resource: "outline",
  method: "context",
  name: "outline.context",
  input: z.strictObject({
    context: idSchema("ctx"),
    estimated_token_budget: estimatedBudgetSchema.default(
      CONTEXT_ESTIMATED_TOKEN_BUDGET,
    ),
    ...cursorInputFields,
  }),
  output: contextOutlinePageSchema,
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
  | z.infer<typeof contextOutlinePageSchema>
  | z.infer<typeof documentOutlinePageSchema>
  | z.infer<typeof seriesOutlinePageSchema>;

// root/series는 ledger metadata만 읽는다. place/context/document는 metadata와
// 비동기 extraction/cache를 worker에서 조립하여 core read queue를 막지 않는다.
export const OUTLINE_ROUTES = [
  outlineRoot,
  outlinePlace,
  outlineContext,
  outlineDocument,
  outlineSeries,
] as const;
