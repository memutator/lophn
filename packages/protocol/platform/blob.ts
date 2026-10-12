import { z } from "zod";
import { idSchema } from "./ids.ts";
import { defineRead } from "./route.ts";
import { seqSchema, sha256Schema } from "./values.ts";

export const BLOB_PREPARE_MAX_BYTES = 1024 * 1024 * 1024;
export const BLOB_READ_MAX_BYTES = 256 * 1024;
export const BLOB_PREPARATION_TTL_MS = 10 * 60 * 1000;
export const BLOB_UNREFERENCED_GRACE_MS = 7 * 24 * 60 * 60 * 1000;

const nonempty = z.string().min(1);
const size = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const purposeName = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const blobRefSchema = z.object({
  hash: sha256Schema,
  size_bytes: size,
});
export type BlobRef = z.infer<typeof blobRefSchema>;

export const preparedBlobSchema = z.object({
  preparation: nonempty,
  principal: nonempty,
  purpose: purposeName,
  hash: sha256Schema,
  size_bytes: size.max(BLOB_PREPARE_MAX_BYTES),
});
export type PreparedBlob = z.infer<typeof preparedBlobSchema>;

export const permanentBlobReferenceSchema = z.object({
  owner_kind: nonempty,
  owner_key: nonempty,
  field: nonempty,
  hash: sha256Schema,
  registered_seq: seqSchema,
});
export type PermanentBlobReference = z.infer<
  typeof permanentBlobReferenceSchema
>;

export const blobPurposeDefinitionSchema = z.strictObject({
  purpose: purposeName,
  max_size_bytes: size.max(BLOB_PREPARE_MAX_BYTES),
});
export type BlobPurposeDefinition<P extends string = string> =
  & z.infer<typeof blobPurposeDefinitionSchema>
  & { purpose: P };

export function defineBlobPurpose<const P extends string>(
  definition: BlobPurposeDefinition<P>,
): BlobPurposeDefinition<P> {
  blobPurposeDefinitionSchema.parse(definition);
  return definition;
}

export const BLOB_RETENTION_CATEGORIES = [
  "model_call_body",
  "snapshot_attachment",
  "trace_body",
  "operational_log",
] as const;
export const blobRetentionCategorySchema = z.enum(BLOB_RETENTION_CATEGORIES);
export type BlobRetentionCategory = z.infer<typeof blobRetentionCategorySchema>;

// 종류별 용량 상한은 측정해 고정하므로 field마다 다른 상한을 받지 않는다.
export const blobRetentionSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("permanent") }),
  z.strictObject({
    kind: z.literal("capacity"),
    category: blobRetentionCategorySchema,
  }),
]);
export type BlobRetention = z.infer<typeof blobRetentionSchema>;

export const blobFieldDefinitionSchema = z.strictObject({
  owner_kind: nonempty,
  field: nonempty,
  retention: blobRetentionSchema,
  general_read: z.boolean(),
});
export type BlobFieldDefinition<
  O extends string = string,
  F extends string = string,
> = z.infer<typeof blobFieldDefinitionSchema> & { owner_kind: O; field: F };

export function defineBlobField<const O extends string, const F extends string>(
  definition: BlobFieldDefinition<O, F>,
): BlobFieldDefinition<O, F> {
  blobFieldDefinitionSchema.parse(definition);
  return definition;
}

// 새 hash 주장만으로 참조를 만들 수 없고 준비 결과 또는 허용 기존 참조가 필요하다.
export const blobRefRegistrationSchema = z.strictObject({
  owner_kind: nonempty,
  owner_key: nonempty,
  field: nonempty,
  registered_seq: seqSchema,
  source: z.discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("prepared"),
      blob: z.strictObject(preparedBlobSchema.shape),
    }),
    z.strictObject({
      kind: z.literal("existing"),
      reference: z.strictObject(permanentBlobReferenceSchema.shape),
    }),
  ]),
});
export type BlobRefRegistration = z.infer<typeof blobRefRegistrationSchema>;

// owner_key의 entity/event/공통 key와 field 등록 여부는 소유 concern이 해석한다.
export const blobReadInputSchema = z.strictObject({
  owner_kind: nonempty,
  owner_key: nonempty,
  version: idSchema("ver").optional(),
  field: nonempty,
  offset_bytes: size,
  length_bytes: size,
});
export type BlobReadInput = z.infer<typeof blobReadInputSchema>;

const base64 = z.string().regex(
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
).max(4 * Math.ceil(BLOB_READ_MAX_BYTES / 3));

export const BLOB_UNAVAILABLE_REASONS = [
  "pruned",
  "missing",
  "corrupt",
] as const;
export const blobUnavailableReasonSchema = z.enum(BLOB_UNAVAILABLE_REASONS);
export type BlobUnavailableReason = z.infer<typeof blobUnavailableReasonSchema>;

export const blobReadResultSchema = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("available"),
    hash: sha256Schema,
    size_bytes: size,
    offset_bytes: size,
    length_bytes: size.max(BLOB_READ_MAX_BYTES),
    truncated: z.boolean(),
    bytes: base64,
  }).refine(
    (value) =>
      value.offset_bytes <= value.size_bytes &&
      value.length_bytes <= value.size_bytes - value.offset_bytes,
    { message: "invalid returned byte range" },
  ).refine(
    (value) => {
      const padding = value.bytes.endsWith("==")
        ? 2
        : value.bytes.endsWith("=")
        ? 1
        : 0;
      return value.bytes.length / 4 * 3 - padding === value.length_bytes;
    },
    { message: "bytes do not match returned length" },
  ),
  z.object({
    status: z.literal("unavailable"),
    hash: sha256Schema,
    size_bytes: size,
    code: z.literal("unavailable"),
    reason: blobUnavailableReasonSchema,
  }),
]);
export type BlobReadResult = z.infer<typeof blobReadResultSchema>;

export const blobsRead = defineRead({
  resource: "blobs",
  method: "read",
  name: "blob.read",
  input: blobReadInputSchema,
  output: blobReadResultSchema,
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
    "internal",
  ],
});

export const BLOB_ROUTES = [blobsRead] as const;
