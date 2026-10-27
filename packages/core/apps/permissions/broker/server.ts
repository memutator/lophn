// 앱별 broker socket의 HTTP 서버다. 자식 하나의 credential·mode·nonce에
// 묶이고 아래 서비스만 낸다. core API의 임의 proxy가 아니며 모르는 경로는 없는 경로와 같은
// not_found다. 신원은 요청 본문이 정하지 않는다. 본문의 nonce·mode가 연결과 다르면 거절한다.
import { asInternalError, err, type Result } from "../../../../base/mod.ts";
import { ERROR_HTTP_STATUS } from "../../../../protocol/base/mod.ts";
import { APP_BROKER_PATHS } from "../../../../protocol/apps/calls/mod.ts";
import { NET_FETCH_BODY_MAX_BYTES } from "../../../../protocol/apps/mod.ts";
import type { BrokerChild } from "./invocations.ts";
import type { NetFetchService } from "./net-fetch.ts";
import type { SecretUseService } from "./secrets.ts";
import type { ExceptionLogService } from "./problems.ts";
import type { ReadyService } from "./ready.ts";
import type { AppsCallService } from "./apps-call.ts";

const BROKER_ROUTES = {
  ready: "/_lophn/broker/ready",
  netFetch: "/_lophn/broker/net/fetch",
  secretsUse: "/_lophn/broker/secrets/use",
  problemsObserve: "/_lophn/broker/problems/observe-exception",
  appsCall: APP_BROKER_PATHS.call,
} as const;

const BROKER_BODY_MAX_BYTES = 1_048_576;
// net/fetch는 10 MiB bytes의 base64와 envelope 여유(64 KiB)를 담는다. 나머지 경로는 기본 상한이다.
const BODY_MAX_BYTES_BY_PATH = new Map<string, number>([
  [
    BROKER_ROUTES.netFetch,
    Math.ceil(NET_FETCH_BODY_MAX_BYTES / 3) * 4 + 64 * 1024,
  ],
]);

export type BrokerServices = {
  ready?: ReadyService;
  net?: NetFetchService;
  secrets?: SecretUseService;
  exceptions?: ExceptionLogService;
  appsCall?: AppsCallService;
};

export type BrokerSession = {
  child: BrokerChild;
  // 시작 입력의 자식 credential이다. argv·환경에는 없다.
  credential: string;
};

type BrokerEndpoint = {
  handle(request: Request): Promise<Response>;
  // 새 요청부터 막는다. 이미 받은 요청은 끝까지 간다(회수는 이미 한 전송을 취소하지 않는다).
  block(): void;
  readonly blocked: boolean;
};

type Handler = (child: BrokerChild, body: unknown) => Promise<Result<unknown>>;

function routes(services: BrokerServices): Map<string, Handler> {
  const table = new Map<string, Handler>();
  const { ready, net, secrets, exceptions, appsCall } = services;
  if (ready) {
    table.set(BROKER_ROUTES.ready, (child, body) =>
      Promise.resolve(ready.ready(child, body)),
    );
  }
  if (net) table.set(BROKER_ROUTES.netFetch, (c, b) => net.request(c, b));
  if (secrets) table.set(BROKER_ROUTES.secretsUse, (c, b) => secrets.use(c, b));
  if (exceptions) {
    table.set(BROKER_ROUTES.problemsObserve, (c, b) =>
      exceptions.observe(c, b),
    );
  }
  if (appsCall) {
    table.set(BROKER_ROUTES.appsCall, (c, b) => appsCall.call(c, b));
  }
  return table;
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function failed(error: {
  code: keyof typeof ERROR_HTTP_STATUS;
  message: string;
  details?: Record<string, unknown>;
}): Response {
  return json(ERROR_HTTP_STATUS[error.code], { error });
}

// credential 비교는 길이와 내용을 끝까지 본다.
function sameSecret(given: string, expected: string): boolean {
  const left = new TextEncoder().encode(given);
  const right = new TextEncoder().encode(expected);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}

function presented(request: Request): string {
  const header = request.headers.get("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : header;
}

export function createBrokerEndpoint(options: {
  session: BrokerSession;
  services: BrokerServices;
}): BrokerEndpoint {
  const table = routes(options.services);
  let blocked = false;
  return {
    get blocked() {
      return blocked;
    },
    block() {
      blocked = true;
    },
    async handle(request) {
      const path = new URL(request.url).pathname;
      const handler = table.get(path);
      if (request.method !== "POST" || handler === undefined) {
        return failed({ code: "not_found", message: "not found" });
      }
      if (!sameSecret(presented(request), options.session.credential)) {
        return failed({ code: "unauthorized", message: "unauthorized" });
      }
      // 회수·교체를 시작한 연결은 새 요청부터 받지 않는다.
      if (blocked) {
        return failed({ code: "unavailable", message: "broker is closing" });
      }
      const text = await request.text();
      if (
        new TextEncoder().encode(text).length >
        (BODY_MAX_BYTES_BY_PATH.get(path) ?? BROKER_BODY_MAX_BYTES)
      ) {
        return failed({ code: "invalid_input", message: "body is too large" });
      }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return failed({ code: "invalid_input", message: "body is not JSON" });
      }
      if (body === null || typeof body !== "object" || Array.isArray(body)) {
        return failed({ code: "invalid_input", message: "body is invalid" });
      }
      const claimed = body as { process_nonce?: unknown; mode?: unknown };
      if (
        claimed.process_nonce !== options.session.child.processNonce ||
        claimed.mode !== options.session.child.mode
      ) {
        return failed({
          code: "unauthorized",
          message: "request does not match the child connection",
        });
      }
      let result: Result<unknown>;
      try {
        result = await handler(options.session.child, body);
      } catch (thrown) {
        result = err(asInternalError(thrown));
      }
      return result.ok ? json(200, result.value) : failed(result.error);
    },
  };
}

// 앱마다 하나인 broker endpoint 목록이다. 앱 단위 차단과 자식 종료 정리를 맡는다.
export type BrokerHub = {
  register(session: BrokerSession, services: BrokerServices): BrokerEndpoint;
  // 그 앱의 모든 연결을 새 요청부터 막는다. 자식 종료 확인은 supervisor가 한다.
  blockApp(app: string): number;
  unregister(processNonce: string): void;
};

export function createBrokerHub(): BrokerHub {
  const endpoints = new Map<
    string,
    { app: string; endpoint: BrokerEndpoint }
  >();
  return {
    register(session, services) {
      const endpoint = createBrokerEndpoint({ session, services });
      endpoints.set(session.child.processNonce, {
        app: session.child.app,
        endpoint,
      });
      return endpoint;
    },
    blockApp(app) {
      let count = 0;
      for (const entry of endpoints.values()) {
        if (entry.app !== app) continue;
        entry.endpoint.block();
        count += 1;
      }
      return count;
    },
    unregister(processNonce) {
      endpoints.delete(processNonce);
    },
  };
}

type BrokerListener = { shutdown(): Promise<void> };

// 앱별 broker socket을 듣는다. 신뢰 supervisor 프로세스에서만 부른다.
export function serveBroker(
  socketPath: string,
  endpoint: BrokerEndpoint,
): BrokerListener {
  const server = Deno.serve(
    { transport: "unix", path: socketPath, onListen: () => {} },
    (request) => endpoint.handle(request),
  );
  return { shutdown: () => server.shutdown() };
}
