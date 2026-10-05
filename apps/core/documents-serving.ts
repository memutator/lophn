// 제품 core가 문서 route를 서빙하는 조립(documents#T11). 두 길이다.
// - 감독 pipe: documents coordinator에게 worker_request를 보내 답을 받는다(FileStatus).
//   pipe contract는 늘리지 않는다: 기존 worker_request·worker_response envelope다.
// - reader pool: outline·읽기·search·view open·export는 reader Worker의 snapshot으로
//   요청 credential의 현재 context를 다시 읽어 실행한다(documents-reader.ts).
import { createHash } from "node:crypto";
import {
  err,
  ERROR_CODES,
  type ErrorCode,
  ok,
  type Result,
  sha256Hex,
} from "../../packages/base/mod.ts";
import type {
  ChildMessage,
  HealthObservation,
  ReadRoute,
  RequestContext,
  WorkerRequest,
  WorkerResponse,
} from "../../packages/contracts/platform/mod.ts";
import type { WorkerRouteTarget } from "../../packages/platform/responsiveness/mod.ts";
import {
  DOCUMENT_OPS,
  type StatusMemory,
  type StatusObservation,
} from "../../packages/documents/file-tracking/mod.ts";
import { BLOB_READ_MAX_BYTES } from "../../packages/contracts/platform/mod.ts";
import {
  DOCUMENT_UPLOAD_MAX_BYTES,
  documentFile,
} from "../../packages/contracts/documents/mod.ts";
import type { FileStreamHandler } from "../../packages/platform/api/mod.ts";
import {
  internalRoute,
  SERVED_ROUTES,
  servedKey,
  STORED_FILE_ROUTE,
} from "./documents-served.ts";

// documents coordinator 요청 통로. 보낸 request_id의 worker_response를 기다린다.
// coordinator가 없거나 답하지 않으면 unavailable이고 성공으로 바꾸지 않는다.
export type DocumentsChannel = {
  request(
    op: string,
    payload: unknown,
    timeoutMs?: number,
  ): Promise<Result<unknown>>;
  // 감독이 child 메시지를 넘기는 callback.
  onMessage(message: ChildMessage): void;
  // 감독 pipe의 쓰기. 연결이 없으면 null이다(worker가 아직 뜨지 않음·정지).
  bind(send: ((payload: unknown) => Promise<boolean>) | null): void;
  readonly bound: boolean;
};

const REQUEST_TIMEOUT_MS = 5_000;

export function createDocumentsChannel(): DocumentsChannel {
  let send: ((payload: unknown) => Promise<boolean>) | null = null;
  let counter = 0;
  const pending = new Map<string, (answer: Result<unknown>) => void>();
  return {
    request(op, payload, timeoutMs = REQUEST_TIMEOUT_MS) {
      const sender = send;
      if (sender === null) {
        return Promise.resolve(err({
          code: "unavailable",
          message: "documents worker가 준비되지 않았다",
        }));
      }
      counter += 1;
      const id = `documents-request-${counter}`;
      return new Promise<Result<unknown>>((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          resolve(err({
            code: "unavailable",
            message: "documents worker가 시간 안에 답하지 않았다",
          }));
        }, timeoutMs);
        pending.set(id, (answer) => {
          clearTimeout(timer);
          resolve(answer);
        });
        sender({ type: "worker_request", request_id: id, op, payload }).then(
          (sent) => {
            if (sent) return;
            const settle = pending.get(id);
            pending.delete(id);
            settle?.(err({
              code: "unavailable",
              message: "documents worker에 요청을 보내지 못했다",
            }));
          },
        );
      });
    },
    onMessage(message) {
      if (message.type !== "worker_response") return;
      const settle = pending.get(message.request_id);
      if (!settle) return;
      pending.delete(message.request_id);
      settle(
        message.ok ? ok(message.payload) : err({
          code: message.error.code,
          message: "documents worker가 요청을 거절했다",
        }),
      );
    },
    bind(next) {
      send = next;
    },
    get bound() {
      return send !== null;
    },
  };
}

// FileStatus 조회. coordinator 메모리에 마지막 관측이 있으면 돌려주고, 없으면
// 관측이 없는 것(undefined)이다. coordinator에 닿지 못하면 err다.
export function statusMemoryVia(channel: DocumentsChannel): StatusMemory {
  return {
    async lookup(target) {
      const answered = await channel.request(DOCUMENT_OPS.fileStatus, target);
      if (!answered.ok) return answered;
      const body = answered.value as { observation?: StatusObservation | null };
      return ok(body.observation ?? undefined);
    },
  };
}

export type ServedDeps = {
  readers: {
    read(
      route: Pick<ReadRoute, "resource" | "method">,
      ctx: RequestContext,
      input: unknown,
    ): Promise<Result<unknown>>;
    health(): readonly ("healthy" | "unhealthy" | "closed")[];
  };
  // credential_ref의 현재 context. 폐기·만료된 자격은 err다.
  current(credentialRef: string): Result<RequestContext>;
  observedAt(): string;
};

// HTTP dispatch가 worker route 요청의 request_id를 `<credential_ref>/<시각>`으로
// 만든다. 서빙은 그 credential의 현재 context를 ledger에서 다시 읽는다(platform/api).
function credentialOf(requestId: string): string | undefined {
  const slash = requestId.lastIndexOf("/");
  return slash > 0 ? requestId.slice(0, slash) : undefined;
}

function workerCode(code: string): ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code)
    ? code as ErrorCode
    : "internal";
}

// startApiServer의 workers map에 넣는 서빙 대상. key는 `<resource>/<method>`다.
export function servedWorkers(
  deps: ServedDeps,
): Map<string, WorkerRouteTarget> {
  const targets = new Map<string, WorkerRouteTarget>();
  for (const route of SERVED_ROUTES) {
    const internal = internalRoute(route);
    targets.set(servedKey(route), {
      handle: {
        observation(): HealthObservation {
          const healthy = deps.readers.health().length > 0 &&
            deps.readers.health().every((state) => state === "healthy");
          return {
            component: "documents/worker",
            available: healthy,
            ...(healthy ? {} : { reason: "reader가 준비되지 않았다" }),
            observed_at: deps.observedAt(),
          };
        },
        async forward(request: WorkerRequest) {
          const failed = (
            code: ErrorCode,
            message: string,
          ): Result<WorkerResponse> =>
            ok({
              type: "worker_response",
              request_id: request.request_id,
              ok: false,
              error: { code, message },
            });
          const ref = credentialOf(request.request_id);
          if (ref === undefined) {
            return failed("unauthorized", "credential이 없다");
          }
          const ctx = deps.current(ref);
          if (!ctx.ok) return failed("unauthorized", "credential이 없다");
          const ran = await deps.readers.read(
            internal,
            ctx.value,
            request.payload,
          );
          if (!ran.ok) {
            return failed(workerCode(ran.error.code), ran.error.message);
          }
          return ok({
            type: "worker_response",
            request_id: request.request_id,
            ok: true,
            payload: ran.value,
          });
        },
      },
    });
  }
  return targets;
}

// `GET /v1/documents/file`이 돌려주는 바이트 상한은 문서 upload 상한이다. 한 판의 파일은
// 그보다 클 수 없다. 응답은 창 단위 stream이라 core는 한 파일을 모으지 않는다.
export const STORED_FILE_MAX_BYTES = DOCUMENT_UPLOAD_MAX_BYTES;

// documents/file 서빙 대상(file kind route, stream). 판정은 reader Worker의 snapshot이
// 한다(`document.file` 권한, 고정 판의 경로별 파일 행, 범위 밖·없는 판·없는 경로는 같은
// not_found). 판정이 낸 blob hash·바이트 수대로 I/O worker의 blob.read를 창(256 KiB)
// 단위로, 응답 소비자가 당길 때만 읽어 흘린다(backpressure, core 메모리는 창 몇 개).
// 읽는 동안 sha256을 이어 갱신하고, 끝에서 크기·hash가 판의 행과 다르면 마지막 창을
// 보내지 않고 응답을 오류로 끝낸다(Content-Length를 채우지 못해 응답이 끊긴다).
// blob이 없거나 어긋나면 일부 바이트나 다른 판의 바이트로 꾸미지 않는다. 창마다 요청
// credential이 아직 현재인지 다시 본다(platform architecture, 긴 blob 조각 재검사).
export function storedFileStreams(
  deps: Pick<ServedDeps, "readers" | "current"> & {
    readBlob(
      hash: string,
      offset: number,
      length: number,
    ): Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;
    // blob 읽기 통로(I/O worker)가 떠 있는지.
    blobReady(): boolean;
  },
): Map<string, FileStreamHandler> {
  const key = `${documentFile.resource}/${documentFile.method}`;
  const unavailable = (message: string): Result<never> =>
    err({ code: "unavailable", message });
  return new Map([[key, async (ctx, input) => {
    const states = deps.readers.health();
    if (
      states.length === 0 || !states.every((state) => state === "healthy") ||
      !deps.blobReady()
    ) {
      return unavailable("reader나 blob 읽기가 준비되지 않았다");
    }
    const judged = await deps.readers.read(STORED_FILE_ROUTE, ctx, input);
    if (!judged.ok) {
      return err({
        code: workerCode(judged.error.code),
        message: judged.error.message,
      });
    }
    const file = judged.value as {
      hash: string;
      bytes: number;
      media_type: string;
    };
    if (file.bytes > STORED_FILE_MAX_BYTES) {
      return unavailable("file exceeds the serving limit");
    }
    if (file.bytes === 0) {
      if (await sha256Hex(new Uint8Array()) !== file.hash) {
        return unavailable("file bytes do not match the version");
      }
      return ok({
        contentType: file.media_type,
        length: 0,
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            controller.close();
          },
        }),
      });
    }
    const digest = createHash("sha256");
    let offset = 0;
    // 다음 창 하나를 읽고 검사한다. 마지막 창이면 전체 hash까지 맞아야 돌려준다: 어긋나면
    // 그 창은 내보내지 않는다.
    const window = async (): Promise<Result<Uint8Array>> => {
      if (!deps.current(ctx.credential_ref).ok) {
        return unavailable("credential is no longer current");
      }
      const read = await deps.readBlob(
        file.hash,
        offset,
        Math.min(BLOB_READ_MAX_BYTES, file.bytes - offset),
      );
      if (
        !read.ok || read.value.hash !== file.hash ||
        read.value.sizeBytes !== file.bytes ||
        read.value.bytes.length === 0 ||
        offset + read.value.bytes.length > file.bytes
      ) {
        return unavailable("file bytes were not readable");
      }
      digest.update(read.value.bytes);
      offset += read.value.bytes.length;
      if (offset === file.bytes && digest.digest("hex") !== file.hash) {
        return unavailable("file bytes do not match the version");
      }
      return ok(read.value.bytes);
    };
    // 첫 창은 응답을 열기 전에 읽는다. blob이 없거나 어긋난 파일, 한 창짜리 파일의 hash
    // 불일치는 헤더를 보내기 전에 JSON 오류(unavailable)가 된다.
    let first: Uint8Array | undefined;
    const opened = await window();
    if (!opened.ok) return opened;
    first = opened.value;
    const body = new ReadableStream<Uint8Array>({
      async pull(controller) {
        let chunk = first;
        first = undefined;
        if (chunk === undefined) {
          const next = await window();
          if (!next.ok) {
            // 이미 일부를 보냈다. 응답을 끝내지 않고 오류로 끊는다.
            controller.error(new Error(next.error.message));
            return;
          }
          chunk = next.value;
        }
        controller.enqueue(chunk);
        if (offset >= file.bytes) controller.close();
      },
    }, { highWaterMark: 0 });
    return ok({
      contentType: file.media_type,
      length: file.bytes,
      body,
    });
  }]]);
}
