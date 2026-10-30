import type { Result } from "../../base/mod.ts";
import {
  type Attributes,
  formatTraceparent,
  type Tracer,
} from "../../base/telemetry/mod.ts";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

// 밖으로 나가는 HTTP 호출 하나를 client span으로 잰다. traceparent는 loopback(core, 수집기, 개발 fake)에만
// 붙인다. provider와 MCP server에 우리 trace id를 넘기지 않는다.
export function tracedFetch(
  fetchImpl: typeof fetch,
  tracer: Tracer,
): typeof fetch {
  return async (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    return await tracer.inSpan(
      `HTTP ${method}`,
      {
        kind: "client",
        attributes: {
          "http.request.method": method,
          "server.address": url.hostname,
          "server.port": Number(
            url.port || (url.protocol === "https:" ? 443 : 80),
          ),
          // query에 key를 싣는 API가 있다. path까지만 남긴다.
          "url.path": url.pathname,
        },
      },
      async (span) => {
        let nextInit = init;
        if (LOOPBACK.has(url.hostname)) {
          const headers = new Headers(
            init?.headers ?? (input instanceof Request ? input.headers : {}),
          );
          headers.set("traceparent", formatTraceparent(span.context));
          nextInit = { ...init, headers };
        }
        const response = await fetchImpl(input, nextInit);
        span.setAttribute("http.response.status_code", response.status);
        if (response.status >= 500) span.setStatus("error");
        return response;
      },
    );
  };
}

// Result를 돌려주는 호출 하나(ledger writer command, reader read, worker 왕복)를 client span으로 잰다.
// 실패 code는 span에 남기고, internal만 span 오류로 본다(나머지는 부른 쪽 입력이나 상태 탓이다).
export function tracedCall<A extends unknown[], T>(
  tracer: Tracer,
  name: string,
  attributes: (...args: A) => Attributes,
  call: (...args: A) => Promise<Result<T>>,
): (...args: A) => Promise<Result<T>> {
  return (...args) =>
    tracer.inSpan(
      name,
      { kind: "client", attributes: attributes(...args) },
      async (span) => {
        const result = await call(...args);
        if (!result.ok) {
          span.setAttribute("error.type", result.error.code);
          if (result.error.code === "internal") span.setStatus("error");
        }
        return result;
      },
    );
}
