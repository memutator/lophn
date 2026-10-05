// documents/outline-and-search: outline·search 읽기, derived store, search consumer.
// 밖으로 내보내는 것만. 다른 모듈은 이것만 import한다.
export { outlineAndSearchSchemaSteps } from "./schema.ts";
export { savedViewsSchemaSteps } from "./saved-views-schema.ts";
export {
  deleteSavedView,
  insertSavedView,
  listSavedViews,
  loadSavedViewRow,
  type SavedViewRow,
  updateSavedView,
} from "./saved-views-store.ts";
export { createViewCommands } from "./saved-views-commands.ts";
export { createViewReads } from "./saved-views-reads.ts";
export {
  type BodyChunk,
  bodyChunk,
  type BodyPosition,
  type BodyResume,
  codepoints,
  decodeBodyCursor,
  decodeOutlineCursor,
  decodeSearchCursor,
  encodeBodyCursor,
  encodeOutlineCursor,
  encodeSearchCursor,
  escapeLike,
  estimatedTokens,
  ftsMatchQuery,
  ftsTerms,
  likePattern,
  lineCount,
  lineOffsets,
  matchCodepointRange,
  matchingLines,
  needsLikeFallback,
  type OutlineListBasis,
  type OutlineResume,
  PREAMBLE_EXCERPT_CODEPOINTS,
  preambleExcerpt,
  QUERY_CODEPOINT_MIN,
  searchBasis,
  type SearchPageBasis,
  SNIPPET_ELLIPSIS,
  SNIPPET_TOKENS,
  trimmedQuery,
} from "./model.ts";
export { SEARCH_CONSUMER, WATCH_CONSUMER } from "./work-consumers.ts";

export { allowCandidate, candidateDocuments } from "./candidates.ts";

export { createSeriesOutlineRead } from "./series-outline.ts";
