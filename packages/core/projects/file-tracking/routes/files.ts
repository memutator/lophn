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
} from "../../../../base/mod.ts";
import {
  FILE_DELETE_DECISION,
  type FileOperationResult,
  fileOperationResultSchema,
  filesDelete,
  filesRename,
  filesWatch,
  filesWrite,
  type FileTarget,
  type FileWriteRequest,
  projectPreviewTracking,
  type SaveResult,
  saveResultSchema,
} from "../../../../protocol/projects/mod.ts";
import { BLOB_READ_MAX_BYTES } from "../../../../protocol/storage/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../../../protocol/supervision/mod.ts";
import type { WorkerRouteTarget } from "../../../supervision/responsiveness/mod.ts";
import {
  DOCUMENT_OPS,
  placeDocumentFile,
  removeDocumentFile,
  type WorkingCopyCheck,
} from "../mod.ts";
import type { PlacementRead, PlacementReadInput } from "../placement-read.ts";
import type { CommandEnvelope } from "../../../storage/ledger/mod.ts";
import { createPlacementDeps } from "./placement.ts";
import type { WorkingCopyBasis } from "../file-ipc.ts";
import { existingFileSource } from "../../versions/mod.ts";

type FileWriteRequestContent = FileWriteRequest["content"];

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
  // `existing` 원본 참조(옛 판의 파일)가 가리키는 저장 바이트. 요청 credential로 그 판의 행과
  // `document.file` 접근을 reader Worker의 snapshot에서 본다(저장의 existing 검사와 같다).
  // 없는 판·없는 경로·접근 밖은 같은 undefined다(존재를 새지 않는다).
  stored(
    request: WorkerRequest,
    source: { version: string; path: string },
  ): Promise<Result<{ hash: string; bytes: number } | undefined>>;
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
  // 두기·빼기의 연결 확정. 읽기와 command는 요청 credential의 현재 자격이고, reserve는 쓰기 전부터
  // 원본 연결까지 경로를 잡는다(그 사이 같은 경로의 파일 관측 첫 저장은 conflict다).
  placement: {
    read(
      request: WorkerRequest,
      input: PlacementReadInput,
    ): Promise<Result<PlacementRead>>;
    command(
      request: WorkerRequest,
      envelope: CommandEnvelope,
    ): Promise<Result<unknown>>;
    reserve(path: string): () => void;
  };
  observedAt(): string;
};

// route confirmation의 결정 이름. platform은 route 이름(`files.delete`)으로 묻지만 결정 이름은
// 점을 가질 수 없어(decisionNameSchema) 발급될 수 없다. 사람 결정은 owner가 등록한 이름이다.
export function routeDecision(name: string): string {
  return name === filesDelete.name ? FILE_DELETE_DECISION : name;
}

// 쓸 원문. hash·크기는 신뢰한 값(준비 참조의 blob 또는 판 파일 행)이고 content는 판 확정이
// 같은 원문을 `document.prepare`에 그대로 넘기는 출처다.
type ContentSource = {
  hash: string;
  size_bytes: number;
  content: FileWriteRequestContent;
};

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
    // 지침 파일은 coordinator가 exact 등록과 맞춰 본다(file-tracking#R19).
    if (target.kind === "project_file" || target.kind === "instruction_file") {
      return ok(undefined);
    }
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

  async function sendContent(
    blob: { hash: string; size_bytes: number },
  ): Promise<Result<number>> {
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
    // 쓸 원문은 둘 중 하나다. 요청 주체가 upload로 준비해 아직 살아 있는 것, 또는 이 자격이
    // 읽을 수 있는 옛 판 파일의 원본 참조(`existing`, 옛 판 복원)다. 준비 참조가 없거나
    // 남의 것이고 원본 참조가 위조거나 접근 밖이면 없는 것과 같은 답이다(hash는 읽기 권한이
    // 아니다).
    const content = input.content;
    let source: ContentSource;
    if (content.kind === "prepared") {
      if (
        content.blob.principal !== principal ||
        content.blob.purpose !== "document_file" ||
        !deps.live({
          principal,
          purpose: content.blob.purpose,
          hash: content.blob.hash,
        })
      ) return notAvailable(request);
      source = {
        hash: content.blob.hash,
        size_bytes: content.blob.size_bytes,
        content,
      };
    } else {
      const located = existingFileSource(content.reference);
      if (located === undefined) return notAvailable(request);
      const stored = await deps.stored(request, located);
      if (!stored.ok) {
        return failed(request, workerCode(stored.error.code), "failed");
      }
      if (
        stored.value === undefined ||
        stored.value.hash !== content.reference.hash
      ) return notAvailable(request);
      source = {
        hash: stored.value.hash,
        size_bytes: stored.value.bytes,
        content,
      };
    }
    const blob = source;
    // instruction_file 목표는 coordinator가 exact 등록과 맞춰 본다. 등록에 없는 경로·층은 같은
    // not available이다(file-tracking#R19, R20).
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
    if (input.place !== undefined) {
      return await placeThrough(request, input, source);
    }
    const written = await writeThrough(input, blob, copy);
    if (!written.ok) {
      return failed(request, workerCode(written.error.code), "failed");
    }
    if (
      input.target.kind !== "working_copy" ||
      input.version_request === undefined ||
      written.value.outcome !== "written"
    ) return answered(request, written.value);
    return answered(
      request,
      await confirmVersion(
        request,
        input.target.document,
        input.version_request,
        source,
        written.value,
      ),
    );
  }

  // 바이트를 coordinator에 보내고 쓰기 요청을 보낸다. 한 번에 하나만 보낸다.
  function writeThrough(
    input: FileWriteRequest,
    blob: ContentSource,
    copy: WorkingCopyBasis | undefined,
  ): Promise<Result<FileOperationResult>> {
    return serialized(async () => {
      const channel = await sendContent(blob);
      if (!channel.ok) return channel;
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
      if (!done.ok) return done;
      const result = fileOperationResultSchema.safeParse(done.value);
      return result.success
        ? ok(result.data)
        : err({ code: "unavailable", message: "file result is invalid" });
    });
  }

  // 문서를 새 파일에 둔다. 판의 최신·참조·유일한 파일을 확인한 뒤 순서는 placement.ts가 한다.
  async function placeThrough(
    request: WorkerRequest,
    input: FileWriteRequest,
    source: ContentSource,
  ): Promise<Result<WorkerResponse>> {
    const place = input.place!;
    const target = input.target;
    if (target.kind !== "project_file" || input.content.kind !== "existing") {
      return notAvailable(request);
    }
    const located = existingFileSource(input.content.reference);
    if (located === undefined || located.version !== place.version) {
      return notAvailable(request);
    }
    const seen = await deps.placement.read(request, {
      document: place.document,
      operation: filesWrite.name,
    });
    if (!seen.ok) return failed(request, workerCode(seen.error.code), "failed");
    // 범위 밖·없는 문서는 같은 답이다. 참조가 그 판의 유일한 파일이 아니면 위조와 같다.
    const latest = seen.value.latest;
    if (seen.value.document === null || latest === null) {
      return notAvailable(request);
    }
    if (latest.version !== place.version) {
      return failed(request, "conflict", "latest version changed");
    }
    const only = latest.files.length === 1 ? latest.files[0]! : undefined;
    if (
      only === undefined || only.path !== located.path ||
      only.blob_hash !== source.hash
    ) {
      return notAvailable(request);
    }
    const built = createPlacementDeps({
      read: (read) => deps.placement.read(request, read),
      command: (envelope) => deps.placement.command(request, envelope),
      preview: (payload) =>
        deps.request(projectPreviewTracking.name, payload, PREVIEW_TIMEOUT_MS),
      write: () => writeThrough(input, source, undefined),
      remove: () => Promise.resolve(notRemoving()),
      exists: () => fileExists(target),
      reserve: (path) => deps.placement.reserve(path),
    }, {
      requestKey: input.request_key,
      document: place.document,
      operation: filesWrite.name,
      path: target.path,
    });
    const placed = await placeDocumentFile(built.deps, {
      actor: "user",
      requestKey: input.request_key,
      document: place.document,
      project: target.project,
      path: target.path,
    });
    if (!placed.ok) {
      return failed(
        request,
        workerCode(placed.error.code),
        placed.error.message,
      );
    }
    const written = built.written();
    if (written === undefined) {
      return failed(request, "unavailable", "file result is missing");
    }
    return answered(request, {
      ...written,
      placement: {
        source: placed.value.source,
        tracking: placed.value.tracking,
        move: placed.value.move,
      },
    });
  }

  function notRemoving(): Result<FileOperationResult> {
    return err({ code: "internal", message: "not a delete" });
  }

  // 목표 파일의 있고 없음. 범위 밖 목표는 coordinator가 같은 invalid_input으로 답한다.
  async function fileExists(target: FileTarget): Promise<Result<boolean>> {
    const header = await deps.request(
      DOCUMENT_OPS.fileRead,
      { target },
      READ_TIMEOUT_MS,
    );
    // coordinator는 있는 파일의 헤더를 돌려주고 없는 파일은 not_found로 답한다. 범위 밖 목표는
    // 같은 invalid_input이다(없는 것과 구별하지 않는다).
    if (header.ok) return ok(true);
    return header.error.code === "not_found" ? ok(false) : header;
  }

  // 파일을 지우고 문서의 연결을 푼다. 확인 handle은 platform이 이미 소비했다.
  async function forwardDelete(
    request: WorkerRequest,
  ): Promise<Result<WorkerResponse>> {
    const parsed = filesDelete.input.safeParse(request.payload);
    if (!parsed.success) {
      return failed(request, "invalid_input", "invalid input");
    }
    const input = parsed.data;
    const target = input.target;
    if (input.unlink === undefined) {
      return relay(
        request,
        await deps.request(
          DOCUMENT_OPS.fileDelete,
          { request: input },
          WRITE_TIMEOUT_MS,
        ),
      );
    }
    if (target.kind !== "project_file") return notAvailable(request);
    const built = createPlacementDeps({
      read: (read) => deps.placement.read(request, read),
      command: (envelope) => deps.placement.command(request, envelope),
      preview: () => Promise.resolve(notRemoving()),
      write: () => Promise.resolve(notRemoving()),
      remove: async () => {
        const done = await deps.request(
          DOCUMENT_OPS.fileDelete,
          { request: input },
          WRITE_TIMEOUT_MS,
        );
        if (!done.ok) return done;
        const result = fileOperationResultSchema.safeParse(done.value);
        return result.success
          ? ok(result.data)
          : err({ code: "unavailable", message: "file result is invalid" });
      },
      exists: () => fileExists(target),
      reserve: () => () => {},
    }, {
      requestKey: input.request_key,
      document: input.unlink.document,
      operation: filesDelete.name,
      path: target.path,
    });
    const removed = await removeDocumentFile(built.deps, {
      actor: "user",
      requestKey: input.request_key,
      document: input.unlink.document,
      baseHash: input.base_hash,
      target: { project: target.project, path: target.path },
    });
    if (!removed.ok) {
      return failed(
        request,
        workerCode(removed.error.code),
        removed.error.message,
      );
    }
    // 파일이 이미 없었으면 지운 작업이 없다: 결과 불명이 아니라 지울 것이 없던 것이고 기록도 없다.
    const base = built.removed() ?? {
      request_key: input.request_key,
      operation: "delete" as const,
      target,
      outcome: "unverified" as const,
      before_path: target.path,
      after_path: null,
      before_hash: null,
      written_hash: null,
      observed_hash: null,
      observed_at: null,
      changed_again: null,
      recording: "unverified" as const,
      event_seq: null,
      version_result: "not_requested" as const,
    };
    return answered(request, {
      ...base,
      unlinking: {
        source: removed.value.source,
        move: removed.value.move,
      },
    });
  }

  // 충돌이면 새 기준(그 문서의 지금 최신 판)을 결과에 싣는다. 읽지 못하면 싣지 않는다:
  // 충돌은 그대로이고 사람은 `document.get`으로 최신 판을 읽는다(Q26).
  async function withLatest(
    request: WorkerRequest,
    document: string,
    result: FileOperationResult,
  ): Promise<FileOperationResult> {
    if (result.version_result !== "conflict") return result;
    const latest = await deps.copyCheck(request, document, null);
    return latest.ok && latest.value.latest_version !== null
      ? { ...result, latest_version: latest.value.latest_version }
      : result;
  }

  // 사본 쓰기가 성공한 뒤 판 확정을 따로 시도한다. 판 확정의 실패는 파일 저장 실패가 아니다.
  async function confirmVersion(
    request: WorkerRequest,
    document: string,
    version: { base_version: string | null; idempotency_key: string },
    blob: ContentSource,
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
        content: blob.content,
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
      return await withLatest(
        request,
        document,
        { ...written, version_result: rejected(prepared.error.code) },
      );
    }
    if (!prepared.value.ok) {
      return await withLatest(
        request,
        document,
        { ...written, version_result: rejected(prepared.value.error.code) },
      );
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
      return await withLatest(
        request,
        document,
        { ...written, version_result: rejected(saved.error.code) },
      );
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
    [key(filesDelete), handle("documents/files-delete", forwardDelete)],
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
