import { err, type LophnError, type Result } from "../../../base/mod.ts";
import type { HealthObservation } from "../../../protocol/server/mod.ts";
import type {
  WorkerRequest,
  WorkerResponse,
} from "../../../protocol/supervision/mod.ts";
import { valueWithin } from "./deadline.ts";

// route 등록값: timeout·응답 상한은 route마다 등록값이다(plan platform#T12).
export type WorkerRouteLimits = {
  timeoutMs?: number;
  responseMaxBytes?: number;
  // 요청이 바이트 body를 함께 보낼 수 있는 route의 상한. 없으면 이 route는 JSON body만 받는다.
  requestBytesMax?: number;
};

export type WorkerRouteHandle = {
  observation(): HealthObservation;
  // bytes는 요청의 바이트 body다. core는 해석하지 않고 worker로 중계만 한다.
  forward(
    request: WorkerRequest,
    bytes?: Uint8Array,
  ): Promise<Result<WorkerResponse, LophnError>>;
};

export type WorkerRouteTarget = {
  handle: WorkerRouteHandle;
  limits?: WorkerRouteLimits;
};

// 등록된 kind의 준비 여부를 먼저 보고, 준비했으면 감독 pipe로 넘긴다.
// worker가 없거나 ready가 아니면 unavailable이다. 기한·상한은 route 등록값이다.
export async function forwardToWorker(
  target: WorkerRouteTarget,
  request: WorkerRequest,
  bytes?: Uint8Array,
): Promise<Result<WorkerResponse, LophnError>> {
  const observed = target.handle.observation();
  if (!observed.available) {
    return err({
      code: "unavailable",
      message: `worker not ready: ${observed.reason ?? "not ready"}`,
    });
  }
  const timeoutMs = target.limits?.timeoutMs;
  const timeout: Result<WorkerResponse, LophnError> = err({
    code: "unavailable",
    message: "worker response timed out",
  });
  const answer = timeoutMs === undefined
    ? await target.handle.forward(request, bytes)
    : await valueWithin(
      () => target.handle.forward(request, bytes),
      timeoutMs,
      timeout,
    );
  if (!answer.ok) return answer;
  const responseMaxBytes = target.limits?.responseMaxBytes;
  if (
    responseMaxBytes !== undefined && wireBytes(answer.value) > responseMaxBytes
  ) {
    return err({
      code: "unavailable",
      message: "worker response exceeds limit",
    });
  }
  return answer;
}

// worker 응답 envelope의 wire 크기(frame payload 기준)를 잰다. core는 bytes를 해석하지 않는다.
function wireBytes(response: WorkerResponse): number {
  return JSON.stringify(response).length;
}
