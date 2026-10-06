import {
  CapabilityError,
  fromBroker,
  missingHost,
  outsideCommand,
} from "./errors.ts";
import { type BrokerResponse, type CapHost, readHost } from "./host.ts";

export const NET_FETCH_PATH = "/_lophn/broker/net/fetch";

export const DEFAULT_TIMEOUT_MS = 10_000;
export const DEFAULT_READ_RETRIES = 2;
export const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [200, 400];

const METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);
const READ_METHODS = new Set(["GET", "HEAD"]);
// 상대가 일시적으로 못 받는다고 답한 상태다. 읽기만 다시 부른다.
const RETRY_STATUSES = new Set([429, 502, 503, 504]);

export type NetRequest = {
  // grant에 적힌 정확한 host와 port다. wildcard는 없다.
  host: string;
  port: number;
  // "/"로 시작하는 경로. 목적지를 바꾸는 경로는 broker가 거절한다.
  path: string;
  method?: string;
};

export type NetFetchOptions = {
  // 시도 하나의 제한 시간이다.
  timeoutMs?: number;
  // 재시도 횟수. 기본은 GET·HEAD만 2회이고 나머지는 0회다. 효과가 있는 요청에 직접 주면
  // 상대가 같은 요청을 두 번 받아도 되는지(멱등)는 앱의 계약으로 확인해야 한다.
  retries?: number;
  retryDelaysMs?: readonly number[];
};

export type NetResponse = { status: number; body: unknown };

export type NetClient = {
  fetch(request: NetRequest, options?: NetFetchOptions): Promise<NetResponse>;
};

export type NetClientDeps = {
  host?: CapHost;
  sleep?: (ms: number) => Promise<void>;
};

function invalid(message: string): CapabilityError {
  return new CapabilityError({ code: "invalid_input", message });
}

function check(request: NetRequest, method: string): void {
  if (typeof request.host !== "string" || request.host.length === 0) {
    throw invalid("host must be an exact host name");
  }
  if (
    !Number.isInteger(request.port) || request.port < 1 || request.port > 65535
  ) {
    throw invalid("port must be an integer from 1 to 65535");
  }
  if (typeof request.path !== "string" || !request.path.startsWith("/")) {
    throw invalid("path must start with /");
  }
  if (!METHODS.has(method)) throw invalid("method is not supported");
}

function timedOut(): CapabilityError {
  return new CapabilityError({
    code: "unavailable",
    message: "net fetch timed out",
  });
}

// 읽기가 아닌 요청이 응답 없이 끝나면 상대에 닿았는지 모른다.
function unknownUnlessRead(
  error: CapabilityError,
  read: boolean,
): CapabilityError {
  if (read) return error;
  return new CapabilityError({
    code: error.code,
    message: error.message,
    outcome: "unknown",
  });
}

async function attemptOnce(
  host: CapHost,
  body: Record<string, unknown>,
  timeoutMs: number,
): Promise<BrokerResponse> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(timedOut());
    }, timeoutMs);
  });
  try {
    return await Promise.race([
      host.post(NET_FETCH_PATH, body, { signal: controller.signal }),
      limit,
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function asResponse(body: unknown): NetResponse {
  const found = body as { status?: unknown; body?: unknown } | null;
  if (found === null || typeof found !== "object") {
    throw new CapabilityError({
      code: "unavailable",
      message: "broker answered with an unknown shape",
    });
  }
  if (typeof found.status !== "number") {
    throw new CapabilityError({
      code: "unavailable",
      message: "broker answered without a status",
    });
  }
  return { status: found.status, body: found.body };
}

export function createNetClient(deps: NetClientDeps = {}): NetClient {
  const sleep = deps.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  return {
    async fetch(request, options = {}) {
      const method = (request.method ?? "GET").toUpperCase();
      check(request, method);
      const host = deps.host ?? readHost();
      if (!host) throw missingHost();
      const context = host.call();
      if (!context) throw outsideCommand();
      const read = READ_METHODS.has(method);
      const retries = options.retries ?? (read ? DEFAULT_READ_RETRIES : 0);
      const delays = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
      const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
      const body = {
        invocation: context.invocation,
        command: context.command,
        host: request.host,
        port: request.port,
        method,
        path: request.path,
      };
      const requested = {
        permission: "net.fetch",
        scope: { host: request.host, port: request.port },
      };
      let last: CapabilityError | undefined;
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        if (attempt > 0) {
          const delay = delays[Math.min(attempt - 1, delays.length - 1)] ?? 0;
          await sleep(delay);
        }
        let response: BrokerResponse;
        try {
          response = await attemptOnce(host, body, timeoutMs);
        } catch (error) {
          last = unknownUnlessRead(
            error instanceof CapabilityError ? error : new CapabilityError({
              code: "unavailable",
              message: "net fetch could not reach the broker",
            }),
            read,
          );
          continue;
        }
        if (response.status === 200) {
          const answer = asResponse(response.body);
          if (read && RETRY_STATUSES.has(answer.status) && attempt < retries) {
            continue;
          }
          return answer;
        }
        const failure = fromBroker(response.body, requested);
        if (failure.code !== "unavailable") throw failure;
        last = unknownUnlessRead(failure, read);
      }
      throw last ?? timedOut();
    },
  };
}

// 앱 코드가 쓰는 기본 client다. host는 호출할 때 읽는다.
const shared = createNetClient();

export function netFetch(
  request: NetRequest,
  options?: NetFetchOptions,
): Promise<NetResponse> {
  return shared.fetch(request, options);
}
