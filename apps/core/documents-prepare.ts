// `/v1/documents/prepare` worker route 조립(documents T11). T8은 fake port로만
// 검증했다. 여기서는 canonical 목록을 stream으로 끊어 hash와 blob 준비를 같은
// stream에서 만든다. 목록 전체를 한 버퍼로 모으지 않는다.
import { createHash } from "node:crypto";
import {
  err,
  ERROR_CODES,
  type ErrorCode,
  ok,
  type Result,
} from "../../packages/base/mod.ts";
import { documentPrepare } from "../../packages/contracts/documents/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../packages/contracts/platform/mod.ts";
import type { WorkerRouteHandle } from "../../packages/platform/responsiveness/mod.ts";
import {
  type BlobSink,
  prepareFromStream,
} from "../../packages/documents/file-tracking/stream.ts";
import {
  createPrepareAssembly,
  type PrepareDeps,
  type PrepareFilesPort,
} from "../../packages/documents/versions/work.ts";
import { canonicalFilesJson } from "../../packages/documents/versions/model.ts";
import type { ContentFile } from "../../packages/contracts/documents/mod.ts";

// canonical JSON을 고정 크기 chunk로 끊는다. 한 chunk가 목록 전체가 되지 않게
// 상한을 둔다. 작은 목록도 최소 한 번은 끊긴 stream으로 흐른다.
const CHUNK_BYTES = 1024;

function jsonStream(text: string): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + CHUNK_BYTES, bytes.length);
      controller.enqueue(bytes.subarray(offset, end));
      offset = end;
    },
  });
}

// blob 준비 중계를 sink로 잇는다. chunk는 중계가 읽는 stream으로 바로 넘어가고
// 중간에 모으지 않는다. 한 chunk의 전달을 기다린 뒤에 다음 chunk를 넣는다.
export function relaySink(
  prepare: (bytes: ReadableStream<Uint8Array>) => Promise<
    Result<{ preparation: string }>
  >,
): BlobSink {
  let push: ((chunk: Uint8Array | null) => void) | undefined;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      push = (chunk) => {
        if (chunk === null) controller.close();
        else controller.enqueue(chunk);
      };
    },
  });
  const pending = prepare(stream);
  return {
    write(chunk) {
      push?.(chunk);
      return Promise.resolve(ok(undefined));
    },
    async finish() {
      push?.(null);
      const prepared = await pending;
      if (!prepared.ok) return prepared;
      return ok({ preparation: prepared.value.preparation });
    },
  };
}

// 목록 blob의 준비 참조는 principal·purpose·hash가 같으면 하나다(10분 수명, 같은 참조의
// 두 번째 준비는 conflict). 파일을 A→B→A로 되돌리면 같은 목록 hash를 다시 준비하게 되므로
// 살아 있는 준비를 다시 쓴다. 수명이 다 되기 전에 놓아 주고(마진) 새로 준비한다.
export const LIST_PREPARATION_REUSE_MS = 8 * 60 * 1000;

type ListPreparation = {
  preparation: string;
  hash: string;
  size_bytes: number;
};
export type ListPreparationMemo = {
  take(
    principal: string,
    hash: string,
  ): Promise<Result<ListPreparation>> | undefined;
  keep(
    principal: string,
    hash: string,
    pending: Promise<Result<ListPreparation>>,
  ): void;
};

export function createListPreparationMemo(
  nowMs: () => number,
  reuseMs: number = LIST_PREPARATION_REUSE_MS,
): ListPreparationMemo {
  const live = new Map<string, {
    pending: Promise<Result<ListPreparation>>;
    at: number;
  }>();
  const keyOf = (principal: string, hash: string) =>
    `${principal}\u0000${hash}`;
  const sweep = () => {
    const now = nowMs();
    for (const [key, entry] of live) {
      if (now - entry.at >= reuseMs) live.delete(key);
    }
  };
  return {
    take(principal, hash) {
      sweep();
      return live.get(keyOf(principal, hash))?.pending;
    },
    keep(principal, hash, pending) {
      const key = keyOf(principal, hash);
      live.set(key, { pending, at: nowMs() });
      // 실패한 준비는 다시 시도할 수 있게 남기지 않는다.
      void pending.then((done) => {
        if (!done.ok && live.get(key)?.pending === pending) live.delete(key);
      });
    },
  };
}

// 같은 stream에서 hash와 blob 준비를 만드는 PrepareFilesPort. sink는 blob 준비
// 중계(core)가 채운다. 테스트는 메모리 sink를 넣는다. reuse가 있으면 같은 주체의 같은
// 목록 hash는 살아 있는 준비를 다시 쓴다.
export function streamingPrepareFiles(
  sink: () => BlobSink,
  reuse?: { memo: ListPreparationMemo; principal: string | undefined },
): PrepareFilesPort {
  return (files: readonly ContentFile[]) => {
    const text = canonicalFilesJson(files);
    const principal = reuse?.principal;
    const hash = reuse === undefined || principal === undefined
      ? undefined
      : createHash("sha256").update(text).digest("hex");
    if (reuse !== undefined && principal !== undefined && hash !== undefined) {
      const found = reuse.memo.take(principal, hash);
      if (found !== undefined) return found;
    }
    const pending = (async () => {
      const streamed = await prepareFromStream(jsonStream(text), sink());
      if (!streamed.ok) return streamed;
      return ok({
        preparation: streamed.value.preparation,
        hash: streamed.value.hash,
        size_bytes: streamed.value.size_bytes,
      });
    })();
    if (reuse !== undefined && principal !== undefined && hash !== undefined) {
      reuse.memo.keep(principal, hash, pending);
    }
    return pending;
  };
}

// 기준 판 읽기는 요청한 자격으로 한다: 권한 밖 문서의 판은 없는 판과 같은 답이다.
// from은 그 요청의 request_id와 대상 문서다.
export type BaseVersionFor = (
  baseVersion: string,
  from: { request_id: string; document: string },
) => ReturnType<PrepareDeps["loadBaseVersion"]>;

export type PrepareRouteDeps =
  & Omit<PrepareDeps, "prepareFiles" | "loadBaseVersion">
  & {
    loadBaseVersion: BaseVersionFor;
    // 준비 참조의 principal은 요청 자격의 principal이다(저장 command가 같은 자격으로
    // 등록하므로 다르면 forbidden이다). 요청마다 sink를 만든다.
    sink: (request: WorkerRequest) => BlobSink;
    // route가 준비됐는지. worker가 뜨기 전에는 unavailable이다.
    available(): boolean;
    observedAt(): string;
    // 요청 자격의 principal과 core 시각. 있으면 목록 blob의 살아 있는 준비를 다시 쓴다.
    principalOf?(request: WorkerRequest): string | undefined;
    nowMs?(): number;
  };

// startApiServer의 workers map에 넣는 항목. key는 `documents/prepare`다.
export function documentPrepareRoute(
  deps: PrepareRouteDeps,
): { key: string; handle: WorkerRouteHandle } {
  const memo = createListPreparationMemo(deps.nowMs ?? Date.now);
  // 조립은 요청마다 만든다: 기준 판 읽기가 그 요청의 자격에 묶인다.
  const prepareFor = (request: WorkerRequest) =>
    createPrepareAssembly({
      validateFiles: deps.validateFiles,
      prepareFiles: streamingPrepareFiles(
        () => deps.sink(request),
        { memo, principal: deps.principalOf?.(request) },
      ),
      loadBaseVersion: (baseVersion) =>
        deps.loadBaseVersion(baseVersion, {
          request_id: request.request_id,
          document: (request.payload as { document?: string }).document ?? "",
        }),
    });
  return {
    key: `${documentPrepare.resource}/${documentPrepare.method}`,
    handle: {
      observation: () => ({
        component: "documents/prepare",
        available: deps.available(),
        observed_at: deps.observedAt(),
      }),
      forward: (request: WorkerRequest) => answer(prepareFor(request), request),
    },
  };
}

function workerCode(code: string): ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code)
    ? code as ErrorCode
    : "invalid_input";
}

async function answer(
  prepare: ReturnType<typeof createPrepareAssembly>,
  request: WorkerRequest,
): Promise<Result<WorkerResponse>> {
  if (request.op !== documentPrepare.name) {
    return err({ code: "invalid_input", message: "unknown prepare op" });
  }
  const ran = await prepare(request.payload as Parameters<typeof prepare>[0]);
  if (!ran.ok) {
    // 조립이 낸 code를 그대로 전한다. unavailable을 invalid_input으로 낮추지 않는다.
    return ok({
      type: "worker_response",
      request_id: request.request_id,
      ok: false,
      error: { code: workerCode(ran.error.code), message: ran.error.message },
    });
  }
  return ok({
    type: "worker_response",
    request_id: request.request_id,
    ok: true,
    payload: ran.value,
  });
}
