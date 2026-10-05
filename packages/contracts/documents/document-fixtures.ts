export const hash = "a".repeat(64);
export const otherHash = "b".repeat(64);
export const doc = "doc_01arz3ndektsv4rrffq69g5fav";
export const version = "ver_01arz3ndektsv4rrffq69g5fav";
export const previous = "ver_00000000000000000000000000";
export const project = "prj_01arz3ndektsv4rrffq69g5fav";
export const app = "app_01arz3ndektsv4rrffq69g5fav";
export const release = "rel_01arz3ndektsv4rrffq69g5fav";
export const run = "run_01arz3ndektsv4rrffq69g5fav";
export const assignment = "asg_01arz3ndektsv4rrffq69g5fav";
export const connection = "cac_01arz3ndektsv4rrffq69g5fav";
export const at = "2026-10-04T00:00:00.000Z";
export const key = "prepare-save-1";
export const place = { kind: "project" as const, id: project };
export const format = { name: "document", module_hash: hash, explicit: true };
export const file = {
  path: "report.md",
  blob_hash: hash,
  bytes: 12,
  media_type: "text/markdown",
  primary: true,
};
export const attachment = { ...file, path: "figure.png", primary: false };
export const fileInput = {
  ...file,
  content: {
    kind: "prepared" as const,
    blob: {
      preparation: "blob-prep",
      principal: "user",
      purpose: "document_file",
      hash,
      size_bytes: file.bytes,
    },
  },
};
export const validation = {
  input_hash: hash,
  module_hash: hash,
  status: "passed" as const,
  error_count: 0,
  warning_count: 0,
  diagnostics: [] as [],
};
export const metadata = { title: "보고서", place, name: "report" };
export const basis = {
  kind: "project_file" as const,
  project,
  path: "/work/docs/report.md",
  project_revision: "4",
  document_revision: "7",
  document_status: "active" as const,
  file_source: {
    kind: "project_file" as const,
    project,
    path: "/work/docs/report.md",
  },
  original_hash: otherHash,
  observed_at: at,
};
export const fileSource = {
  kind: "file" as const,
  project,
  path: "/work/docs/report.md",
  original_hash: otherHash,
  observed_at: at,
};
export const prepared = {
  document: doc,
  base_version: version,
  metadata,
  files_hash: hash,
  file_count: 1,
  primary_path: "report.md",
  content_hash: hash,
  format,
  validation,
  preparation_ref: "prep-1",
  files: [{ ...file, preparation_ref: "prep-file-1" }],
  file_basis: basis,
  source: fileSource,
  idempotency_key: key,
};
export const saved = {
  status: "saved" as const,
  document: doc,
  version,
  reference: { document: doc, version, section: null },
  event_seq: "9",
  warnings: [] as [],
};
export const documentRecord = {
  id: doc,
  title: metadata.title,
  place,
  name: metadata.name,
  file_source: basis.file_source,
  latest_version: version,
  revision: "7",
  status: "active" as const,
};
export const versionRecord = {
  id: version,
  document: doc,
  number: 1,
  files: [file],
  content_hash: hash,
  format,
  saved_by: "user" as const,
  saved_at: at,
  run: null,
  source: fileSource,
};
