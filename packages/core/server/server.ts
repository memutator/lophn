import type { Buffer } from "node:buffer";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import type { Clock, Logger } from "../../base/mod.ts";
import type { AuthenticatedContext } from "../../protocol/server/mod.ts";
import { CODING_MCP_PATH } from "../../protocol/coding-agent/mod.ts";
import {
  DEFAULT_API_PORT,
  ERROR_HTTP_STATUS,
  RPC_JSON_MAX_BYTES,
} from "../../protocol/base/mod.ts";
import type { CredentialRegistry } from "./identity/mod.ts";
import type { ConfirmationBridge, RouteConfirmation } from "./identity/mod.ts";
import type { Bus, GatewayFrames } from "../events/mod.ts";
import type { Writer } from "../storage/ledger/mod.ts";
import {
  type Admission,
  createAdmission,
} from "../supervision/responsiveness/mod.ts";
import {
  type DispatchDeps,
  dispatchHttp,
  type FileHandler,
  type FileStreamHandler,
  type MemoryHandler,
  type ReadHandler,
  type UploadHandler,
} from "./dispatch.ts";
import {
  BODY_TIMEOUT_MS,
  errorBody,
  failure,
  gateRequest,
  headerBytes,
  MAX_HEADER_BYTES,
  rawHeaderBytes,
} from "./request.ts";
import type { McpEndpoint } from "./mcp.ts";
import { isSubscribePath, RouteRegistry } from "./routes.ts";
import { type ServeHandle, type ServeUpgradeHandler, serve } from "./serve.ts";
import {
  acceptSocket,
  createGatewayUpgrade,
  gatewayAllowed,
  refuseSocket,
} from "./socket.ts";

// core entry가 조립한다. core entry·data root·시작 순서는 여기 없다.
export type ApiServerOptions = {
  // 0이면 빈 port. 테스트가 주입한다. 기본은 7431.
  port?: number;
  credentials: CredentialRegistry;
  clock: Clock;
  writer?: Writer;
  reads?: ReadonlyMap<string, ReadHandler>;
  memory?: ReadonlyMap<string, MemoryHandler>;
  files?: ReadonlyMap<string, FileHandler>;
  // file route를 stream으로 서빙하는 대상(큰 파일). core 메모리에 한 파일을 모으지 않는다.
  fileStreams?: ReadonlyMap<string, FileStreamHandler>;
  uploads?: ReadonlyMap<string, UploadHandler>;
  // file route의 사람 결정 확인. 없으면 confirmation route는 unavailable이다.
  confirmation?: ConfirmationBridge | RouteConfirmation;
  // Gateway WebSocket이 구독하는 Bus. 없으면 Gateway는 unavailable이다.
  bus?: Bus;
  // Gateway client 하나에 Bus 밖 frame을 보내는 목록. 연결마다 올린다.
  gateway?: GatewayFrames;
  bodyLimit?: DispatchDeps["bodyLimit"];
  // 무인증 실패·Origin 거부의 제한된 안전 log. ledger event는 만들지 않는다.
  logger?: Logger;
  registry?: RouteRegistry;
  // coding agent의 MCP endpoint(`/mcp`). 없으면 unavailable이다.
  mcp?: McpEndpoint;
  // command·HTTP·event 입장 한도(responsiveness 2.3 표). 없으면 createAdmission()이다.
  admission?: Admission;
  // stream 응답에서 소비자가 다음 조각을 당기지 않고 기다리는 최대 시간. 넘으면 응답을 끊고
  // 입장 자리를 돌려준다(멈춘 client가 자리를 붙잡지 못하게). 없으면 60초.
  streamIdleMs?: number;
};

export type ApiServer = {
  port: number;
  stop(): Promise<void>;
};

const LOOPBACK = ["127.0.0.1", "::1"] as const;

export async function startApiServer(
  options: ApiServerOptions,
): Promise<ApiServer> {
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
    fileStreams: options.fileStreams,
    uploads: options.uploads,
    confirmation: options.confirmation,
    bodyLimit: options.bodyLimit,
    bodyTimeoutMs: BODY_TIMEOUT_MS,
    jsonMaxBytes: RPC_JSON_MAX_BYTES,
    // command 입장 대기. 회수·정지 제어 command만 control lane(예약 16)으로 들어가고
    // 나머지는 normal lane이다. 거절은 queue 입장에서 unavailable이다.
    admitCommand: async (ctx, name, work) => {
      // 대기열은 슬롯만 연다. work는 입장한 뒤 한 번만 실행한다.
      const admitted = await admission.admit(
        ctx.principal,
        () => Promise.resolve(),
        controlCommand(ctx, name) ? "control" : "normal",
      );
      return admitted ? await work() : commandRefused();
    },
  };
  // bind 뒤에 실제 port를 채운다. 그 전에는 요청이 오지 않는다.
  let port = requested;

  async function onRequest(request: Request): Promise<Response> {
    try {
      return await respond(request);
    } catch {
      // 경계 밖 throw는 stack·원문 없이 internal이다.
      return json(failure({ code: "internal", message: "internal error" }));
    }
  }

  async function respond(request: Request): Promise<Response> {
    if (headerBytes(request) > MAX_HEADER_BYTES) {
      return json(
        failure({
          code: "invalid_input",
          message: "headers exceed limit",
        }),
      );
    }

    const url = new URL(request.url);
    const origin = request.headers.has("origin")
      ? request.headers.get("origin")
      : null;
    const decision = await gateRequest(
      {
        url: request.url,
        origin,
        authorization: request.headers.get("authorization"),
        port,
      },
      options.credentials,
    );
    if (!decision.ok) {
      // 무인증·Origin 거부는 안전 log만. ledger event는 없다.
      options.logger?.warn({
        component: "api",
        event: origin !== null ? "origin_rejected" : "auth_rejected",
      });
      return json(decision.failure);
    }
    if (isSubscribePath(url.pathname)) {
      // upgrade 요청은 adapter가 fetch handler 대신 upgrade callback으로 넘긴다.
      return json(
        failure({ code: "invalid_input", message: "upgrade required" }),
      );
    }
    // HTTP 동시 요청 한도(128·principal당 16)는 인증 뒤 같은 시점에 결정한다. queue 없다.
    const arrival = admission.enterHttp(decision.context.principal);
    if (!arrival.ok) {
      return json(failure(arrival.error));
    }
    // stream 응답은 본문이 끝날 때까지 입장 자리를 붙잡는다. 아래 finally는 그때 풀지 않는다.
    let streaming = false;
    try {
      if (url.pathname === CODING_MCP_PATH) {
        return options.mcp
          ? await options.mcp.handle(decision.context, request)
          : json(
              failure({
                code: "unavailable",
                message: "mcp unavailable",
              }),
            );
      }
      const entry = registry.lookup(url.pathname);
      if (!entry) {
        return json(
          failure({
            code: "not_found",
            message: "route not found",
          }),
        );
      }
      const result = await dispatchHttp(request, entry, decision.context, deps);
      if ("stream" in result) {
        streaming = true;
        return new Response(
          held(result.stream, options.streamIdleMs ?? STREAM_IDLE_MS, () =>
            arrival.value.release(),
          ),
          {
            status: result.status,
            headers: {
              "content-type": result.contentType,
              "content-length": String(result.length),
            },
          },
        );
      }
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
      if (!streaming) arrival.value.release();
    }
  }

  // upgrade는 respond를 거치지 않는다. HTTP와 같은 순서로 gate를 본다.
  async function acceptUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
  ): Promise<void> {
    try {
      if (rawHeaderBytes(request) > MAX_HEADER_BYTES) {
        return refuseSocket(
          socket,
          failure({ code: "invalid_input", message: "headers exceed limit" }),
        );
      }
      const url = upgradeUrl(request);
      if (url === undefined) {
        return refuseSocket(
          socket,
          failure({ code: "invalid_input", message: "host not allowed" }),
        );
      }
      const origin = request.headers.origin ?? null;
      const decision = await gateRequest(
        {
          url: url.href,
          origin,
          authorization: request.headers.authorization ?? null,
          port,
        },
        options.credentials,
      );
      if (!decision.ok) {
        // 무인증·Origin 거부는 안전 log만. ledger event는 없다.
        options.logger?.warn({
          component: "api",
          event: origin !== null ? "origin_rejected" : "auth_rejected",
        });
        return refuseSocket(socket, decision.failure);
      }
      if (!isSubscribePath(url.pathname)) {
        return refuseSocket(
          socket,
          failure({ code: "not_found", message: "route not found" }),
        );
      }
      if (!options.bus) {
        return refuseSocket(
          socket,
          failure({ code: "unavailable", message: "gateway unavailable" }),
        );
      }
      // 자격은 연결 때 한 번 본다.
      if (!gatewayAllowed(decision.context)) {
        return refuseSocket(
          socket,
          failure({
            code: "forbidden",
            message: "gateway not allowed for this credential",
          }),
        );
      }
      // event 연결 한도(32·principal당 4)는 upgrade 전에 결정한다. queue 없다.
      const connection = admission.enterEvent(decision.context.principal);
      if (!connection.ok) {
        return refuseSocket(socket, failure(connection.error));
      }
      const accepted = acceptSocket(request);
      if (!accepted.ok) {
        connection.value.release();
        return refuseSocket(socket, accepted.failure);
      }
      gateway.accept(request, socket, head, decision.context, {
        bus: options.bus,
        frames: options.gateway,
        onClose: connection.value.release,
      });
    } catch {
      // 경계 밖 throw는 stack·원문 없이 internal이다.
      refuseSocket(
        socket,
        failure({ code: "internal", message: "internal error" }),
      );
    }
  }

  // adapter가 request URL을 만들 때와 같은 규칙이다. gateRequest의 Host 검사가 이 URL을 본다.
  function upgradeUrl(request: IncomingMessage): URL | undefined {
    try {
      return new URL(
        request.url ?? "/",
        `http://${request.headers.host ?? "localhost"}`,
      );
    } catch {
      return undefined;
    }
  }

  const gateway = createGatewayUpgrade();
  const upgrade: ServeUpgradeHandler = (request, socket, head) => {
    // 거절 write까지 실패하면 알릴 길이 없다. process는 죽이지 않는다.
    void acceptUpgrade(request, socket, head).catch(() => undefined);
  };
  const v4 = await serve(
    { port: requested, hostname: LOOPBACK[0], upgrade },
    (request) => onRequest(request),
  );
  if (v4.addr.transport === "tcp") port = v4.addr.port;
  // 원격 bind 설정은 없다. IPv6 loopback은 같은 port에만 붙인다.
  let v6: ServeHandle | undefined;
  try {
    v6 = await serve({ port, hostname: LOOPBACK[1], upgrade }, (request) =>
      onRequest(request),
    );
  } catch (thrown) {
    // v4가 먼저 듣는 사이 붙은 upgraded socket이 있으면 v4.shutdown()이 끝나지 않는다.
    gateway.shutdown();
    await v4.shutdown().catch(() => undefined);
    throw thrown;
  }
  return {
    port,
    stop: async () => {
      // 내려간다는 frame을 먼저 보낸다. 남은 upgraded socket은 server.close()가 닫지 않아 여기서 끊는다.
      options.gateway?.shutdown();
      gateway.shutdown();
      await Promise.all([v4.shutdown(), v6?.shutdown()]);
    },
  };
}

const STREAM_IDLE_MS = 60_000;

// source를 소비자가 당길 때만 읽는다(backpressure). 끝·오류·취소 때 한 번 `done`을 부르고,
// 소비자가 idleMs 동안 다음 조각을 당기지 않으면 source를 취소하고 응답을 오류로 끝낸다.
function held(
  source: ReadableStream<Uint8Array>,
  idleMs: number,
  done: () => void,
): ReadableStream<Uint8Array> {
  const reader = source.getReader();
  let finished = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const finish = () => {
    clearTimeout(timer);
    if (finished) return;
    finished = true;
    done();
  };
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        clearTimeout(timer);
        try {
          const next = await reader.read();
          if (next.done) {
            finish();
            controller.close();
            return;
          }
          controller.enqueue(next.value);
          // 이 조각을 소비자가 가져가 다음 pull을 부를 때까지의 대기를 잰다.
          timer = setTimeout(() => {
            reader.cancel().catch(() => undefined);
            controller.error(new Error("stream consumer stalled"));
            finish();
          }, idleMs);
        } catch (thrown) {
          finish();
          controller.error(thrown);
        }
      },
      async cancel(reason) {
        finish();
        await reader.cancel(reason).catch(() => undefined);
      },
    },
    { highWaterMark: 0 },
  );
}

// 회수·정지 제어만 예약 영역으로 입장시킨다. caller의 priority 주장은
// 입력에 없다. 입장 영역은 route가 등록한 command 이름으로 정한다.
// 지금 이 lane을 쓰는 command는 없다.
const CONTROL_OPERATIONS = new Set<string>();

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
