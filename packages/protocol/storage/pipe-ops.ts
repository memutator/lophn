import { z } from "zod";
import {
  type BlobPurposeDefinition,
  blobPurposeDefinitionSchema,
  preparedBlobSchema,
} from "./blob.ts";
import { defineWorker } from "../base/route.ts";
import { redactionCheck } from "../base/redaction.ts";
import { type Frame, STREAM_CHUNK_MAX_BYTES } from "../base/frame.ts";
import { sha256Schema } from "../base/values.ts";

export const BLOB_PREPARE_OP = "blob.prepare";
// 바이트 읽기는 I/O worker만 한다. core는 hash와 구간만 넘긴다.
export const BLOB_READ_OP = "blob.read";
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

// 읽은 바이트는 JSON이 아니라 이 channel의 byte chunk frame으로 돌아온다.
// 256KiB 창의 base64는 JSON control frame 한도(256KiB)를 넘기 때문이다.
export const blobReadPipeInputSchema = z.strictObject({
  hash: sha256Schema,
  offset: z.number().int().nonnegative(),
  length: z.number().int().nonnegative(),
  channel: z.number().int().min(1).max(0xffffffff),
});

export const blobReadPipe = defineWorker({
  resource: "blobs",
  method: "read",
  name: BLOB_READ_OP,
  input: blobReadPipeInputSchema,
  output: z.strictObject({
    hash: sha256Schema,
    size_bytes: z.number().int().nonnegative(),
    channel: z.number().int().min(1).max(0xffffffff),
  }),
  actors: ["machine"],
  errors: ["not_found", "unavailable"],
});

export const BLOB_PIPE_OPS = [blobPrepare, blobReadPipe] as const;

export const PIPE_OPS = [blobPrepare, blobReadPipe, redactionCheck] as const;
