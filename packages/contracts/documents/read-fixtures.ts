import {
  doc,
  file,
  format,
  hash,
  previous,
  version,
} from "./document-fixtures.ts";
export { doc, file, format, hash, previous, version };
export const ctx = "ctx_01arz3ndektsv4rrffq69g5fav";
export const term = "trm_01arz3ndektsv4rrffq69g5fav";
export const meta = { as_of_seq: "9", complete: true, next_cursor: null };
export const range = { start_line: 1, end_line: 3 };
export const section = {
  key: "_preamble",
  title: "",
  parent: null,
  position: 0,
  level: 0,
  anchor: null,
  own_ranges: [],
  subtree_range: range,
  characters: 4,
  body_hash: hash,
  version,
  estimated_tokens: 2,
  children_count: 0,
  hidden_children_count: 0,
};
export const read = {
  ...meta,
  document: doc,
  version,
  latest_version: previous,
  format,
  module_hash: hash,
  section: null,
  section_status: "whole",
  include_children: false,
  ranges: [range],
  text: "본문",
  file: null,
  redacted: false,
  failure_reason: null,
  omission_reason: null,
};
export const coverage = {
  processed_seq: "8",
  ledger_basis_seq: "9",
  lagging: true,
  rebuilding: false,
  omissions: [],
};
export const result = {
  document: doc,
  version,
  latest_version: previous,
  format,
  module_hash: hash,
  section: null,
  ranges: [range],
  reference: { document: doc, version, section: null },
  title: "보고서",
  snippet: "본문",
  score: 1,
  match_source: "original",
  cache_basis: null,
};
export const guideRef = {
  lophn_version: "1.0.0",
  title: "읽기 안내",
  content_hash: hash,
};
