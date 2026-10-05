// 사람 파일 route와 `/v1/projects/preview_tracking`을 core가 서빙하는 조립(documents#T12).
// core는 파일을 열지 않는다. user 자격과 요청 credential이 만든 준비 참조를 확인하고, 원문
// blob을 I/O worker에서 읽어 감독 pipe의 byte chunk frame으로 documents coordinator에 넘기고,
// 같은 channel을 가리키는 요청을 보낸다(documents-validate.ts와 같은 길). 목표 풀이·원자 교체·
// 기록은 coordinator와 준비 worker가 한다. 바이트는 core 메모리에 창 하나보다 오래 머물지 않는다.
// working copy의 판 확정(version_request)만 core가 한다: 판은 요청한 사람의 자격으로 저장해야
// 해서 worker의 machine credential이 아니라 요청 credential의 `document.prepare`·`document.save`다.
import {
  err,
  ERROR_CODES,
  type ErrorCode,
  ok,
  type Result,
} from "../../packages/base/mod.ts";
import {
  FILE_DELETE_DECISION,
  type FileOperationResult,
  fileOperationResultSchema,
  filesDelete,
  filesRead,
  filesRename,
  filesWatch,
  filesWrite,
  type FileTarget,
  projectPreviewTracking,
  type SaveResult,
  saveResultSchema,
} from "../../packages/contracts/documents/mod.ts";
import {
  BLOB_READ_MAX_BYTES,
  type PreparedBlob,
  type WorkerRequest,
  type WorkerResponse,
} from "../../packages/contracts/platform/mod.ts";
import type { WorkerRouteTarget } from "../../packages/platform/responsiveness/mod.ts";
import {
  DOCUMENT_OPS,
  type WorkingCopyCheck,
} from "../../packages/documents/file-tracking/mod.ts";
import { fromBase64 } from "../../packages/documents/file-tracking/base64.ts";
import type { WorkingCopyBasis } from "../../packages/documents/file-tracking/file-ipc.ts";

export type FilesRouteDeps = {
  // documents coordinator 요청 통로.
  request(
    op: string,
    payload: unknown,
    timeoutMs?: number,
  ): Promise<Result<unknown>>;
  // coordinator 감독 pipe가 묶여 있는지.
  bound(): boolean;
  readBlob(
    hash: string,
    offset: number,
    length: number,
  ): Promise<Result<{ hash: string; sizeBytes: number; bytes: Uint8Array }>>;
  sendBytes(channel: number, chunk: Uint8Array): Promise<boolean>;
  // 요청 credential의 현재 principal. 폐기·만료된 자격은 없다.
  principalOf(request: WorkerRequest): string | undefined;
  // 이 주체·purpose·내용의 준비가 아직 살아 있는지.
  live(prepared: { principal: string; purpose: string; hash: string }): boolean;
  // working copy의 문서 근거. 요청 credential로 reader Worker의 snapshot을 읽는다.
  copyCheck(
    request: WorkerRequest,
    document: string,
    baseVersion: string | null,
  ): Promise<Result<WorkingCopyCheck>>;
  // 요청한 사람의 자격으로 판을 확정한다.
  version: {
    prepare(
      request: WorkerRequest,
      payload: unknown,
    ): Promise<Result<WorkerResponse>>;
    save(
      request: WorkerRequest,
      envelope: {
        command: string;
        input: unknown;
        idempotency_key: string;
        compare: unknown;
        prepared: string[];
      },
    ): Promise<Result<unknown>>;
  };
  observedAt(): string;
};

// route confirmation의 결정 이름. platform은 route 이름(`files.delete`)으로 묻지만 결정 이름은
// 점을 가질 수 없어(decisionNameSchema) 발급될 수 없다. 사람 결정은 owner가 등록한 이름이다.
export function routeDecision(name: string): string {
  return name === filesDelete.name ? FILE_DELETE_DECISION : name;
}

// 한 파일 쓰기가 coordinator에 닿기까지와 결과를 기다리는 한도.
const WRITE_TIMEOUT_MS = 35_000;
const READ_TIMEOUT_MS = 15_000;
const WATCH_TIMEOUT_MS = 20_000;
const PREVIEW_TIMEOUT_MS = 70_000;
// validate의 channel(1부터)과 겹치지 않는 영역에서 센다.
const CHANNEL_BASE = 0x80000000;

function workerCode(code: string): ErrorCode {
  return (ERROR_CODES as readonly string[]).includes(code)
    ? code as ErrorCode
    : "internal";
}

function failed(
  request: WorkerRequest,
  code: ErrorCode,
  message: string,
): Result<WorkerResponse> {
  return ok({
    type: "worker_response",
    request_id: request.request_id,
    ok: false,
    error: { code, message },
  });
}

function answered(
  request: WorkerRequest,
  payload: unknown,
): Result<WorkerResponse> {
  return ok({
    type: "worker_response",
    request_id: request.request_id,
    ok: true,
    payload,
  });
}

// 범위 밖·없는 대상·허용하지 않는 종류는 같은 답이다(존재를 새지 않는다).
function notAvailable(request: WorkerRequest): Result<WorkerResponse> {
  return failed(request, "invalid_input", "target is not available");
}

export function fileWorkers(
  deps: FilesRouteDeps,
): Map<string, WorkerRouteTarget> {
  const key = (route: { resource: string; method: string }) =>
    `${route.resource}/${route.method}`;
  const handle = (
    component: string,
    forward: (request: WorkerRequest) => Promise<Result<WorkerResponse>>,
  ) => ({
    handle: {
      observation: () => ({
        component,
        available: deps.bound(),
        ...(deps.bound()
          ? {}
          : { reason: "documents worker가 준비되지 않았다" }),
        observed_at: deps.observedAt(),
      }),
      forward,
    },
  });

  // coordinator의 답을 그대로 이 요청의 답으로 옮긴다. 오류는 code만 믿는다.
  function relay(
    request: WorkerRequest,
    reply: Result<unknown>,
    shape: (payload: unknown) => unknown = (payload) => payload,
  ): Result<WorkerResponse> {
    if (!reply.ok) {
      return failed(request, workerCode(reply.error.code), "failed");
    }
    return answered(request, shape(reply.value));
  }

  // working copy 목표는 core가 ledger에서 본 원본 없는 활성 문서에만 닿는다.
  async function copyAllowed(
    request: WorkerRequest,
    target: FileTarget,
  ): Promise<Result<WorkingCopyCheck | undefined>> {
    if (target.kind === "project_file") return ok(undefined);
    if (target.kind !== "working_copy") {
      return err({ code: "invalid_input", message: "target is not available" });
    }
    const checked = await deps.copyCheck(request, target.document, null);
    if (!checked.ok) return checked;
    return checked.value.eligible
      ? ok(checked.value)
      : err({ code: "invalid_input", message: "target is not available" });
  }

  // 한 번에 하나만 보낸다. coordinator 우편함이 channel 수를 제한하므로 앞 쓰기의 바이트가
  // 뒤 쓰기와 겹쳐 밀려나지 않게 한다.
  let tail: Promise<unknown> = Promise.resolve();
  let counter = 0;
  const serialized = <T>(work: () => Promise<T>): Promise<T> => {
    const next = tail.then(work, work);
    tail = next.catch(() => undefined);
    return next;
  };

  async function sendContent(blob: PreparedBlob): Promise<Result<number>> {
    counter = (counter + 1) % 0x7fffffff;
    const channel = CHANNEL_BASE + counter;
    let offset = 0;
    while (offset < blob.size_bytes) {
      const read = await deps.readBlob(
        blob.hash,
        offset,
        Math.min(BLOB_READ_MAX_BYTES, blob.size_bytes - offset),
      );
      if (
        !read.ok || read.value.bytes.length === 0 ||
        read.value.hash !== blob.hash
      ) {
        return err({
          code: "unavailable",
          message: "file content not readable",
        });
      }
      if (!await deps.sendBytes(channel, read.value.bytes)) {
        return err({
          code: "unavailable",
          message: "file content was not delivered",
        });
      }
      offset += read.value.bytes.length;
    }
    return ok(channel);
  }

  async function forwardWrite(
    request: WorkerRequest,
  ): Promise<Result<WorkerResponse>> {
    const parsed = filesWrite.input.safeParse(request.payload);
    if (!parsed.success) {
      return failed(request, "invalid_input", "invalid input");
    }
    const input = parsed.data;
    const principal = deps.principalOf(request);
    if (principal === undefined) {
      return failed(request, "unauthorized", "credential이 없다");
    }
    // 요청 주체가 upload로 준비해 아직 살아 있는 원문만 쓴다. 없거나 남의 것이면 없는 것과
    // 같은 답이다(hash는 읽기 권한이 아니다).
    const content = input.content;
    if (
      content.kind !== "prepared" || content.blob.principal !== principal ||
      content.blob.purpose !== "document_file" ||
      !deps.live({
        principal,
        purpose: content.blob.purpose,
        hash: content.blob.hash,
      })
    ) return notAvailable(request);
    const blob = content.blob;
    let copy: WorkingCopyBasis | undefined;
    if (input.target.kind === "working_copy") {
      const version = input.version_request;
      // 사본 쓰기는 연 판을 가리켜야 한다. 새 최신 판과의 충돌은 판을 확정할 때 가린다.
      const checked = await deps.copyCheck(
        request,
        input.target.document,
        version?.base_version ?? null,
      );
      if (!checked.ok) {
        return failed(request, workerCode(checked.error.code), "failed");
      }
      if (
        !checked.value.eligible || checked.value.base === null ||
        (version !== undefined &&
          (version.document !== input.target.document ||
            version.base_version === null))
      ) return notAvailable(request);
      copy = {
        base_version: checked.value.base.version,
        primary_path: checked.value.base.primary_path,
        media_type: checked.value.base.media_type,
        confirmed_hash: checked.value.base.confirmed_hash,
      };
    }
    return await serialized(async () => {
      const channel = await sendContent(blob);
      if (!channel.ok) {
        return failed(request, workerCode(channel.error.code), "failed");
      }
      const done = await deps.request(
        DOCUMENT_OPS.fileWrite,
        {
          request: input,
          content: {
            channel: channel.value,
            bytes: blob.size_bytes,
            hash: blob.hash,
          },
          ...(copy === undefined ? {} : { working_copy: copy }),
        },
        WRITE_TIMEOUT_MS,
      );
      if (!done.ok) {
        return failed(request, workerCode(done.error.code), "failed");
      }
      const result = fileOperationResultSchema.safeParse(done.value);
      if (!result.success) {
        return failed(request, "unavailable", "file result is invalid");
      }
      if (
        input.target.kind !== "working_copy" ||
        input.version_request === undefined ||
        result.data.outcome !== "written"
      ) return answered(request, result.data);
      return answered(
        request,
        await confirmVersion(
          request,
          input.target.document,
          input.version_request,
          blob,
          result.data,
        ),
      );
    });
  }

  // 사본 쓰기가 성공한 뒤 판 확정을 따로 시도한다. 판 확정의 실패는 파일 저장 실패가 아니다.
  async function confirmVersion(
    request: WorkerRequest,
    document: string,
    version: { base_version: string | null; idempotency_key: string },
    blob: PreparedBlob,
    written: FileOperationResult,
  ): Promise<FileOperationResult> {
    const base = version.base_version;
    const checked = await deps.copyCheck(request, document, base);
    if (!checked.ok || checked.value.base === null || base === null) {
      return { ...written, version_result: "preparing" };
    }
    const primary = checked.value.base;
    const prepared = await deps.version.prepare(request, {
      document,
      base_version: base,
      files: [{
        path: primary.primary_path,
        blob_hash: blob.hash,
        bytes: blob.size_bytes,
        media_type: primary.media_type,
        primary: true,
        content: { kind: "prepared", blob },
      }],
      source: null,
      idempotency_key: version.idempotency_key,
    });
    const rejected = (code: ErrorCode): FileOperationResult["version_result"] =>
      code === "invalid_input"
        ? "validation_failed"
        : code === "conflict"
        ? "conflict"
        : "preparing";
    if (!prepared.ok) {
      return { ...written, version_result: rejected(prepared.error.code) };
    }
    if (!prepared.value.ok) {
      return {
        ...written,
        version_result: rejected(prepared.value.error.code),
      };
    }
    const preparedVersion = prepared.value.payload as {
      preparation_ref: string;
      files: readonly { preparation_ref: string }[];
    };
    const saved = await deps.version.save(request, {
      command: "document.save",
      input: preparedVersion,
      idempotency_key: version.idempotency_key,
      compare: { base_version: base },
      prepared: [
        preparedVersion.preparation_ref,
        ...preparedVersion.files.map((file) => file.preparation_ref),
      ],
    });
    if (!saved.ok) {
      return { ...written, version_result: rejected(saved.error.code) };
    }
    const result = saveResultSchema.safeParse(
      (saved.value as { result?: unknown }).result,
    );
    if (!result.success) return { ...written, version_result: "preparing" };
    const save: SaveResult = result.data;
    // 사본의 연 판과 확정 내용을 새로 쓴다. 못 해도 판은 이미 확정이다.
    await deps.request(DOCUMENT_OPS.workingCopyConfirm, {
      document,
      base_version: save.version,
      confirmed_hash: blob.hash,
    }, READ_TIMEOUT_MS);
    return { ...written, version_result: "confirmed", save_result: save };
  }

  async function forwardRead(
    request: WorkerRequest,
  ): Promise<Result<WorkerResponse>> {
    const parsed = filesRead.input.safeParse(request.payload);
    if (!parsed.success) {
      return failed(request, "invalid_input", "invalid input");
    }
    const allowed = await copyAllowed(request, parsed.data.target);
    if (!allowed.ok) {
      return failed(request, workerCode(allowed.error.code), "failed");
    }
    const reply = await deps.request(
      DOCUMENT_OPS.fileRead,
      { target: parsed.data.target },
      READ_TIMEOUT_MS,
    );
    // 파일 route의 성공 payload는 원본 bytes다.
    return relay(request, reply, (payload) => ({
      bytes: Array.from(
        fromBase64((payload as { bytes_b64: string }).bytes_b64),
      ),
    }));
  }

  async function forwardWatch(
    request: WorkerRequest,
  ): Promise<Result<WorkerResponse>> {
    const parsed = filesWatch.input.safeParse(request.payload);
    if (!parsed.success) {
      return failed(request, "invalid_input", "invalid input");
    }
    const allowed = await copyAllowed(request, parsed.data.target);
    if (!allowed.ok) {
      return failed(request, workerCode(allowed.error.code), "failed");
    }
    const reply = await deps.request(
      DOCUMENT_OPS.fileWatch,
      parsed.data,
      WATCH_TIMEOUT_MS,
    );
    return relay(request, reply, (payload) => ({
      ...(payload as { status: unknown; next_cursor: string | null }),
      as_of_seq: "0",
    }));
  }

  function passthrough(
    route: { input: { safeParse(value: unknown): { success: boolean } } },
    op: string,
    timeoutMs: number,
    body: (input: unknown) => unknown,
  ) {
    return async (request: WorkerRequest): Promise<Result<WorkerResponse>> => {
      const parsed = route.input.safeParse(request.payload);
      if (!parsed.success) {
        return failed(request, "invalid_input", "invalid input");
      }
      return relay(
        request,
        await deps.request(op, body(request.payload), timeoutMs),
      );
    };
  }

  return new Map([
    [key(filesWrite), handle("documents/files-write", forwardWrite)],
    [key(filesRead), handle("documents/files-read", forwardRead)],
    [key(filesWatch), handle("documents/files-watch", forwardWatch)],
    [
      key(filesRename),
      handle(
        "documents/files-rename",
        passthrough(
          filesRename,
          DOCUMENT_OPS.fileRename,
          WRITE_TIMEOUT_MS,
          (input) => ({ request: input }),
        ),
      ),
    ],
    [
      key(filesDelete),
      handle(
        "documents/files-delete",
        passthrough(
          filesDelete,
          DOCUMENT_OPS.fileDelete,
          WRITE_TIMEOUT_MS,
          (input) => ({ request: input }),
        ),
      ),
    ],
    [
      key(projectPreviewTracking),
      handle(
        "documents/preview-tracking",
        passthrough(
          projectPreviewTracking,
          projectPreviewTracking.name,
          PREVIEW_TIMEOUT_MS,
          (input) => input,
        ),
      ),
    ],
  ]);
}
