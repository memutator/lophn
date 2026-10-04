import type { Clock, Logger } from "../../base/mod.ts";
import {
  DEFAULT_API_PORT,
  EVENT_SUBSCRIBE_PATH,
  RPC_JSON_MAX_BYTES,
} from "../../contracts/platform/mod.ts";
import type { CredentialRegistry } from "../identity/mod.ts";
import type { EventBackend, SubscriptionStore } from "../ledger/mod.ts";
import type { Writer } from "../ledger/mod.ts";
import {
  type DispatchDeps,
  dispatchHttp,
  type FileHandler,
  type MemoryHandler,
  type ReadHandler,
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
  events?: EventBackend;
  subscriptions?: SubscriptionStore;
  bodyLimit?: DispatchDeps["bodyLimit"];
  // 무인증 실패·Origin 거부의 제한된 안전 log. ledger event는 만들지 않는다.
  logger?: Logger;
  registry?: RouteRegistry;
};

export type ApiServer = {
  port: number;
  stop(): Promise<void>;
};

const LOOPBACK = ["127.0.0.1", "::1"] as const;

export function startApiServer(options: ApiServerOptions): Promise<ApiServer> {
  const requested = options.port ?? DEFAULT_API_PORT;
  const registry = options.registry ?? new RouteRegistry();
  const deps: DispatchDeps = {
    credentials: options.credentials,
    clock: options.clock,
    writer: options.writer,
    reads: options.reads,
    memory: options.memory,
    files: options.files,
    bodyLimit: options.bodyLimit,
    bodyTimeoutMs: BODY_TIMEOUT_MS,
    jsonMaxBytes: RPC_JSON_MAX_BYTES,
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
        const accepted = acceptSocket(request);
        if (!accepted.ok) {
          return Response.json(accepted.body, { status: accepted.status });
        }
        attachSession(accepted.socket, decision.context, {
          backend: options.events,
          store: options.subscriptions,
        });
        return accepted.response;
      }
      const entry = registry.lookup(url.pathname);
      if (!entry) {
        return json(failure({
          code: "not_found",
          message: "route not found",
        }));
      }
      const result = await dispatchHttp(request, entry, decision.context, deps);
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
    }
  });
}

function json(reason: ReturnType<typeof failure>): Response {
  return Response.json(errorBody(reason.error), { status: reason.status });
}

export { EVENT_SUBSCRIBE_PATH };
