import { z } from "zod";
import {
  archiveStateSchema,
  commandRequestSchema,
  defineCommand,
  defineRead,
  defineWorker,
  idempotencyKeySchema,
  withReadCommon,
} from "../platform/mod.ts";
import {
  addressSchema,
  documentRefSchema,
  placeRefSchema,
  resolvedAddressSchema,
} from "./address.ts";
import {
  documentIdSchema,
  revisionSchema,
  slugSchema,
  versionIdSchema,
} from "./values.ts";
import { documentFilesInputSchema } from "./document-files.ts";
import {
  documentMetadataSchema,
  documentSchema,
  documentSummarySchema,
  fileObservationBasisSchema,
  fileSourceSchema,
  fixedDocumentReferenceSchema,
  formatRefSchema,
  preparedVersionOutputSchema,
  preparedVersionSchema,
  saveResultSchema,
  versionSchema,
  versionSourceSchema,
  versionSummarySchema,
} from "./versions.ts";
import {
  documentArchived,
  documentCreated,
  documentMoved,
  documentRenamed,
  documentRestored,
  documentSaved,
  documentSourceChanged,
  documentUnarchived,
  documentUpdated,
} from "./document-events.ts";

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
  files: documentFilesInputSchema,
  // 신규 생략은 MIME 기본 implicit, 기존 생략은 base_version의 exact contract다.
  // owner worker가 골라 반환하고 준비 결과의 FormatRef는 그대로 필수다.
  format: formatRefSchema.optional(),
  file_basis: fileObservationBasisSchema.optional(),
  source: versionSourceSchema.nullable(),
  idempotency_key: idempotencyKeySchema,
}).refine((value) =>
  value.base_version !== null || value.metadata !== undefined
)
  .refine(
    (value) =>
      (value.file_basis !== undefined) ===
        (value.source?.kind === "file" ||
          value.source?.kind === "instruction_file"),
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

// 준비 참조·CAS·idempotency key가 서로 다른 요청을 handler 전에도 거절한다.
export const documentSaveRequestSchema = commandRequestSchema(documentSave)
  .extend({ compare: documentSaveCompareSchema }).refine(
    (value) =>
      value.input.base_version === value.compare.base_version &&
      value.input.idempotency_key === value.idempotency_key &&
      value.prepared.includes(value.input.preparation_ref),
    { message: "save must bind prepared result, CAS and idempotency key" },
  );

export const documentRestoreInputSchema = z.strictObject({
  document: documentIdSchema,
  restore_version: versionIdSchema,
  prepared: preparedVersionSchema,
  title: z.string().min(1).optional(),
}).refine((value) =>
  value.document === value.prepared.document &&
  value.prepared.base_version !== null
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
).extend({ compare: documentRestoreCompareSchema }).refine(
  (value) =>
    value.input.prepared.base_version === value.compare.base_version &&
    value.input.prepared.idempotency_key === value.idempotency_key &&
    value.prepared.includes(value.input.prepared.preparation_ref),
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
}).refine((value) => value.place === null || value.name !== null);

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

// 값 type은 lophn-agent/questions다. 여기서는 같은 transaction의 user actor 적용만 표시한다.
export const DOCUMENT_DISPATCHABLE_COMMANDS = [
  { route: documentMove, dispatchable: true },
  { route: documentRename, dispatchable: true },
] as const;

// agent metadata read에 현재 디스크 source를 섞지 않는다.
export const agentDocumentSchema = documentSummarySchema.omit({
  file_source: true,
}).refine((value) => value.place === null || value.name !== null);

export const documentListEntrySchema = z.object({
  document: agentDocumentSchema,
  latest_version: versionSummarySchema.omit({ files: true, source: true })
    .refine(
      (value) => !value.saved_by.startsWith("agent:") || value.run !== null,
    ),
}).refine((value) =>
  value.document.id === value.latest_version.document &&
  value.document.latest_version === value.latest_version.id
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
    })).min(1).refine((value) =>
      new Set(value.map((item) => item.document)).size === value.length
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

export {
  documentArchived,
  documentCreated,
  documentMoved,
  documentRenamed,
  documentRestored,
  documentSaved,
  documentSourceChanged,
  documentUnarchived,
  documentUpdated,
};

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
