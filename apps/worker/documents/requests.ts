// core가 감독 pipe로 보내는 worker_request의 처리. codec은 contracts#T6 supervision
// 하나고, op 이름은 file-tracking이 정한다. 모르는 op는 invalid_input이다.
import { fileTargetSchema } from "../../../packages/contracts/documents/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../../packages/contracts/platform/mod.ts";
import {
  DOCUMENT_OPS,
  parseObservationChunk,
  parseValidateFilesRequest,
  type StatusRecorder,
  type ValidateFilesRequest,
} from "../../../packages/documents/file-tracking/mod.ts";
import type { Result } from "../../../packages/base/mod.ts";
import type { LophnError } from "../../../packages/base/mod.ts";
import type { BasisStore } from "./basis.ts";

export type RequestDeps = {
  status: StatusRecorder;
  // core가 보낸 관측 근거 조각을 받는다(Q15).
  basis: Pick<BasisStore, "apply">;
  // 준비 route의 format 검사. core가 보낸 바이트로 format runner를 부른다.
  validate(request: ValidateFilesRequest): Promise<Result<unknown, LophnError>>;
};

function failure(
  request: WorkerRequest,
  code: "invalid_input" | "unavailable",
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
      return Promise.resolve({
        type: "worker_response",
        request_id: request.request_id,
        ok: true,
        payload: { observation: deps.status.get(target.data) ?? null },
      });
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
    return Promise.resolve(failure(request, "invalid_input", "unknown op"));
  };
}
