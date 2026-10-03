import { z } from "zod";
import {
  type BlobPurposeDefinition,
  blobPurposeDefinitionSchema,
  preparedBlobSchema,
} from "./blob.ts";
import { defineWorker } from "./route.ts";
import { type Frame, STREAM_CHUNK_MAX_BYTES } from "./supervision.ts";
import { sha256Schema } from "./values.ts";

export const BLOB_PREPARE_OP = "blob.prepare";
export const BLOB_PREPARE_CHUNK_MAX_BYTES = STREAM_CHUNK_MAX_BYTES;

// bytes는 supervision 요청의 channel에 묶인다. JSON payload에는 stream을 넣지 않는다.
export type BlobPrepareChunk = Extract<Frame, { kind: "bytes" }>;

export const blobPrepareInputSchema = z.strictObject({
  principal: z.string().min(1),
  purpose: blobPurposeDefinitionSchema.shape.purpose,
  expected_hash: sha256Schema.optional(),
});
export type BlobPrepareInput = z.infer<typeof blobPrepareInputSchema>;
export const blobPrepareOutputSchema = preparedBlobSchema;

// 소유 concern의 등록 purpose와 더 낮은 크기 한도를 worker 경계에 보존한다.
export function blobPrepareSchemas<const P extends string>(
  definition: BlobPurposeDefinition<P>,
) {
  blobPurposeDefinitionSchema.parse(definition);
  return {
    input: blobPrepareInputSchema.extend({
      purpose: z.literal(definition.purpose),
    }),
    output: preparedBlobSchema.extend({
      purpose: z.literal(definition.purpose),
      size_bytes: preparedBlobSchema.shape.size_bytes.max(
        definition.max_size_bytes,
      ),
    }),
  };
}

export const blobPrepare = defineWorker({
  resource: "blobs",
  method: "prepare",
  name: BLOB_PREPARE_OP,
  input: blobPrepareInputSchema,
  output: blobPrepareOutputSchema,
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "unavailable",
    "internal",
  ],
});

export const BLOB_PIPE_OPS = [blobPrepare] as const;
