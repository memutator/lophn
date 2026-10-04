import { assert } from "@std/assert";
import {
  type DocumentFileInput,
  documentFileInputSchema,
  documentFilesInputSchema,
  documentPrepareInputSchema,
} from "./mod.ts";
import {
  basis,
  doc,
  file,
  fileInput,
  fileSource,
  format,
  hash,
  key,
  metadata,
  version,
} from "./document-fixtures.ts";

const prepare = {
  document: doc,
  base_version: null as null,
  metadata,
  files: [fileInput],
  format,
  source: null,
  idempotency_key: key,
};

const existing = {
  kind: "existing" as const,
  reference: {
    owner_kind: "document",
    owner_key: doc,
    field: "files",
    hash,
    registered_seq: "4",
  },
};

Deno.test("documents/versions#R6: prepare accepts an authenticated blob and an omitted format", () => {
  const input: DocumentFileInput = documentFileInputSchema.parse(fileInput);
  assert(documentFilesInputSchema.safeParse([input]).success);
  assert(documentPrepareInputSchema.safeParse(prepare).success);
  assert(
    documentPrepareInputSchema.safeParse({ ...prepare, format: undefined })
      .success,
  );
  assert(
    documentPrepareInputSchema.safeParse({
      document: doc,
      base_version: version,
      files: [{ ...file, content: existing }],
      source: null,
      idempotency_key: key,
    }).success,
  );
  assert(
    !documentPrepareInputSchema.safeParse({
      document: doc,
      base_version: version,
      files: [fileInput],
      format,
      source: fileSource,
      idempotency_key: key,
    }).success,
  );
  assert(
    documentPrepareInputSchema.safeParse({
      document: doc,
      base_version: version,
      files: [fileInput],
      format,
      file_basis: basis,
      source: fileSource,
      idempotency_key: key,
    }).success,
  );
});

Deno.test("documents/versions#R8: prepare rejects a hash without a matching authenticated blob", () => {
  assert(
    !documentPrepareInputSchema.safeParse({ ...prepare, files: [file] })
      .success,
  );
  assert(
    !documentPrepareInputSchema.safeParse({
      ...prepare,
      files: [{
        ...fileInput,
        blob_hash: "b".repeat(64),
      }],
    }).success,
  );
  assert(
    !documentPrepareInputSchema.safeParse({
      ...prepare,
      files: [{ ...fileInput, bytes: file.bytes + 1 }],
    }).success,
  );
  assert(
    !documentPrepareInputSchema.safeParse({
      ...prepare,
      files: [{
        ...fileInput,
        content: {
          ...fileInput.content,
          blob: { ...fileInput.content.blob, purpose: "snapshot_attachment" },
        },
      }],
    }).success,
  );
  assert(
    !documentPrepareInputSchema.safeParse({
      ...prepare,
      files: [{
        ...fileInput,
        content: { ...fileInput.content, extra: true },
      }],
    }).success,
  );
  assert(
    !documentPrepareInputSchema.safeParse({
      ...prepare,
      files: [{
        ...file,
        content: {
          ...existing,
          reference: { ...existing.reference, hash: "c".repeat(64) },
        },
      }],
    }).success,
  );
});
