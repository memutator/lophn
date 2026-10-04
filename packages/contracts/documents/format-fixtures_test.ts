import { fileInput } from "./document-fixtures.ts";
import { DOCUMENT_MEDIA_TYPES } from "./formats.ts";

export const hash = "a".repeat(64);
export const other = "b".repeat(64);
export const section = {
  key: "_preamble",
  title: "",
  parent: null,
  position: 0,
  level: 0,
  anchor: null,
  own_ranges: [{ start_line: 1, end_line: 1 }],
  subtree_range: { start_line: 1, end_line: 1 },
  characters: 4,
  body_hash: hash,
};
export const declaration = {
  name: "document" as const,
  module_hash: hash,
  media_types: [...DOCUMENT_MEDIA_TYPES],
  structure: {},
  metadata: { title: { type: "string" } },
  template: [{
    path: "document.md",
    blob_hash: hash,
    bytes: 0,
    media_type: "text/markdown",
    primary: true,
  }],
  guide: { text: "Write Markdown.", examples: ["# Title"] },
  vocabulary: [{ name: "heading", description: "ATX or setext" }],
  extracts: true,
};
export const input = {
  name: "document" as const,
  module_hash: hash,
  files: [fileInput],
  input_hash: other,
  explicit: true,
};
