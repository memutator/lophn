// 제품 core가 문서 route를 서빙하는 조립(documents#T11). 두 길이다.
// - 감독 pipe: documents coordinator에게 worker_request를 보내 답을 받는다(FileStatus).
//   pipe contract는 늘리지 않는다: 기존 worker_request·worker_response envelope다.
// - reader pool: outline·읽기·search·view open·export는 reader Worker의 snapshot으로
//   요청 credential의 현재 context를 다시 읽어 실행한다(documents-reader.ts).
import {
  err,
  ERROR_CODES,
  type ErrorCode,
  ok,
  type Result,
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
import { internalRoute, SERVED_ROUTES, servedKey } from "./documents-served.ts";

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
