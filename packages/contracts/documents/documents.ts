import { z } from "zod";
import {
  archiveStateSchema,
  commandRequestSchema,
  defineCommand,
  defineEvent,
  defineRead,
  defineWorker,
  idempotencyKeySchema,
  withReadCommon,
} from "../platform/mod.ts";
import {
  addressSchema,
  documentRefSchema,
  placeRefOutputSchema,
  placeRefSchema,
  resolvedAddressSchema,
} from "./address.ts";
import {
  documentIdSchema,
  revisionSchema,
  slugSchema,
  versionIdSchema,
} from "./values.ts";
import {
  contentFilesSchema,
  documentMetadataSchema,
  documentSchema,
  fileObservationBasisSchema,
  fileSourceOutputSchema,
  fileSourceSchema,
  fixedDocumentReferenceSchema,
  formatRefOutputSchema,
  formatRefSchema,
  preparedVersionOutputSchema,
  preparedVersionSchema,
  saveResultSchema,
  versionSchema,
  versionSourceOutputSchema,
  versionSourceSchema,
} from "./versions.ts";

const saveActors = ["user", "coding_agent", "agent", "app", "machine"] as const;
const readActors = ["user", "coding_agent", "agent", "app"] as const;
const saveErrors = [
  "invalid_input",
  "conflict",
  "unauthorized",
  "forbidden",
  "unavailable",
] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;
const mutationErrors = [
  "invalid_input",
  "not_found",
  "conflict",
  "forbidden",
] as const;
export const documentInputSchema = z.strictObject({
  document: documentIdSchema,
});
export const documentCompareSchema = z.strictObject({
  base_revision: revisionSchema,
});
export const documentSaveCompareSchema = z.strictObject({
  base_version: versionIdSchema.nullable(),
});
export const documentRestoreCompareSchema = z.strictObject({
  base_version: versionIdSchema,
  base_revision: revisionSchema,
});
export const documentPrepareInputSchema = z.strictObject({
  document: documentIdSchema,
  base_version: versionIdSchema.nullable(),
  metadata: documentMetadataSchema.optional(),
  files: contentFilesSchema,
  format: formatRefSchema,
  file_basis: fileObservationBasisSchema.optional(),
  source: versionSourceSchema.nullable(),
  idempotency_key: idempotencyKeySchema,
}).refine((v) => v.base_version !== null || v.metadata !== undefined).refine(
  (v) =>
    (v.file_basis !== undefined) ===
      (v.source?.kind === "file" || v.source?.kind === "instruction_file"),
  { message: "file preparation requires observation basis" },
);
export const documentPrepare = defineWorker({
  resource: "documents",
  method: "prepare",
  name: "document.prepare",
  input: documentPrepareInputSchema,
  output: preparedVersionOutputSchema,
  actors: saveActors,
  errors: saveErrors,
});
export const documentSave = defineCommand({
  resource: "documents",
  method: "save",
  name: "document.save",
  input: preparedVersionSchema,
  output: saveResultSchema,
  compare: documentSaveCompareSchema,
  actors: saveActors,
  errors: saveErrors,
});
export const documentSaveRequestSchema = commandRequestSchema(documentSave)
  .extend({ compare: documentSaveCompareSchema }).refine(
    (v) =>
      v.input.base_version === v.compare.base_version &&
      v.input.idempotency_key === v.idempotency_key &&
      v.prepared.includes(v.input.preparation_ref),
    { message: "save must bind prepared result, CAS and idempotency key" },
  );
export const documentRestoreInputSchema = z.strictObject({
  document: documentIdSchema,
  restore_version: versionIdSchema,
  prepared: preparedVersionSchema,
  title: z.string().min(1).optional(),
}).refine((v) =>
  v.document === v.prepared.document &&
  v.prepared.base_version !== null
);
export const documentRestore = defineCommand({
  resource: "documents",
  method: "restore",
  name: "document.restore",
  input: documentRestoreInputSchema,
  output: saveResultSchema,
  compare: documentRestoreCompareSchema,
  actors: ["user", "machine"],
  errors: [...mutationErrors, "unavailable"],
});
export const documentRestoreRequestSchema = commandRequestSchema(
  documentRestore,
)
  .extend({ compare: documentRestoreCompareSchema }).refine(
    (v) =>
      v.input.prepared.base_version === v.compare.base_version &&
      v.input.prepared.idempotency_key === v.idempotency_key &&
      v.prepared.includes(v.input.prepared.preparation_ref),
    { message: "restore must bind preparation, latest CAS and request key" },
  );
export const documentUpdate = defineCommand({
  resource: "documents",
  method: "update",
  name: "document.update",
  input: z.strictObject({
    document: documentIdSchema,
    title: z.string().min(1),
  }),
  output: documentSchema,
  compare: documentCompareSchema,
  actors: ["user", "coding_agent", "agent"],
  errors: mutationErrors,
});
export const documentSetSource = defineCommand({
  resource: "documents",
  method: "set_source",
  name: "document.set_source",
  input: z.strictObject({
    document: documentIdSchema,
    file_source: fileSourceSchema.nullable(),
  }),
  output: documentSchema,
  compare: documentCompareSchema,
  actors: ["user"],
  errors: mutationErrors,
});
export const documentArchive = defineCommand({
  resource: "documents",
  method: "archive",
  name: "document.archive",
  input: documentInputSchema,
  output: documentSchema,
  compare: documentCompareSchema,
  actors: ["user", "machine"],
  errors: ["not_found", "conflict", "forbidden"],
});
export const documentUnarchive = defineCommand({
  resource: "documents",
  method: "unarchive",
  name: "document.unarchive",
  input: documentInputSchema,
  output: documentSchema,
  compare: documentCompareSchema,
  actors: ["user"],
  errors: ["not_found", "conflict", "forbidden"],
});
export const documentMoveInputSchema = z.strictObject({
  document: documentIdSchema,
  place: placeRefSchema.nullable(),
  name: slugSchema.nullable(),
}).refine((v) => v.place === null || v.name !== null);
export const documentMove = defineCommand({
  resource: "documents",
  method: "move",
  name: "document.move",
  input: documentMoveInputSchema,
  output: documentSchema,
  compare: documentCompareSchema,
  actors: ["user"],
  errors: mutationErrors,
});
export const documentRename = defineCommand({
  resource: "documents",
  method: "rename",
  name: "document.rename",
  input: z.strictObject({ document: documentIdSchema, name: slugSchema }),
  output: documentSchema,
  compare: documentCompareSchema,
  actors: ["user"],
  errors: mutationErrors,
});
// owner は検証済み option action を同じ transaction の user actor で適用する。
export const DOCUMENT_DISPATCHABLE_COMMANDS = [
  documentMove,
  documentRename,
] as const;

// agent の metadata read に現在のディスク source は混ぜない。
export const agentDocumentSchema = documentSchema.omit({ file_source: true });
export const documentListEntrySchema = z.object({
  document: agentDocumentSchema,
  latest_version: versionSchema.omit({ files: true, source: true }),
}).refine((v) =>
  v.document.id === v.latest_version.document &&
  v.document.latest_version === v.latest_version.id
);
export const documentList = defineRead({
  resource: "documents",
  method: "list",
  name: "document.list",
  input: z.strictObject({
    place: placeRefSchema.nullable().optional(),
    status: archiveStateSchema.optional(),
    limit: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER).optional(),
    cursor: z.string().min(1).optional(),
  }),
  output: withReadCommon(
    z.object({ documents: z.array(documentListEntrySchema) }),
  ),
  actors: readActors,
  errors: readErrors,
});
export const documentGet = defineRead({
  resource: "documents",
  method: "get",
  name: "document.get",
  input: z.strictObject({
    document: documentIdSchema,
    version: versionIdSchema.optional(),
  }),
  output: withReadCommon(z.object({
    document: z.union([documentSchema, agentDocumentSchema]),
    version: versionSchema,
    reference: fixedDocumentReferenceSchema,
  })),
  actors: readActors,
  errors: readErrors,
});
export const documentResolve = defineRead({
  resource: "documents",
  method: "resolve",
  name: "document.resolve",
  input: z.strictObject({
    reference: z.union([addressSchema, documentRefSchema]),
  }),
  output: withReadCommon(z.object({ resolved: resolvedAddressSchema })),
  actors: readActors,
  errors: readErrors,
});
export const documentExport = defineWorker({
  resource: "documents",
  method: "export",
  name: "document.export",
  input: z.strictObject({
    place: placeRefSchema,
    documents: z.array(z.strictObject({
      document: documentIdSchema,
      version: versionIdSchema,
    })).min(1).refine((v) =>
      new Set(v.map((d) => d.document)).size === v.length
    ),
    format: z.enum(["markdown", "json"]),
  }),
  output: z.object({
    format: z.enum(["markdown", "json"]),
    documents: z.array(z.object({
      document: agentDocumentSchema,
      version: versionSchema,
      reference: fixedDocumentReferenceSchema,
    })),
  }),
  actors: ["user"],
  errors: [...readErrors, "conflict"],
});

export const documentCreated = defineEvent("DocumentCreated", {
  subject: documentIdSchema,
  payload: z.object({
    place: placeRefOutputSchema.nullable(),
    name: slugSchema.nullable(),
    title: z.string().min(1),
    file_source: fileSourceOutputSchema.nullable(),
    version: versionIdSchema,
  }).refine((v) => v.place === null || v.name !== null),
});
export const documentSaved = defineEvent("DocumentSaved", {
  subject: documentIdSchema,
  payload: z.object({
    version: versionIdSchema,
    previous_version: versionIdSchema.nullable(),
    content_hash: preparedVersionOutputSchema.shape.content_hash,
    format: formatRefOutputSchema,
    source: versionSourceOutputSchema.nullable(),
  }),
});
export const documentUpdated = defineEvent("DocumentUpdated", {
  subject: documentIdSchema,
  payload: z.object({
    before_title: z.string().min(1),
    title: z.string().min(1),
    before_revision: revisionSchema,
  }),
});
export const documentSourceChanged = defineEvent("DocumentSourceChanged", {
  subject: documentIdSchema,
  payload: z.object({
    before_source: fileSourceOutputSchema.nullable(),
    source: fileSourceOutputSchema.nullable(),
    before_revision: revisionSchema,
  }),
});
export const documentArchived = defineEvent("DocumentArchived", {
  subject: documentIdSchema,
  payload: z.object({ before_revision: revisionSchema }),
});
export const documentUnarchived = defineEvent("DocumentUnarchived", {
  subject: documentIdSchema,
  payload: z.object({ before_revision: revisionSchema }),
});
export const documentRestored = defineEvent("DocumentRestored", {
  subject: documentIdSchema,
  payload: z.object({
    restore_version: versionIdSchema,
    previous_version: versionIdSchema,
    version: versionIdSchema,
  }),
});
export const documentMoved = defineEvent("DocumentMoved", {
  subject: documentIdSchema,
  payload: z.object({
    before_place: placeRefOutputSchema.nullable(),
    before_name: slugSchema.nullable(),
    place: placeRefOutputSchema.nullable(),
    name: slugSchema.nullable(),
    before_revision: revisionSchema,
  }).refine((v) =>
    (v.before_place === null || v.before_name !== null) &&
    (v.place === null || v.name !== null)
  ),
});
export const documentRenamed = defineEvent("DocumentRenamed", {
  subject: documentIdSchema,
  payload: z.object({
    place: placeRefOutputSchema.nullable(),
    before_name: slugSchema.nullable(),
    name: slugSchema,
    before_revision: revisionSchema,
  }),
});
export const DOCUMENT_ROUTES = [
  documentPrepare,
  documentSave,
  documentRestore,
  documentUpdate,
  documentSetSource,
  documentArchive,
  documentUnarchive,
  documentMove,
  documentRename,
  documentList,
  documentGet,
  documentResolve,
  documentExport,
] as const;
export const DOCUMENT_EVENTS = [
  documentCreated,
  documentSaved,
  documentUpdated,
  documentSourceChanged,
  documentArchived,
  documentUnarchived,
  documentRestored,
  documentMoved,
  documentRenamed,
] as const;
