// I/O worker의 blob 준비 경계(blob contract, platform/blob-store#R1, R2, R3, R12).
// hash·fsync·설치는 이 경계만 한다. 임의 파일 경로는 받지 않고 JSON payload에
// stream을 넣지 않는다. bytes는 supervision 요청의 channel에 묶인다.

import { type ErrorCode } from "../../../packages/base/mod.ts";
import {
  BLOB_PREPARE_OP,
  blobPrepareInputSchema,
  type PreparedBlob,
} from "../../../packages/contracts/platform/mod.ts";
import {
  type BlobStoreWork,
} from "../../../packages/platform/blob-store/mod.ts";

export type BlobPipeRequest = {
  request_id: string;
  op: string;
  payload: unknown;
};

export type BlobPipeResponse =
  | { request_id: string; ok: true; payload: PreparedBlob }
  | {
    request_id: string;
    ok: false;
    error: { code: ErrorCode; message: string };
  };

export type BlobPipe = {
  // bytes callback은 core가 보낸 byte chunk frame을 해석 없이 넘길 때 부른다(Q6).
  // core는 해석·hash 없이 backpressure를 지키며 넘긴다.
  handle(
    request: BlobPipeRequest,
    bytes: () => Promise<ReadableStream<Uint8Array> | undefined>,
  ): Promise<BlobPipeResponse>;
};

const REJECTED = {
  code: "unavailable" as const,
  message: "blob 준비 통로가 없다",
};

export function createBlobPipe(deps: {
  work: BlobStoreWork;
  // 준비 파일 접미사. 내용에서 파생하지 않는다.
  suffix: () => string;
}): BlobPipe {
  return {
    async handle(request, bytes) {
      if (request.op !== BLOB_PREPARE_OP) {
        return failed(request.request_id, REJECTED);
      }
      const parsed = blobPrepareInputSchema.safeParse(request.payload);
      if (!parsed.success) {
        return failed(request.request_id, {
          code: "invalid_input",
          message: "blob 준비 입력이 schema와 다르다",
        });
      }
      const stream = await bytes();
      if (stream === undefined) {
        return failed(request.request_id, {
          code: "invalid_input",
          message: "blob 내용 bytes가 없다",
        });
      }
      const result = await deps.work.prepare(
        {
          preparation: request.request_id,
          principal: parsed.data.principal,
          purpose: parsed.data.purpose,
          expectedHash: parsed.data.expected_hash,
        },
        stream,
      );
      if (!result.ok) {
        return failed(request.request_id, result.error);
      }
      return {
        request_id: request.request_id,
        ok: true,
        payload: result.value.prepared,
      };
    },
  };
}

function failed(
  requestId: string,
  error: { code: ErrorCode; message: string },
): BlobPipeResponse {
  return { request_id: requestId, ok: false, error };
}
