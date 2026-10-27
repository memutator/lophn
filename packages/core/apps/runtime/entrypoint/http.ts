// Unix socket HTTP/1.1. host는 lophn.invalid만 받는다.
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

export function serveUnix(
  path: string,
  handler: HttpHandler,
): Deno.HttpServer<Deno.UnixAddr> {
  return Deno.serve(
    {
      path,
      transport: "unix",
      onListen() {},
    },
    (request: Request) => handle(request, handler),
  );
}

async function handle(
  request: Request,
  handler: HttpHandler,
): Promise<Response> {
  const host = request.headers.get("host");
  if (host !== SOCKET_HOST) {
    return json(400, {
      error: { code: "invalid_input", message: "host is not lophn.invalid" },
    });
  }
  const url = new URL(request.url);
  const response = await handler({
    method: request.method,
    path: url.pathname,
    url,
    headers: request.headers,
    body: new Uint8Array(await request.arrayBuffer()),
  });
  const body =
    typeof response.body === "string"
      ? response.body
      : new Uint8Array(response.body);
  return new Response(body, {
    status: response.status,
    headers: response.headers,
  });
}

function json(status: number, value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export function jsonResponse(status: number, value: unknown): HttpResponse {
  return {
    status,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
  };
}
