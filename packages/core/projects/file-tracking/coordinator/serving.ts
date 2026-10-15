// 제품 core가 문서 route를 서빙하는 조립. 두 길이다.
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
} from "../../../../base/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../../../protocol/supervision/mod.ts";
import type {
  HealthObservation,
  RequestContext,
} from "../../../../protocol/server/mod.ts";
import { BLOB_READ_MAX_BYTES } from "../../../../protocol/storage/mod.ts";
import type { ReadRoute } from "../../../../protocol/base/mod.ts";
import type {
  WorkerChannel,
  WorkerRouteTarget,
} from "../../../supervision/responsiveness/mod.ts";
import {
  DOCUMENT_OPS,
  type StatusMemory,
  type StatusObservation,
} from "../mod.ts";
import {
  DOCUMENT_UPLOAD_MAX_BYTES,
  documentFile,
  searchQuery,
  searchStatus,
} from "../../../../protocol/projects/mod.ts";
import type { FileStreamHandler } from "../../../server/mod.ts";
import {
  DIRECT_ANSWER_ROUTE,
  DIRECT_EXTRACT_ROUTES,
  DIRECT_PLAN_ROUTE,
  internalRoute,
  SERVED_ROUTES,
  servedKey,
  STORED_FILE_ROUTE,
} from "../../outline-and-search/served.ts";

// FileStatus 조회. coordinator 메모리에 마지막 관측이 있으면 돌려주고, 없으면
// 관측이 없는 것(undefined)이다. coordinator에 닿지 못하면 err다.
export function statusMemoryVia(channel: WorkerChannel): StatusMemory {
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
  // 추출 안 된 고정 판의 대표 파일을 읽는 blob 통로(I/O worker). 없으면 직접 추출을 하지 않는다.
  blob?: BlobReader;
  // search 답이 뒤처짐(lagging)이면 index가 자기 자리부터 따라잡게 한다.
  wakeSearch?(): void;
};

// blob-store의 인가·hash 검사를 거치는 바이트 읽기와 그 통로가 떠 있는지.
export type BlobReader = {
  read(
    hash: string,
    offset: number,
    length: number,
  ): Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;
  ready(): boolean;
};

// 답에 index 반영 범위(coverage)를 싣는 search route.
const COVERAGE_KEYS: ReadonlySet<string> = new Set(
  [searchQuery, searchStatus].map(servedKey),
);

const DIRECT_KEYS: ReadonlySet<string> = new Set(
  DIRECT_EXTRACT_ROUTES.map(servedKey),
);

// 판의 대표 파일 바이트를 창 단위로 모은다. 한 파일은 직접 추출 한도(1 MiB) 안이다.
async function readWhole(
  blob: BlobReader,
  file: { blob_hash: string; bytes: number },
): Promise<Result<Uint8Array>> {
  const whole = new Uint8Array(file.bytes);
  let offset = 0;
  while (offset < file.bytes) {
    const read = await blob.read(
      file.blob_hash,
      offset,
      Math.min(BLOB_READ_MAX_BYTES, file.bytes - offset),
    );
    if (
      !read.ok || read.value.hash !== file.blob_hash ||
      read.value.sizeBytes !== file.bytes || read.value.bytes.length === 0 ||
      offset + read.value.bytes.length > file.bytes
    ) {
      return err({
        code: "unavailable",
        message: "file bytes were not readable",
      });
    }
    whole.set(read.value.bytes, offset);
    offset += read.value.bytes.length;
  }
  return ok(whole);
}

// reader의 읽기가 추출 안 됨(unverified)으로 답한 고정 판은
// 무관한 ledger 쓰기나 전체 index 반영을 기다리지 않고 그 판을 직접 추출해 답한다. reader가
// 권한을 판정한 계획대로 core가 blob-store 인가·hash 검사를 거쳐 대표 파일 바이트를 읽고, reader가
// 이번 응답에만 추출한다. 어디서든 막히면 처음의 unverified 답을 그대로 낸다(꾸미지 않는다).
async function extractDirectly(
  deps: Pick<ServedDeps, "readers" | "blob">,
  ctx: RequestContext,
  key: string,
  request: unknown,
  first: Result<unknown>,
): Promise<Result<unknown>> {
  if (!first.ok || !DIRECT_KEYS.has(key)) return first;
  const blob = deps.blob;
  if (blob === undefined || !blob.ready()) return first;
  // 본문 읽기는 unverified로, outline은 추출 안 된 판에 항목 없는 답으로 나온다. 정말 추출이 필요한지는
  // reader의 계획이 derived로 판정한다.
  const answer = first.value as { section_status?: unknown; entries?: unknown };
  const unextracted = answer.section_status === "unverified" ||
    (Array.isArray(answer.entries) && answer.entries.length === 0);
  if (!unextracted) return first;
  const planned = await deps.readers.read(DIRECT_PLAN_ROUTE, ctx, {
    route: key,
    request,
  });
  if (!planned.ok) return first;
  const file = (planned.value as {
    file: { path: string; blob_hash: string; bytes: number } | null;
  }).file;
  if (file === null) return first;
  const content = await readWhole(blob, file);
  if (!content.ok) return first;
  const answered = await deps.readers.read(DIRECT_ANSWER_ROUTE, ctx, {
    route: key,
    request,
    path: file.path,
    content: content.value,
  });
  return answered.ok ? answered : first;
}

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
          const ran = await extractDirectly(
            deps,
            ctx.value,
            servedKey(route),
            request.payload,
            await deps.readers.read(internal, ctx.value, request.payload),
          );
          if (!ran.ok) {
            return failed(workerCode(ran.error.code), ran.error.message);
          }
          // feed는 documents event만 받으므로, 그 밖의 ledger 쓰기로
          // head가 앞서간 index는 다음 documents event까지 뒤처진 채 머문다. 뒤처진 답을 본 읽기가
          // index를 깨워 자기 자리부터 head까지 따라잡게 한다(다음 읽기가 채워진 답을 본다).
          const coverage = (ran.value as { coverage?: { lagging?: unknown } })
            .coverage;
          if (
            COVERAGE_KEYS.has(servedKey(route)) && coverage?.lagging === true
          ) {
            deps.wakeSearch?.();
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
