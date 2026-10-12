import { assert, assertEquals, assertThrows } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { BLOB_PREPARE_MAX_BYTES, defineBlobPurpose } from "./blob.ts";
import {
  BLOB_PIPE_OPS,
  BLOB_PREPARE_CHUNK_MAX_BYTES,
  BLOB_PREPARE_OP,
  BLOB_READ_OP,
  blobPrepare,
  type BlobPrepareChunk,
  blobPrepareInputSchema,
  blobPrepareSchemas,
  blobReadPipe,
  blobReadPipeInputSchema,
} from "./pipe-ops.ts";
import {
  encodeFrame,
  FrameDecoder,
  workerRequestSchema,
  workerResponseSchema,
} from "./supervision.ts";

const hash = "a".repeat(64);
const input = {
  principal: "user",
  purpose: "document_file",
  expected_hash: hash,
};
const output = {
  preparation: "preparation-1",
  principal: "user",
  purpose: "document_file",
  hash,
  size_bytes: 3,
};

Deno.test("platform/blob-store#R3 platform/blob-store#R4: blob.prepare 이름과 pipe payload는 architecture 5장과 같다", () => {
  assertEquals(BLOB_PIPE_OPS.map((op) => [op.kind, op.name]), [
    ["worker", "blob.prepare"],
    ["worker", "blob.read"],
  ]);
  assertEquals(BLOB_PREPARE_OP, "blob.prepare");
  assertEquals(blobPrepareInputSchema.parse(input), input);
  assert(
    blobPrepareInputSchema.safeParse({
      principal: "user",
      purpose: "document_file",
    }).success,
  );
  for (const code of blobPrepare.errors) assert(ERROR_CODES.includes(code));
  for (
    const invalid of [
      { ...input, path: "/private/file" },
      { ...input, bytes: "YWJj" },
      { ...input, channel: 1 },
      { ...input, principal: "" },
      { ...input, purpose: "" },
      { ...input, expected_hash: hash.toUpperCase() },
    ]
  ) assert(!blobPrepareInputSchema.safeParse(invalid).success);
});

Deno.test("platform/blob-store#R4 platform/blob-store#R12 platform/blob-store#R13: 등록 purpose와 소유 concern의 낮은 한도를 보존한다", () => {
  const purpose = defineBlobPurpose({
    purpose: "document_file",
    max_size_bytes: 3,
  });
  const schemas = blobPrepareSchemas(purpose);
  assert(schemas.input.safeParse(input).success);
  assert(schemas.output.safeParse(output).success);
  assert(
    !schemas.input.safeParse({ ...input, purpose: "diagnostics" }).success,
  );
  assert(
    !schemas.output.safeParse({ ...output, purpose: "diagnostics" }).success,
  );
  assert(!schemas.output.safeParse({ ...output, size_bytes: 4 }).success);
  assertThrows(() =>
    blobPrepareSchemas({
      purpose: "document_file",
      max_size_bytes: BLOB_PREPARE_MAX_BYTES + 1,
    })
  );
  const parsed = schemas.input.parse(input);
  const literal: "document_file" = parsed.purpose;
  void literal;
});

Deno.test("platform/blob-store#R3 platform/blob-store#R4: op payload는 supervision worker 메시지와 bytes frame 위에 실린다", () => {
  const request = workerRequestSchema(blobPrepareInputSchema).parse({
    type: "worker_request",
    request_id: "request-1",
    op: BLOB_PREPARE_OP,
    channel: 1,
    payload: input,
  });
  const response = workerResponseSchema(blobPrepare.output).parse({
    type: "worker_response",
    request_id: request.request_id,
    ok: true,
    payload: output,
  });
  const chunk: BlobPrepareChunk = {
    kind: "bytes",
    channel: 1,
    payload: new Uint8Array([97, 98, 99]),
  };
  const frames = [
    { kind: "json" as const, channel: 0 as const, payload: request },
    chunk,
    { kind: "end" as const, channel: 1 },
    { kind: "json" as const, channel: 0 as const, payload: response },
  ];
  const decoder = new FrameDecoder();
  assertEquals(
    frames.flatMap((frame) => decoder.push(encodeFrame(frame))),
    frames,
  );
  decoder.finish();
  assertEquals(BLOB_PREPARE_CHUNK_MAX_BYTES, 1_048_576);

  // 읽기 응답의 바이트는 JSON이 아니라 요청 channel의 byte chunk frame이다.
  // 256KiB 창의 base64는 JSON control frame 한도를 넘긴다.
  const readInput = { hash, offset: 0, length: 3, channel: 2 };
  assertEquals(blobReadPipeInputSchema.parse(readInput), readInput);
  assert(
    !blobReadPipeInputSchema.safeParse({ hash, offset: 0, length: 3 }).success,
  );
  const readRequest = workerRequestSchema(blobReadPipeInputSchema).parse({
    type: "worker_request",
    request_id: "request-2",
    op: BLOB_READ_OP,
    payload: readInput,
  });
  const readResponse = workerResponseSchema(blobReadPipe.output).parse({
    type: "worker_response",
    request_id: readRequest.request_id,
    ok: true,
    payload: { hash, size_bytes: 3, channel: 2 },
  });
  assert(
    !blobReadPipe.output.safeParse({ hash, size_bytes: 3, bytes: "YWJj" })
      .success,
  );
  const readFrames = [
    { kind: "json" as const, channel: 0 as const, payload: readRequest },
    {
      kind: "bytes" as const,
      channel: 2,
      payload: new Uint8Array([97, 98, 99]),
    },
    { kind: "json" as const, channel: 0 as const, payload: readResponse },
  ];
  const readDecoder = new FrameDecoder();
  assertEquals(
    readFrames.flatMap((frame) => readDecoder.push(encodeFrame(frame))),
    readFrames,
  );
  readDecoder.finish();
  assertThrows(() =>
    encodeFrame({
      ...chunk,
      payload: new Uint8Array(BLOB_PREPARE_CHUNK_MAX_BYTES + 1),
    })
  );
  assertThrows(() => encodeFrame({ ...chunk, channel: 0 }));
});
