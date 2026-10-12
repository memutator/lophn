// I/O worker의 blob 준비 경계(blob contract, platform/blob-store#R1, R2, R3, R12).
// hash·fsync·설치는 이 경계만 한다. 임의 파일 경로는 받지 않고 JSON payload에
// stream을 넣지 않는다. bytes는 supervision 요청의 channel에 묶인다.

import { type ErrorCode } from "../../../../base/mod.ts";
import {
  BLOB_PREPARE_OP,
  BLOB_READ_OP,
  blobPrepareInputSchema,
  blobReadPipeInputSchema,
  type PreparedBlob,
  STREAM_CHUNK_MAX_BYTES,
} from "../../../../protocol/server/mod.ts";
import { type BlobStoreWork, purposesPathFor } from "../mod.ts";

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

// blob.read의 바이트는 JSON control frame에 담지 않는다. 256KiB 창의 base64는
// control frame 한도(256KiB)를 넘기 때문이다. 바이트는 요청 channel의 byte chunk
// frame으로 따로 가고, JSON에는 hash·크기만 남는다.
export type BlobPipeBytes = {
  channel: number;
  chunks: Uint8Array[];
};

export type BlobPipe = {
  // bytes callback은 core가 보낸 byte chunk frame을 해석 없이 넘길 때 부른다(Q6).
  // core는 해석·hash 없이 backpressure를 지키며 넘긴다.
  handle(
    request: BlobPipeRequest,
    bytes: () => Promise<ReadableStream<Uint8Array> | undefined>,
  ): Promise<{ response: BlobPipeResponse; bytes?: BlobPipeBytes }>;
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
        return { response: failed(request.request_id, REJECTED) };
      }
      const parsed = blobPrepareInputSchema.safeParse(request.payload);
      if (!parsed.success) {
        return {
          response: failed(request.request_id, {
            code: "invalid_input",
            message: "blob 준비 입력이 schema와 다르다",
          }),
        };
      }
      const stream = await bytes();
      if (stream === undefined) {
        return {
          response: failed(request.request_id, {
            code: "invalid_input",
            message: "blob 내용 bytes가 없다",
          }),
        };
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
        return { response: failed(request.request_id, result.error) };
      }
      // 준비가 purpose를 안전하게 남긴다(T44: trimCapacity의 capacity
      // category 할당 근거). 실패해도 준비 결과는 그대로 돌려준다.
      await recordPurpose(deps.work.root, result.value.prepared);
      return {
        response: {
          request_id: request.request_id,
          ok: true,
          payload: result.value.prepared,
        },
      };
    },
  };
}

// 등록된 hash의 그 구간만 읽는다. hash는 경로로만 쓰고 다시 계산하지 않는다.
// 바이트는 JSON이 아니라 요청 channel의 byte chunk로 돌려준다.
type BlobReadPayload = { hash: string; size_bytes: number; channel: number };

async function readBlob(
  work: BlobStoreWork,
  request: BlobPipeRequest,
): Promise<{ response: BlobPipeResponse; bytes?: BlobPipeBytes }> {
  const parsed = blobReadPipeInputSchema.safeParse(request.payload);
  if (!parsed.success) {
    return {
      response: failed(request.request_id, {
        code: "invalid_input",
        message: "blob 읽기 입력이 schema와 다르다",
      }),
    };
  }
  const result = await work.read(
    parsed.data.hash,
    parsed.data.offset,
    parsed.data.length,
  );
  if (!result.ok) {
    return { response: failed(request.request_id, result.error) };
  }
  return {
    response: {
      request_id: request.request_id,
      ok: true,
      payload: {
        hash: result.value.hash,
        size_bytes: result.value.sizeBytes,
        channel: parsed.data.channel,
      },
    },
    bytes: {
      channel: parsed.data.channel,
      chunks: chunksOf(result.value.bytes),
    },
  };
}

// byte chunk frame 상한으로 나눈다. 256KiB 창은 한 chunk에 들어간다.
function chunksOf(bytes: Uint8Array): Uint8Array[] {
  if (bytes.length === 0) return [];
  const chunks: Uint8Array[] = [];
  for (
    let offset = 0;
    offset < bytes.length;
    offset += STREAM_CHUNK_MAX_BYTES
  ) {
    chunks.push(bytes.subarray(offset, offset + STREAM_CHUNK_MAX_BYTES));
  }
  return chunks;
}

// 준비가 성공한 hash의 purpose를 분할된 목적 파일로 남긴다(T44).
// trimCapacity의 capacity category 할당 근거다. 같은 hash의 재준비는
// 같은 내용이라 같은 purpose를 남긴다(파일을 다시 쓴다). 실패는 조용히
// 둔다: 준비 자체는 성공이고, 정지 유지보수는 기록 없는 hash를 지우지
// 않는다(fail-closed).
async function recordPurpose(
  root: string,
  prepared: PreparedBlob,
): Promise<void> {
  const path = purposesPathFor(root, prepared.hash);
  if (!path.ok) {
    // sha256 밖 hash는 준비 자체가 만들지 않는다. 조용히 둔다.
    return;
  }
  try {
    await Deno.mkdir(path.value.slice(0, path.value.lastIndexOf("/")), {
      recursive: true,
      mode: 0o700,
    });
    await Deno.writeTextFile(
      path.value,
      JSON.stringify({ purpose: prepared.purpose }) + "\n",
    );
  } catch {
    // 기록 실패는 준비 결과에 새지 않는다. GC는 fail-closed다.
  }
}

function failed(
  requestId: string,
  error: { code: ErrorCode; message: string },
): BlobPipeResponse {
  return { request_id: requestId, ok: false, error };
}
