import type { Clock, Logger, LophnError, Result } from "../../base/mod.ts";
import {
  type AuthenticatedContext,
  DEFAULT_API_PORT,
  ERROR_HTTP_STATUS,
  EVENT_SUBSCRIBE_PATH,
  RPC_JSON_MAX_BYTES,
  type WorkerRequest,
  type WorkerResponse,
} from "../../contracts/platform/mod.ts";
import type { CredentialRegistry } from "../identity/mod.ts";
import type { ConfirmationBridge } from "../identity/mod.ts";
import type { EventBackend, SubscriptionStore } from "../ledger/mod.ts";
import type { Writer } from "../ledger/mod.ts";
import { type Admission, createAdmission } from "../responsiveness/mod.ts";
import {
  forwardToWorker,
  type WorkerRouteTarget as ResponsivenessTarget,
} from "../responsiveness/mod.ts";
import {
  type DispatchDeps,
  dispatchHttp,
  type FileHandler,
  type MemoryHandler,
  type ReadHandler,
  type WorkerTargets,
} from "./dispatch.ts";
import {
  BODY_TIMEOUT_MS,
  errorBody,
  failure,
  gateRequest,
  headerBytes,
  MAX_HEADER_BYTES,
} from "./request.ts";
import { isSubscribePath, RouteRegistry } from "./routes.ts";
import { acceptSocket, attachSession } from "./socket.ts";

// T9가 조립한다. core entry·data root·시작 순서는 여기 없다.
export type ApiServerOptions = {
  // 0이면 빈 port. 테스트가 주입한다. 기본은 7431.
  port?: number;
  credentials: CredentialRegistry;
  clock: Clock;
  writer?: Writer;
  reads?: ReadonlyMap<string, ReadHandler>;
  memory?: ReadonlyMap<string, MemoryHandler>;
  files?: ReadonlyMap<string, FileHandler>;
  workers?: ReadonlyMap<string, ResponsivenessTarget>;
  // file·worker route의 사람 결정 확인. 없으면 confirmation route는 unavailable이다.
  confirmation?: ConfirmationBridge;
  events?: EventBackend;
  subscriptions?: SubscriptionStore;
  bodyLimit?: DispatchDeps["bodyLimit"];
  // 무인증 실패·Origin 거부의 제한된 안전 log. ledger event는 만들지 않는��.
  logger?: Logger;
  registry?: RouteRegistry;
  // command·HTTP·event 입장 한도(responsiveness 2.3 표). 없으면 createAdmission()이다.
  admission?: Admission;
};

export type ApiServer = {
  port: number;
  stop(): Promise<void>;
};

const LOOPBACK = ["127.0.0.1", "::1"] as const;

export function startApiServer(options: ApiServerOptions): Promise<ApiServer> {
  const requested = options.port ?? DEFAULT_API_PORT;
  const registry = options.registry ?? new RouteRegistry();
  const admission = options.admission ?? createAdmission();
  const deps: DispatchDeps = {
    credentials: options.credentials,
    clock: options.clock,
    writer: options.writer,
    reads: options.reads,
    memory: options.memory,
    files: options.files,
    workers: options.workers === undefined
      ? undefined
      : adaptedWorkers(options.workers),
    confirmation: options.confirmation,
    bodyLimit: options.bodyLimit,
    bodyTimeoutMs: BODY_TIMEOUT_MS,
    jsonMaxBytes: RPC_JSON_MAX_BYTES,
    // command 입장 대기. 회수·정지 제어 command만 control lane(예약 16)으로 들어가고
    // 나머지는 normal lane이다. 거절은 queue 입장에서 unavailable이다.
    admitCommand: async (ctx, name, work) => {
      const admitted = await admission.admit(
        ctx.principal,
        () => work().then(() => undefined),
        controlCommand(ctx, name) ? "control" : "normal",
      );
      return admitted ? await work() : commandRefused();
    },
  };
  let settled = false;
  return new Promise((resolve, reject) => {
    const handle = (request: Request, port: number): Promise<Response> =>
      onRequest(request, port);
    const server: Deno.HttpServer = Deno.serve({
      port: requested,
      hostname: LOOPBACK[0],
      onListen: ({ port }) => {
        // 원격 bind 설정은 없다. IPv6 loopback은 같은 port에만 붙인다(security R6, R7).
        let v6: Deno.HttpServer | undefined;
        try {
          v6 = Deno.serve({
            port,
            hostname: LOOPBACK[1],
            handler: (request) => onRequest(request, port),
          });
        } catch (thrown) {
          if (!settled) {
            settled = true;
            void server.shutdown().finally(() => reject(thrown));
          }
          return;
        }
        if (settled) return;
        settled = true;
        resolve({
          port,
          stop: async () => {
            await Promise.all([server.shutdown(), v6?.shutdown()]);
          },
        });
      },
      handler: (request) => {
        const addr = server.addr;
        const port = "port" in addr ? addr.port : requested;
        return handle(request, port);
      },
    });

    async function onRequest(
      request: Request,
      port: number,
    ): Promise<Response> {
      try {
        return await respond(request, port);
      } catch {
        // 경계 밖 throw는 stack·원문 없이 internal이다(platform/api#R4).
        return json(failure({ code: "internal", message: "internal error" }));
      }
    }

    async function respond(request: Request, port: number): Promise<Response> {
      if (headerBytes(request) > MAX_HEADER_BYTES) {
        return json(failure({
          code: "invalid_input",
          message: "headers exceed limit",
        }));
      }

      const url = new URL(request.url);
      const origin = request.headers.has("origin")
        ? request.headers.get("origin")
        : null;
      const decision = await gateRequest({
        url: request.url,
        origin,
        authorization: request.headers.get("authorization"),
        port,
      }, options.credentials);
      if (!decision.ok) {
        // 무인증·Origin 거부는 안전 log만. ledger event는 없다(diagnostics R7).
        options.logger?.warn({
          component: "api",
          event: origin !== null ? "origin_rejected" : "auth_rejected",
        });
        return json(decision.failure);
      }
      if (isSubscribePath(url.pathname)) {
        if (!options.events) {
          return json(failure({
            code: "unavailable",
            message: "event subscription unavailable",
          }));
        }
        // event 연결 한도(32·principal당 4)는 upgrade 전에 결정한다. queue 없다.
        const connection = admission.enterEvent(decision.context.principal);
        if (!connection.ok) {
          return json(failure(connection.error));
        }
        const accepted = acceptSocket(request);
        if (!accepted.ok) {
          connection.value.release();
          return Response.json(accepted.body, { status: accepted.status });
        }
        attachSession(accepted.socket, decision.context, {
          backend: options.events,
          store: options.subscriptions,
          onClose: connection.value.release,
        });
        return accepted.response;
      }
      // HTTP 동시 요청 한도(128·principal당 16)는 인증 뒤 같은 시점에 결정한다. queue 없다.
      const arrival = admission.enterHttp(decision.context.principal);
      if (!arrival.ok) {
        return json(failure(arrival.error));
      }
      try {
        const entry = registry.lookup(url.pathname);
        if (!entry) {
          return json(failure({
            code: "not_found",
            message: "route not found",
          }));
        }
        const result = await dispatchHttp(
          request,
          entry,
          decision.context,
          deps,
        );
        if ("bytes" in result) {
          return new Response(
            result.bytes.buffer.slice(
              result.bytes.byteOffset,
              result.bytes.byteOffset + result.bytes.byteLength,
            ) as ArrayBuffer,
            {
              status: result.status,
              headers: { "content-type": result.contentType },
            },
          );
        }
        return Response.json(result.json, { status: result.status });
      } finally {
        arrival.value.release();
      }
    }
  });
}

// 회수·정지 제어만 예약 영역(responsiveness R3)으로 입장시킨다. caller의 priority 주장은
// 입력에 없다. 입장 영역은 route가 등록한 command 이름으로 정한다.
const CONTROL_OPERATIONS = new Set([
  "cancel_approval_request",
  "reject_approval_request",
  "expire_approval_request",
  "removeSecret",
]);

function controlCommand(_ctx: AuthenticatedContext, name: string): boolean {
  return CONTROL_OPERATIONS.has(name);
}

function commandRefused(): { status: number; json: unknown } {
  return {
    status: ERROR_HTTP_STATUS.unavailable,
    json: errorBody({
      code: "unavailable",
      message: "admission 한도를 넘었다",
    }),
  };
}

function json(reason: ReturnType<typeof failure>): Response {
  return Response.json(errorBody(reason.error), { status: reason.status });
}

// 감독 pipe 통로(forwardToWorker)를 dispatch가 기다리는 모양으로 맞춘다.
// 준비 여부·기한·응답 상한은 responsiveness의 forwardToWorker가 본다.
function adaptedWorkers(
  workers: ReadonlyMap<string, ResponsivenessTarget>,
): WorkerTargets {
  const adapted = new Map<string, {
    forward(
      request: WorkerRequest,
    ): Promise<Result<WorkerResponse, LophnError>>;
  }>();
  for (const [name, target] of workers) {
    adapted.set(name, {
      forward: (request) => forwardToWorker(target, request),
    });
  }
  return adapted;
}

export { EVENT_SUBSCRIBE_PATH };
