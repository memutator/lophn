// Unix socket HTTP/1.1. host는 lophn.invalid만 받는다.
// 앱 entrypoint의 module graph는 core server의 zod·protocol graph까지 끌어오지 않으므로 node:http 위의
// 작은 server를 이 폴더에 둔다.

import type { Buffer } from "node:buffer";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import { SOCKET_HOST } from "./limits.ts";

type HttpRequest = {
  method: string;
  path: string;
  url: URL;
  headers: Headers;
  body: Uint8Array;
};

type HttpResponse = {
  status: number;
  headers?: Record<string, string>;
  body: Uint8Array | string;
};

export type HttpHandler = (request: HttpRequest) => Promise<HttpResponse>;

export function serveUnix(path: string, handler: HttpHandler): Server {
  const server = createServer((request, response) => {
    void answer(request, response, handler);
  });
  server.listen(path);
  return server;
}

async function answer(
  request: IncomingMessage,
  response: ServerResponse,
  handler: HttpHandler,
): Promise<void> {
  let result: HttpResponse;
  try {
    result = await handle(request, handler);
  } catch {
    result = { status: 500, body: "" };
  }
  const body =
    typeof result.body === "string"
      ? new TextEncoder().encode(result.body)
      : result.body;
  response.writeHead(result.status, {
    "content-length": String(body.byteLength),
    ...result.headers,
  });
  response.end(body);
}

async function handle(
  request: IncomingMessage,
  handler: HttpHandler,
): Promise<HttpResponse> {
  const host = request.headers.host;
  if (host !== SOCKET_HOST) {
    return jsonResponse(400, {
      error: { code: "invalid_input", message: "host is not lophn.invalid" },
    });
  }
  const url = new URL(request.url ?? "/", `http://${host}`);
  const headers = new Headers();
  for (const [name, value] of Object.entries(request.headers)) {
    if (value === undefined) continue;
    headers.set(name, Array.isArray(value) ? value.join(", ") : value);
  }
  return await handler({
    method: request.method ?? "GET",
    path: url.pathname,
    url,
    headers,
    body: await bodyOf(request),
  });
}

// control·apply 본문은 handler가 한 번에 받는다. 연결이 끊기면 reject로 끝난다.
function bodyOf(request: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => resolve(concat(chunks)));
    request.on("error", reject);
  });
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const size = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

export function jsonResponse(status: number, value: unknown): HttpResponse {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}
