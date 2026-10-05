import { z } from "zod";
import {
  actorSchema,
  archiveStateSchema,
  atSchema,
  idempotencyKeySchema,
  idSchema,
  runIdSchema,
  seqSchema,
  sha256Schema,
} from "../platform/mod.ts";
import {
  addressOutputSchema,
  documentRefOutputSchema,
  placeRefOutputSchema,
  placeRefSchema,
} from "./address.ts";
import {
  absolutePathSchema,
  appIdSchema,
  documentIdSchema,
  projectIdSchema,
  relativePathSchema,
  revisionSchema,
  slugSchema,
  versionIdSchema,
  versionNumberSchema,
} from "./values.ts";

const sizeSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const blobFields = { hash: sha256Schema, size_bytes: sizeSchema };
const blobInputSchema = z.strictObject(blobFields);
const blobOutputSchema = z.object(blobFields);
const formatFields = {
  name: z.string().min(1),
  module_hash: sha256Schema,
  explicit: z.boolean(),
};
export const formatRefSchema = z.strictObject(formatFields);
export const formatRefOutputSchema = z.object(formatFields);
export type FormatRef = z.infer<typeof formatRefSchema>;

const diagnosticFields = {
  severity: z.enum(["error", "warning"]),
  code: z.string().min(1),
  message: z.string().min(1),
  file: relativePathSchema.nullable(),
  start_line: versionNumberSchema.nullable(),
  end_line: versionNumberSchema.nullable(),
  column: versionNumberSchema.nullable(),
};
export const formatDiagnosticSchema = z.strictObject(diagnosticFields).refine(
  (v) =>
    (v.start_line === null) === (v.end_line === null) &&
    (v.start_line === null || v.file !== null) &&
    (v.column === null || v.start_line !== null) &&
    (v.start_line === null || v.end_line! >= v.start_line),
  { message: "invalid diagnostic location" },
);
export const formatDiagnosticOutputSchema = z.object(diagnosticFields).refine(
  (v) =>
    (v.start_line === null) === (v.end_line === null) &&
    (v.start_line === null || v.file !== null) &&
    (v.column === null || v.start_line !== null) &&
    (v.start_line === null || v.end_line! >= v.start_line),
);
export type FormatDiagnostic = z.infer<typeof formatDiagnosticSchema>;
const validationFields = {
  input_hash: sha256Schema,
  module_hash: sha256Schema,
  status: z.enum(["passed", "failed"]),
  error_count: sizeSchema,
  warning_count: sizeSchema,
};
export const formatValidationResultSchema = z.strictObject({
  ...validationFields,
  diagnostics: z.union([z.array(formatDiagnosticSchema), blobInputSchema]),
}).refine((v) => (v.status === "passed") === (v.error_count === 0)).refine(
  (v) =>
    !Array.isArray(v.diagnostics) ||
    (v.error_count ===
        v.diagnostics.filter((d) => d.severity === "error").length &&
      v.warning_count ===
        v.diagnostics.filter((d) => d.severity === "warning").length),
  { message: "diagnostic counts must match" },
);
export const formatValidationResultOutputSchema = z.object({
  ...validationFields,
  diagnostics: z.union([
    z.array(formatDiagnosticOutputSchema),
    blobOutputSchema,
  ]),
}).refine((v) => (v.status === "passed") === (v.error_count === 0)).refine(
  (v) =>
    !Array.isArray(v.diagnostics) ||
    (v.error_count ===
        v.diagnostics.filter((d) => d.severity === "error").length &&
      v.warning_count ===
        v.diagnostics.filter((d) => d.severity === "warning").length),
);
export type FormatValidationResult = z.infer<
  typeof formatValidationResultSchema
>;

const contentFileFields = {
  path: relativePathSchema,
  blob_hash: sha256Schema,
  bytes: sizeSchema,
  media_type: z.string().regex(/^[\w!#$&^.+-]+\/[\w!#$&^.+-]+$/),
  primary: z.boolean(),
};
export const contentFileSchema = z.strictObject(contentFileFields);
export const contentFileOutputSchema = z.object(contentFileFields);
export type ContentFile = z.infer<typeof contentFileSchema>;
export const contentFilesSchema = z.array(contentFileSchema).min(1).refine(
  (files) =>
    files.filter((f) => f.primary).length === 1 &&
    new Set(files.map((f) => f.path)).size === files.length,
  { message: "files need unique paths and exactly one primary" },
);
export const contentFilesOutputSchema = z.array(contentFileOutputSchema).min(1)
  .refine((files) =>
    files.filter((f) => f.primary).length === 1 &&
    new Set(files.map((f) => f.path)).size === files.length
  );

// exact 등록 참조의 해석과 권한은 instructions owner가 검증한다.
export const instructionTargetSchema = z.string().min(1);
const projectFileFields = {
  kind: z.literal("project_file"),
  project: projectIdSchema,
  path: absolutePathSchema,
};
const instructionFileFields = {
  kind: z.literal("instruction_file"),
  instruction_target: instructionTargetSchema,
  project: projectIdSchema.nullable(),
  path: absolutePathSchema,
};
export const fileSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject(projectFileFields),
  z.strictObject(instructionFileFields),
]);
export const fileSourceOutputSchema = z.discriminatedUnion("kind", [
  z.object(projectFileFields),
  z.object(instructionFileFields),
]);
export type FileSource = z.infer<typeof fileSourceSchema>;
const observedFields = {
  original_hash: sha256Schema,
  observed_at: atSchema,
};
const versionFileFields = {
  ...projectFileFields,
  kind: z.literal("file"),
  ...observedFields,
};
const versionInstructionFields = {
  ...instructionFileFields,
  ...observedFields,
};
const versionAppFields = {
  kind: z.literal("app"),
  app: appIdSchema,
  release: idSchema("rel"),
};
export const versionSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject(versionFileFields),
  z.strictObject(versionInstructionFields),
  z.strictObject(versionAppFields),
]);
export const versionSourceOutputSchema = z.discriminatedUnion("kind", [
  z.object(versionFileFields),
  z.object(versionInstructionFields),
  z.object(versionAppFields),
]);
export type VersionSource = z.infer<typeof versionSourceSchema>;

const basisFields = {
  document_revision: revisionSchema.optional(),
  document_status: z.literal("active").optional(),
  ...observedFields,
};
export const fileObservationBasisSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    ...projectFileFields,
    ...basisFields,
    project_revision: revisionSchema,
    file_source: fileSourceSchema.nullable(),
  }),
  z.strictObject({
    ...instructionFileFields,
    ...basisFields,
    instruction_revision: revisionSchema,
    project_revision: revisionSchema.nullable(),
    file_source: fileSourceSchema.nullable(),
  }).refine((v) => (v.project === null) === (v.project_revision === null)),
]).refine((v) =>
  v.file_source === null ||
  (v.document_revision !== undefined && v.document_status === "active" &&
    v.kind === v.file_source.kind && v.project === v.file_source.project &&
    v.path === v.file_source.path &&
    (v.kind !== "instruction_file" ||
      (v.file_source.kind === "instruction_file" &&
        v.instruction_target === v.file_source.instruction_target))), {
  message: "existing source needs matching active document basis",
});
export const fileObservationBasisOutputSchema = z.discriminatedUnion("kind", [
  z.object({
    ...projectFileFields,
    ...basisFields,
    project_revision: revisionSchema,
    file_source: fileSourceOutputSchema.nullable(),
  }),
  z.object({
    ...instructionFileFields,
    ...basisFields,
    instruction_revision: revisionSchema,
    project_revision: revisionSchema.nullable(),
    file_source: fileSourceOutputSchema.nullable(),
  }).refine((v) => (v.project === null) === (v.project_revision === null)),
]);
export type FileObservationBasis = z.infer<typeof fileObservationBasisSchema>;

const metadataFields = {
  title: z.string().min(1),
  place: placeRefSchema.nullable(),
  name: slugSchema.nullable(),
};
export const documentMetadataSchema = z.strictObject(metadataFields).refine(
  (v) => v.place === null || v.name !== null,
);
export const documentMetadataOutputSchema = z.object({
  ...metadataFields,
  place: placeRefOutputSchema.nullable(),
}).refine((v) => v.place === null || v.name !== null);
const documentFields = {
  id: documentIdSchema,
  ...documentMetadataOutputSchema.shape,
  file_source: fileSourceOutputSchema.nullable(),
  latest_version: versionIdSchema,
  revision: revisionSchema,
  status: archiveStateSchema,
};
export const documentSummarySchema = z.object(documentFields);
export const documentSchema = documentSummarySchema.refine((value) =>
  value.place === null || value.name !== null
);
export type Document = z.infer<typeof documentSchema>;
const versionFields = {
  id: versionIdSchema,
  document: documentIdSchema,
  number: versionNumberSchema,
  files: z.union([contentFilesOutputSchema, blobOutputSchema]),
  content_hash: sha256Schema,
  format: formatRefOutputSchema,
  saved_by: actorSchema,
  saved_at: atSchema,
  run: runIdSchema.nullable(),
  source: versionSourceOutputSchema.nullable(),
};
export const versionSummarySchema = z.object(versionFields);
export const versionSchema = versionSummarySchema.refine((value) =>
  !value.saved_by.startsWith("agent:") || value.run !== null
).refine(
  (v) =>
    !v.saved_by.startsWith("app:") ||
    (v.source?.kind === "app" && v.saved_by === `app:${v.source.app}`),
);
export type Version = z.infer<typeof versionSchema>;

// 판에 묶을 파일 하나: ContentFile과 그 원문 blob(`document_file` 준비)의 준비 참조.
// save가 같은 tx에서 version_files 행과 경로별 원문 blob 참조(versionFileField)를 남긴다.
const preparedFileFields = {
  ...contentFileFields,
  preparation_ref: z.string().min(1),
};
export const preparedFileSchema = z.strictObject(preparedFileFields);
export const preparedFileOutputSchema = z.object(preparedFileFields);
export type PreparedFile = z.infer<typeof preparedFileSchema>;

const preparedFileList = (
  value: { files: { path: string; primary: boolean }[]; file_count: number },
) =>
  value.files.length === value.file_count &&
  value.files.filter((f) => f.primary).length === 1 &&
  new Set(value.files.map((f) => f.path)).size === value.files.length;

const preparedFields = {
  document: documentIdSchema,
  base_version: versionIdSchema.nullable(),
  files_hash: sha256Schema,
  file_count: versionNumberSchema,
  primary_path: relativePathSchema,
  content_hash: sha256Schema,
  preparation_ref: z.string().min(1),
  idempotency_key: idempotencyKeySchema,
};
export const preparedVersionSchema = z.strictObject({
  ...preparedFields,
  files: z.array(preparedFileSchema).min(1),
  metadata: documentMetadataSchema.optional(),
  format: formatRefSchema,
  validation: formatValidationResultSchema,
  file_basis: fileObservationBasisSchema.optional(),
  source: versionSourceSchema.nullable(),
}).refine((v) => v.base_version !== null || v.metadata !== undefined).refine(
  (v) =>
    preparedFileList(v) &&
    v.files.find((f) => f.primary)!.path === v.primary_path,
  { message: "files must match file_count and primary_path" },
).refine(
  (v) =>
    v.validation.input_hash === v.content_hash &&
    v.validation.module_hash === v.format.module_hash &&
    (!v.format.explicit || v.validation.status === "passed"),
  { message: "validation must match exact content and format" },
).refine((v) =>
  v.source === null || v.source.kind === "app" ||
  (v.file_basis !== undefined && v.source.path === v.file_basis.path &&
    v.source.project === v.file_basis.project &&
    v.source.original_hash === v.file_basis.original_hash &&
    v.source.observed_at === v.file_basis.observed_at &&
    (v.source.kind === "file"
      ? v.file_basis.kind === "project_file"
      : v.file_basis.kind === "instruction_file" &&
        v.source.instruction_target === v.file_basis.instruction_target)), {
  message: "file source requires its exact observation basis",
}).refine(
  (v) =>
    v.file_basis === undefined || v.source?.kind === "file" ||
    v.source?.kind === "instruction_file",
);
export const preparedVersionOutputSchema = z.object({
  ...preparedFields,
  files: z.array(preparedFileOutputSchema).min(1),
  metadata: documentMetadataOutputSchema.optional(),
  format: formatRefOutputSchema,
  validation: formatValidationResultOutputSchema,
  file_basis: fileObservationBasisOutputSchema.optional(),
  source: versionSourceOutputSchema.nullable(),
});
export type PreparedVersion = z.infer<typeof preparedVersionSchema>;

export const fixedDocumentReferenceSchema = z.union([
  addressOutputSchema.extend({ version: versionNumberSchema }),
  documentRefOutputSchema.extend({ version: versionIdSchema }),
]);
const saveFields = {
  document: documentIdSchema,
  version: versionIdSchema,
  reference: fixedDocumentReferenceSchema,
  warnings: z.array(formatDiagnosticOutputSchema),
};
export const saveResultSchema = z.discriminatedUnion("status", [
  z.object({ ...saveFields, status: z.literal("saved"), event_seq: seqSchema }),
  z.object({
    ...saveFields,
    status: z.literal("unchanged"),
    event_seq: z.null(),
  }),
]).refine((v) =>
  !("document" in v.reference && typeof v.reference.version === "string") ||
  (v.reference.document === v.document && v.reference.version === v.version)
);
export type SaveResult = z.infer<typeof saveResultSchema>;
