import { assert, assertEquals } from "@std/assert";
import {
  contentFileSchema,
  contentFilesSchema,
  documentMetadataSchema,
  documentSchema,
  fileObservationBasisSchema,
  fileSourceSchema,
  formatDiagnosticSchema,
  formatRefSchema,
  formatValidationResultSchema,
  preparedVersionOutputSchema,
  preparedVersionSchema,
  saveResultSchema,
  versionSchema,
  versionSourceSchema,
} from "./versions.ts";
import {
  app,
  assignment,
  attachment,
  basis,
  connection,
  documentRecord,
  file,
  fileSource,
  format,
  hash,
  metadata,
  otherHash,
  prepared,
  release,
  run,
  saved,
  validation,
  versionRecord,
} from "./document-fixtures.ts";

Deno.test("documents/versions#R1: multi-file content keeps one primary and a fixed version", () => {
  assertEquals(contentFilesSchema.parse([attachment, file]), [
    attachment,
    file,
  ]);
  assert(!contentFilesSchema.safeParse([file, { ...file }]).success);
  assert(!contentFilesSchema.safeParse([attachment]).success);
  assert(
    !contentFileSchema.safeParse({ ...file, path: "../secret.md" }).success,
  );
  assert(!contentFileSchema.safeParse({ ...file, extra: true }).success);
  assert(
    !contentFileSchema.safeParse({ ...file, media_type: "markdown" }).success,
  );
  assert(formatRefSchema.safeParse(format).success);
  assert(documentSchema.safeParse(documentRecord).success);
  assert(versionSchema.safeParse(versionRecord).success);
  assert(
    !documentSchema.safeParse({ ...documentRecord, id: versionRecord.id })
      .success,
  );
});

Deno.test("documents/versions#R3: same content and format contract is unchanged without an event seq", () => {
  const unchanged = { ...saved, status: "unchanged" as const, event_seq: null };
  assertEquals(saveResultSchema.parse(unchanged), unchanged);
  assert(saveResultSchema.safeParse(saved).success);
  assert(!saveResultSchema.safeParse({ ...saved, event_seq: null }).success);
  assert(!saveResultSchema.safeParse({ ...unchanged, event_seq: "9" }).success);
  assert(!saveResultSchema.safeParse({ ...saved, status: "created" }).success);
});

Deno.test("documents/versions#R6: prepared version binds content, format and the saving actor", () => {
  assert(preparedVersionSchema.safeParse(prepared).success);
  assert(
    preparedVersionOutputSchema.safeParse({ ...prepared, extra_future: true })
      .success,
  );
  assert(
    versionSchema.safeParse({
      ...versionRecord,
      saved_by: `agent:${assignment}`,
      run,
    }).success,
  );
  assert(
    !versionSchema.safeParse({
      ...versionRecord,
      saved_by: `agent:${assignment}`,
      run: null,
    }).success,
  );
  assert(
    versionSchema.safeParse({
      ...versionRecord,
      saved_by: `coding_agent:${connection}`,
      run: null,
      source: null,
    }).success,
  );
  assert(
    versionSchema.safeParse({
      ...versionRecord,
      saved_by: `app:${app}`,
      source: { kind: "app", app, release },
    }).success,
  );
  assert(
    !versionSchema.safeParse({
      ...versionRecord,
      saved_by: `app:${app}`,
      source: fileSource,
    }).success,
  );
});

Deno.test("documents/versions#R6: unknown fields, bad values and id prefixes are rejected", () => {
  assert(!formatRefSchema.safeParse({ ...format, extra: true }).success);
  assert(
    !formatRefSchema.safeParse({ ...format, module_hash: "A".repeat(64) })
      .success,
  );
  assert(
    !documentMetadataSchema.safeParse({ ...metadata, name: null }).success,
  );
  assert(
    documentMetadataSchema.safeParse({ ...metadata, place: null, name: null })
      .success,
  );
  assert(
    !fileSourceSchema.safeParse({ ...basis.file_source, kind: "disk" }).success,
  );
  assert(
    !fileObservationBasisSchema.safeParse({
      ...basis,
      document_status: "archived",
    }).success,
  );
  const { document_revision: _revision, document_status: _status, ...newFile } =
    basis;
  assert(
    fileObservationBasisSchema.safeParse({ ...newFile, file_source: null })
      .success,
  );
  assert(
    !fileObservationBasisSchema.safeParse({
      ...newFile,
      file_source: { ...basis.file_source, path: "/other/report.md" },
    }).success,
  );
  assert(
    !preparedVersionSchema.safeParse({
      ...prepared,
      base_version: null,
      metadata: undefined,
    }).success,
  );
  assert(
    !preparedVersionSchema.safeParse({
      ...prepared,
      source: null,
      file_basis: undefined,
      validation: { ...validation, input_hash: otherHash },
    }).success,
  );
  assert(
    !preparedVersionSchema.safeParse({
      ...prepared,
      source: null,
      file_basis: undefined,
      format: { ...format, explicit: true },
      validation: { ...validation, status: "failed", error_count: 1 },
    }).success,
  );
  assert(!versionSourceSchema.safeParse({ kind: "app", app }).success);
  assert(
    !formatDiagnosticSchema.safeParse({
      severity: "warning",
      code: "soft",
      message: "note",
      file: null,
      start_line: 1,
      end_line: 1,
      column: null,
    }).success,
  );
  assert(
    !formatValidationResultSchema.safeParse({
      ...validation,
      status: "passed",
      error_count: 1,
    }).success,
  );
  assert(!documentSchema.safeParse({ ...documentRecord, id: hash }).success);
});
