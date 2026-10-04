import { z } from "zod";
import {
  defineWorker,
  idSchema,
  seqSchema,
  sha256Schema,
} from "../platform/mod.ts";
import { placeRefSchema } from "./address.ts";
import {
  documentIdSchema,
  sectionKeySchema,
  versionIdSchema,
} from "./values.ts";
import {
  fixedDocumentReferenceSchema,
  formatRefOutputSchema,
} from "./versions.ts";
import { lineRangeOutputSchema } from "./sections.ts";
import {
  countSchema,
  cursorInputFields,
  nonblankSchema,
  publicPage,
  publicRead,
  readActors,
  readErrors,
} from "./read-values.ts";

export const cacheBasisSchema = z.object({
  version: versionIdSchema,
  section: sectionKeySchema.nullable(),
  input_hash: sha256Schema,
  stale: z.boolean(),
});
export const searchResultSchema = z.object({
  document: documentIdSchema,
  version: versionIdSchema,
  latest_version: versionIdSchema,
  format: formatRefOutputSchema,
  module_hash: sha256Schema,
  section: sectionKeySchema.nullable(),
  ranges: z.array(lineRangeOutputSchema),
  reference: fixedDocumentReferenceSchema,
  title: z.string(),
  snippet: z.string(),
  score: z.number().finite(),
  match_source: z.enum(["original", "summary", "topic"]),
  cache_basis: cacheBasisSchema.nullable(),
}).refine((value) => value.module_hash === value.format.module_hash).refine((
  value,
) =>
  value.match_source === "original"
    ? value.ranges.length > 0 && value.cache_basis === null
    : value.ranges.length === 0 && value.cache_basis !== null &&
      value.cache_basis.version === value.version &&
      value.cache_basis.section === value.section &&
      value.cache_basis.stale === (value.version !== value.latest_version)
).refine((value) =>
  value.reference.section === value.section &&
  (typeof value.reference.version !== "string" ||
    (value.reference.document === value.document &&
      value.reference.version === value.version))
);
export type SearchResult = z.infer<typeof searchResultSchema>;
export const indexCoverageSchema = z.object({
  processed_seq: seqSchema,
  ledger_basis_seq: seqSchema,
  lagging: z.boolean(),
  rebuilding: z.boolean(),
  omissions: z.array(
    z.object({
      document: documentIdSchema,
      version: versionIdSchema,
      reason: z.string().min(1),
    }),
  ),
}).refine(
  (value) =>
    BigInt(value.processed_seq) <= BigInt(value.ledger_basis_seq) &&
    (value.processed_seq === value.ledger_basis_seq || value.lagging),
  { message: "processed seq cannot exceed basis; lower seq requires lagging" },
);
export type IndexCoverage = z.infer<typeof indexCoverageSchema>;
// 현재 scope와 선택 판 미반영의 진실은 host 책임이다. 같은 seq에도 lagging=true를 허용한다.
export const searchFilterFields = {
  place: placeRefSchema.optional(),
  context: idSchema("ctx").optional(),
  formats: z.array(nonblankSchema).optional(),
};
export const searchQueryInputSchema = z.strictObject({
  query: nonblankSchema,
  ...searchFilterFields,
  ...cursorInputFields,
  limit: countSchema.min(1).max(100).default(30),
});
export const searchQueryPageSchema = publicPage(z.object({
  results: z.array(searchResultSchema),
  coverage: indexCoverageSchema,
}));
export const searchQuery = defineWorker({
  resource: "search",
  method: "query",
  name: "search.query",
  input: searchQueryInputSchema,
  output: searchQueryPageSchema,
  actors: readActors,
  errors: readErrors,
});
export const indexedDocumentSchema = z.object({
  document: documentIdSchema,
  version: versionIdSchema.nullable(),
  latest_version: versionIdSchema,
  module_hash: sha256Schema.nullable(),
  format: formatRefOutputSchema.nullable(),
}).refine((value) =>
  (value.version === null) === (value.module_hash === null) &&
  (value.format === null) === (value.module_hash === null) &&
  (value.format === null || value.format.module_hash === value.module_hash)
);
export const searchStatusResultSchema = publicRead(z.object({
  documents: z.array(indexedDocumentSchema),
  coverage: indexCoverageSchema,
}));
export const searchStatus = defineWorker({
  resource: "search",
  method: "status",
  name: "search.status",
  input: z.strictObject({
    ...searchFilterFields,
    documents: z.array(documentIdSchema).optional(),
  }),
  output: searchStatusResultSchema,
  actors: readActors,
  errors: readErrors,
});
// derived consumer/FTS5 trigram과 짧은 query의 escaped LIKE는 worker다. index 반영을 기다리지 않는다.
// authority·archive 제외·rank/count/redaction/current scope 확인은 각 page의 host 책임이다.
export const SEARCH_ROUTES = [searchQuery, searchStatus] as const;
