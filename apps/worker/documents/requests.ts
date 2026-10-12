// core가 감독 pipe로 보내는 worker_request의 처리. codec은 contracts#T6 supervision
// 하나고, op 이름은 file-tracking이 정한다. 모르는 op는 invalid_input이다.
import {
  fileTargetSchema,
  projectPreviewTracking,
} from "../../../packages/protocol/projects/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../../packages/protocol/platform/mod.ts";
import {
  DOCUMENT_OPS,
  parseObservationChunk,
  parseValidateFilesRequest,
  type StatusRecorder,
  type ValidateFilesRequest,
} from "../../../packages/documents/file-tracking/mod.ts";
import { ok, type Result } from "../../../packages/base/mod.ts";
import type { LophnError } from "../../../packages/base/mod.ts";
import type { BasisStore } from "./basis.ts";
import type { FileHandlers } from "./files.ts";

export type RequestDeps = {
  status: StatusRecorder;
  // 사람 파일 작업(core가 user 자격을 확인하고 넘긴다). 없으면 그 op는 unavailable이다.
  files?: FileHandlers;
  // `project.preview_tracking`. 등록 전 폴더를 읽으려 한 번만 쓰는 준비 worker로 간다.
  preview?(payload: unknown): Promise<Result<unknown, LophnError>>;
  // core가 보낸 관측 근거 조각을 받는다(Q15).
  basis: Pick<BasisStore, "apply">;
  // 준비 route의 format 검사. core가 보낸 바이트로 format runner를 부른다.
  validate(request: ValidateFilesRequest): Promise<Result<unknown, LophnError>>;
  // search consumer 요청(`documents.search_*`)의 처리. search op가 아니면 undefined다.
  search?(request: WorkerRequest): Promise<WorkerResponse> | undefined;
};

function failure(
  request: WorkerRequest,
  code: LophnError["code"],
  message: string,
): WorkerResponse {
  return {
    type: "worker_response",
    request_id: request.request_id,
    ok: false,
    error: { code, message },
  };
}

export function createRequestHandler(
  deps: RequestDeps,
): (request: WorkerRequest) => Promise<WorkerResponse> {
  return (request) => {
    if (request.op === DOCUMENT_OPS.fileStatus) {
      const target = fileTargetSchema.safeParse(request.payload);
      if (!target.success) {
        return Promise.resolve(
          failure(request, "invalid_input", "invalid file target"),
        );
      }
      // 관측이 없으면 observation은 null이다: 추적 안 함 판정은 조회 쪽 규칙이다.
      const observed = deps.files
        ? deps.files.observation(target.data)
        : Promise.resolve(ok(deps.status.get(target.data)));
      return observed.then((result): WorkerResponse =>
        result.ok
          ? {
            type: "worker_response",
            request_id: request.request_id,
            ok: true,
            payload: { observation: result.value ?? null },
          }
          : answerError(request, result.error)
      );
    }
    if (request.op === DOCUMENT_OPS.observationBasis) {
      const chunk = parseObservationChunk(request.payload);
      if (!chunk.ok) {
        return Promise.resolve(
          failure(request, "invalid_input", "invalid observation basis"),
        );
      }
      const applied = deps.basis.apply(chunk.value);
      if (!applied.ok) {
        return Promise.resolve(
          failure(request, "invalid_input", "observation basis chunk rejected"),
        );
      }
      return Promise.resolve({
        type: "worker_response",
        request_id: request.request_id,
        ok: true,
        payload: { committed: applied.value.committed },
      });
    }
    if (request.op === DOCUMENT_OPS.validateFiles) {
      const parsed = parseValidateFilesRequest(request.payload);
      if (parsed === undefined) {
        return Promise.resolve(
          failure(request, "invalid_input", "invalid validation request"),
        );
      }
      return deps.validate(parsed).then((result): WorkerResponse =>
        result.ok
          ? {
            type: "worker_response",
            request_id: request.request_id,
            ok: true,
            payload: result.value,
          }
          : {
            type: "worker_response",
            request_id: request.request_id,
            ok: false,
            error: {
              code: result.error.code === "not_found" ||
                  result.error.code === "invalid_input"
                ? result.error.code
                : "unavailable",
              message: "format validation failed",
            },
          }
      );
    }
    const served = deps.search?.(request);
    if (served !== undefined) return served;
    const files = deps.files;
    const filed = files === undefined ? undefined : fileOpOf(request.op, files);
    if (filed !== undefined) {
      return filed(request.payload).then((result) =>
        answerResult(request, result)
      );
    }
    if (request.op === projectPreviewTracking.name && deps.preview) {
      return deps.preview(request.payload).then((result) =>
        answerResult(request, result)
      );
    }
    return Promise.resolve(failure(request, "invalid_input", "unknown op"));
  };
}

function fileOpOf(
  op: string,
  files: FileHandlers,
): ((payload: unknown) => Promise<Result<unknown, LophnError>>) | undefined {
  switch (op) {
    case DOCUMENT_OPS.fileRead:
      return files.read;
    case DOCUMENT_OPS.fileWindow:
      return files.window;
    case DOCUMENT_OPS.fileWrite:
      return files.write;
    case DOCUMENT_OPS.fileRename:
      return files.rename;
    case DOCUMENT_OPS.fileDelete:
      return files.delete;
    case DOCUMENT_OPS.fileWatch:
      return files.watch;
    case DOCUMENT_OPS.workingCopyConfirm:
      return files.confirmCopy;
    default:
      return undefined;
  }
}

// 오류 문장은 core가 버리고 code만 쓴다. 경로·본문은 넣지 않는다.
function answerError(
  request: WorkerRequest,
  error: LophnError,
): WorkerResponse {
  return {
    type: "worker_response",
    request_id: request.request_id,
    ok: false,
    error: { code: error.code, message: error.message },
  };
}

function answerResult(
  request: WorkerRequest,
  result: Result<unknown, LophnError>,
): WorkerResponse {
  return result.ok
    ? {
      type: "worker_response",
      request_id: request.request_id,
      ok: true,
      payload: result.value,
    }
    : answerError(request, result.error);
}
