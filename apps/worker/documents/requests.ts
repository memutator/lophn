// core가 감독 pipe로 보내는 worker_request의 처리. codec은 contracts#T6 supervision
// 하나고, op 이름은 file-tracking이 정한다. 모르는 op는 invalid_input이다.
import { fileTargetSchema } from "../../../packages/contracts/documents/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../../packages/contracts/platform/mod.ts";
import {
  DOCUMENT_OPS,
  type StatusRecorder,
} from "../../../packages/documents/file-tracking/mod.ts";

export type RequestDeps = {
  status: StatusRecorder;
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
    return Promise.resolve(failure(request, "invalid_input", "unknown op"));
  };
}
