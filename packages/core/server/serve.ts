// fetch 모양 handler(Request → Response)를 node:http 위에서 받는다. 요청·응답 body는
// ReadableStream으로 흘려보내고, client가 끊기면 request.signal이 abort된다.
import type { Buffer } from "node:buffer";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo, ListenOptions } from "node:net";
import type { Duplex } from "node:stream";

export type ServeAddr =
  | { transport: "tcp"; hostname: string; port: number }
  | { transport: "unix"; path: string };

export type ServeHandlerInfo = {
  remoteAddr:
    | { transport: "tcp"; hostname: string; port: number }
    | { transport: "unix"; path: string };
};

export type ServeHandler = (
  request: Request,
  info: ServeHandlerInfo,
) => Response | Promise<Response>;

// WebSocket handshake처럼 HTTP 응답으로 끝나지 않는 연결은 handler를 거치지 않고 raw로
// 넘긴다. ws 같은 library가 이 socket을 그대로 가져간다.
export type ServeUpgradeHandler = (
  request: IncomingMessage,
  socket: Duplex,
  head: Buffer,
) => void;

export type ServeOptions =
  | {
      transport?: "tcp";
      hostname?: string;
      port?: number;
      // bind가 끝난 뒤 실제로 듣는 주소로 부른다.
      onListen?: (addr: {
        transport: "tcp";
        hostname: string;
        port: number;
      }) => void;
      upgrade?: ServeUpgradeHandler;
    }
  | {
      transport: "unix";
      path: string;
      onListen?: (addr: { transport: "unix"; path: string }) => void;
      upgrade?: ServeUpgradeHandler;
    };

export type ServeHandle = {
  readonly addr: ServeAddr;
  // 새 연결은 받지 않고, 이미 받은 요청이 끝나면 닫는다.
  shutdown(): Promise<void>;
};

const DEFAULT_HOSTNAME = "127.0.0.1";
const DEFAULT_PORT = 8000;

export async function serve(
  options: ServeOptions,
  handler: ServeHandler,
): Promise<ServeHandle> {
  const server = createServer();
  if (options.upgrade !== undefined) server.on("upgrade", options.upgrade);
  const unixPath = options.transport === "unix" ? options.path : undefined;
  const requests = trackRequests(server);
  server.on("request", (request, response) => {
    void answer(request, response, unixPath, handler);
  });
  if (options.transport === "unix") {
    await bind(server, { path: options.path });
    const addr = { transport: "unix" as const, path: options.path };
    options.onListen?.(addr);
    return handleOf(server, addr, requests);
  }
  await bind(server, {
    host: options.hostname ?? DEFAULT_HOSTNAME,
    port: options.port ?? DEFAULT_PORT,
  });
  // bind가 끝난 뒤라 TCP면 address()는 AddressInfo다.
  const bound = server.address() as AddressInfo;
  const addr = {
    transport: "tcp" as const,
    hostname: bound.address,
    port: bound.port,
  };
  options.onListen?.(addr);
  return handleOf(server, addr, requests);
}

function bind(server: Server, options: ListenOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options, () => {
      server.off("error", reject);
      resolve();
    });
  });
}

type Requests = { whenIdle(run: () => void): void };

// 진행 중인 요청 수. 0이 되면 기다리던 일을 부른다.
function trackRequests(server: Server): Requests {
  let active = 0;
  let waiting: (() => void)[] = [];
  const settle = () => {
    if (active > 0) return;
    const run = waiting;
    waiting = [];
    for (const each of run) each();
  };
  server.on("request", (_request, response) => {
    active += 1;
    response.once("close", () => {
      active -= 1;
      settle();
    });
  });
  return {
    whenIdle(run) {
      waiting.push(run);
      settle();
    },
  };
}

function handleOf(
  server: Server,
  addr: ServeAddr,
  requests: Requests,
): ServeHandle {
  let closing: Promise<void> | undefined;
  return {
    addr,
    shutdown() {
      closing ??= new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        // 받은 요청은 끝까지 기다린다. 그 뒤에 남은 connection(요청을 아직 보내지 않은 것, keep-alive)은
        // close가 기다려 주지 않고 끊는다. 바쁜 기계에서 자식이 연결만 열어 둔 채 종료가 오면 close가
        // 끝나지 않았다.
        requests.whenIdle(() => server.closeAllConnections());
      });
      return closing;
    },
  };
}

async function answer(
  request: IncomingMessage,
  response: ServerResponse,
  unixPath: string | undefined,
  handler: ServeHandler,
): Promise<void> {
  const controller = new AbortController();
  // 정상으로 응답을 다 보낸 뒤에도 close가 온다. handler가 signal을 붙들고 있으면 그때 풀린다.
  response.on("close", () => controller.abort());
  let url: URL;
  try {
    url = new URL(
      request.url ?? "/",
      `${unixPath === undefined ? "http" : "http+unix"}://${request.headers.host ?? "localhost"}`,
    );
  } catch {
    response.writeHead(400);
    response.end();
    return;
  }
  let result: Response;
  try {
    result = await handler(
      toRequest(request, url, controller.signal),
      infoOf(request, unixPath),
    );
  } catch (thrown) {
    console.error("http handler failed:", thrown);
    result = new Response(null, { status: 500 });
  }
  await write(request.method, controller.signal, response, result);
}

type DuplexRequestInit = RequestInit & { duplex: "half" };

function toRequest(
  request: IncomingMessage,
  url: URL,
  signal: AbortSignal,
): Request {
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : String(value));
  }
  const method = request.method ?? "GET";
  const init: DuplexRequestInit = { method, headers, signal, duplex: "half" };
  if (method !== "GET" && method !== "HEAD") init.body = bodyOf(request);
  return new Request(url, init);
}

function infoOf(
  request: IncomingMessage,
  unixPath: string | undefined,
): ServeHandlerInfo {
  if (unixPath !== undefined) {
    return { remoteAddr: { transport: "unix", path: unixPath } };
  }
  return {
    remoteAddr: {
      transport: "tcp",
      hostname: request.socket.remoteAddress ?? "",
      port: request.socket.remotePort ?? 0,
    },
  };
}

// 소비자가 body를 당길 때만 socket을 다시 흘린다. 느린 소비자가 연결 하나에 전부 쌓이지 않게.
function bodyOf(request: IncomingMessage): ReadableStream<Uint8Array> {
  let ended = false;
  let paused = false;
  const stop = (
    controller: ReadableStreamDefaultController<Uint8Array>,
    error?: unknown,
  ) => {
    if (ended) return;
    ended = true;
    if (error === undefined) controller.close();
    else controller.error(error);
  };
  return new ReadableStream<Uint8Array>(
    {
      start(controller) {
        request.on("data", (chunk: Buffer) => {
          if (ended) return;
          controller.enqueue(
            new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength),
          );
          if ((controller.desiredSize ?? 0) <= 0) {
            paused = true;
            request.pause();
          }
        });
        request.on("end", () => stop(controller));
        request.on("error", (error) => stop(controller, error));
        request.on("close", () =>
          stop(controller, new Error("client disconnected")),
        );
      },
      pull() {
        if (!paused) return;
        paused = false;
        request.resume();
      },
      cancel() {
        ended = true;
        request.destroy();
      },
    },
    { highWaterMark: 1 },
  );
}

async function write(
  method: string | undefined,
  signal: AbortSignal,
  response: ServerResponse,
  result: Response,
): Promise<void> {
  if (signal.aborted) return;
  const headers: Record<string, string> = {};
  result.headers.forEach((value, name) => {
    headers[name] = value;
  });
  response.writeHead(result.status, headers);
  if (result.body === null) {
    response.end();
    return;
  }
  if (method === "HEAD" || result.status === 204 || result.status === 304) {
    // body를 보내지 않는 응답도 stream은 접어야 한다. 안 읽은 stream의 정리(done)가 돌지 않는다.
    await result.body.cancel().catch(() => undefined);
    response.end();
    return;
  }
  const reader = result.body.getReader();
  // client가 끊기면 당기고 있던 read를 풀어 stream의 cancel까지 간다.
  const cancel = () => {
    void reader.cancel(new Error("client disconnected"));
  };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    while (!signal.aborted) {
      const next = await reader.read();
      if (next.done) {
        response.end();
        return;
      }
      if (signal.aborted) return;
      if (!response.write(next.value)) await drained(response);
    }
  } catch (thrown) {
    response.destroy(thrown instanceof Error ? thrown : undefined);
  } finally {
    signal.removeEventListener("abort", cancel);
  }
}

function drained(response: ServerResponse): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      response.off("drain", done);
      response.off("close", done);
      resolve();
    };
    response.once("drain", done);
    response.once("close", done);
  });
}
