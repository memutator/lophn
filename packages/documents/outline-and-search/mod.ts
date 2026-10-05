// documents/outline-and-search: outline·search 읽기, derived store, search consumer.
// 밖으로 내보내는 것만. 다른 모듈은 이것만 import한다.
export { outlineAndSearchSchemaSteps } from "./schema.ts";
export {
  codepoints,
  decodeSearchCursor,
  encodeSearchCursor,
  estimatedTokens,
  escapeLike,
  ftsMatchQuery,
  ftsTerms,
  likePattern,
  lineCount,
  lineOffsets,
  matchCodepointRange,
  matchingLines,
  needsLikeFallback,
  PREAMBLE_EXCERPT_CODEPOINTS,
  preambleExcerpt,
  QUERY_CODEPOINT_MIN,
  searchBasis,
  SNIPPET_ELLIPSIS,
  SNIPPET_TOKENS,
  type SearchPageBasis,
  trimmedQuery,
} from "./model.ts";
export {
  applySchema,
  configureDerived,
  DERIVED_REBUILD_DB,
  DERIVED_SEARCH_DB,
  derivedPath,
  openDerived,
  openDerivedRead,
  rebuildPath,
  type DerivedOpen,
  type DerivedRead,
  type DerivedSql,
  type DerivedStore,
  type DerivedStoreWrite,
  type DerivedTx,
} from "./adapters/store.ts";
export {
  allOmissions,
  applySearchEvent,
  COALESCE_MS,
  coverageOf,
  type ConsumerEvent,
  type ConsumerEventBatch,
  type EventScanLike,
  OMISSION_FAILED,
  OMISSION_UNVERIFIED,
  OMISSION_UNSUPPORTED,
  type SearchConsumerDeps,
  type SearchCoverage,
  startRebuild,
} from "./work.ts";
export { SEARCH_CONSUMER, WATCH_CONSUMER } from "./work-consumers.ts";
export {
  excerptOf,
  createSearchHandlers,
  type IndexDocument,
  type SearchHandlerDeps,
  type SearchHandlers,
  type SearchQueryInput,
  type SearchQueryPage,
  type SearchStatusInput,
  type SearchStatusPage,
} from "./reads.ts";
export { candidateDocuments, allowCandidate } from "./candidates.ts";
export { recordExtraction, rebuildTarget, type ExtractionRecord as ExtractionEntry } from "./extraction.ts";
