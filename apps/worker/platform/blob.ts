// I/O worker의 blob 준비 경계(blob contract, platform/blob-store#R1, R2, R3, R12).
// hash·fsync·설치는 이 경계만 한다. 임의 파일 경로는 받지 않고 JSON payload에
// stream을 넣지 않는다. bytes는 supervision 요청의 channel에 묶인다.

import { type ErrorCode } from "../../../packages/base/mod.ts";
import {
  BLOB_PREPARE_OP,
  BLOB_READ_OP,
  blobPrepareInputSchema,
  blobReadPipeInputSchema,
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
  | { request_id: string; ok: true; payload: PreparedBlob | BlobReadPayload }
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
      if (request.op === BLOB_READ_OP) {
        return await readBlob(deps.work, request);
      }
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

// 등록된 hash의 그 구간만 읽는다. hash는 경로로만 쓰고 다시 계산하지 않는다.
type BlobReadPayload = { hash: string; size_bytes: number; bytes: string };

async function readBlob(
  work: BlobStoreWork,
  request: BlobPipeRequest,
): Promise<BlobPipeResponse> {
  const parsed = blobReadPipeInputSchema.safeParse(request.payload);
  if (!parsed.success) {
    return failed(request.request_id, {
      code: "invalid_input",
      message: "blob 읽기 입력이 schema와 다르다",
    });
  }
  const result = await work.read(
    parsed.data.hash,
    parsed.data.offset,
    parsed.data.length,
  );
  if (!result.ok) return failed(request.request_id, result.error);
  return {
    request_id: request.request_id,
    ok: true,
    payload: {
      hash: result.value.hash,
      size_bytes: result.value.sizeBytes,
      bytes: base64Of(result.value.bytes),
    },
  };
}

// 한 번에 펼치면 큰 구간에서 호출 인자 한도를 넘는다. 256KiB는 그 안이지만 구간을 나눠 인코딩한다.
function base64Of(bytes: Uint8Array): string {
  let text = "";
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) {
    text += String.fromCharCode(...bytes.subarray(i, i + step));
  }
  return btoa(text);
}

function failed(
  requestId: string,
  error: { code: ErrorCode; message: string },
): BlobPipeResponse {
  return { request_id: requestId, ok: false, error };
}
