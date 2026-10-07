// 사람 token은 이 객체의 메모리에만 있다. 직렬화·log·renderer로 나가지 않는다.
import {
  createRpcClient,
  errorBodySchema,
  errorCodeForStatus,
  type Route,
  routePath,
  type RpcClient,
  type RpcFetch,
  UPLOAD_INPUT_HEADER,
} from "../../../../../packages/contracts/platform/mod.ts";

import { isAllowed, lookupCall } from "./allowlist.ts";
import { routeByName } from "./routes.ts";

type CallResult<T = unknown> = { ok: true; value: T } | {
  ok: false;
  error: {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

/** 바이트 body·stream 응답 route용 fetch. 응답 본문은 소비자가 당겨 읽는다. */
export type StreamFetch = (
  input: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string | Uint8Array;
  },
) => Promise<
  {
    status: number;
    headers: Headers;
    body: ReadableStream<Uint8Array> | null;
  }
>;

export interface CoreSession {
  readonly apiPort: number;
  readonly coreEpoch: string;
  /** 인증된 read·command. allowlist 밖은 네트워크로 나가지 않는다. */
  call(
    kind: string,
    resource: string,
    method: string,
    body: unknown,
  ): Promise<CallResult>;
  /**
   * main 안의 통로(편집기 파일 adapter)만 부른다. renderer allowlist를 거치지 않고 contract의
   * route 원본으로 입력·출력을 검사한다. renderer IPC는 이 함수를 부르지 않는다.
   */
  internal(
    kind: string,
    resource: string,
    method: string,
    body: unknown,
  ): Promise<CallResult>;
  /** file route를 stream으로 읽는다. limit 바이트를 넘으면 끊고 too_large다. */
  readStream(
    resource: string,
    method: string,
    body: unknown,
    limit: number,
  ): Promise<CallResult<Uint8Array>>;
  /** upload route에 바이트를 보낸다. 입력은 header의 base64url JSON이다. */
  upload(
    resource: string,
    method: string,
    input: unknown,
    bytes: Uint8Array,
  ): Promise<CallResult>;
  /**
   * worker route에 request byte channel을 붙여 보낸다(problems SubmitFeedback의 선택한 PNG).
   * 입력은 upload와 같은 header이고 core는 바이트를 해석하지 않고 worker로 넘긴다.
   */
  workerBytes(
    resource: string,
    method: string,
    input: unknown,
    bytes: Uint8Array,
  ): Promise<CallResult>;
}

export interface SessionInput {
  apiPort: number;
  coreEpoch: string;
  userToken: string;
  fetch: RpcFetch;
  /** 바이트 route 통로. 없으면 그 호출은 unavailable이다. */
  stream?: StreamFetch;
}

function forbidden(): CallResult<never> {
  return {
    ok: false,
    error: { code: "forbidden", message: "허용되지 않은 호출이다" },
  };
}

function lost(): CallResult<never> {
  return {
    ok: false,
    error: {
      code: "unavailable",
      message: "transport failed",
      details: { reason: "transport_failed" },
    },
  };
}

function encodeInput(input: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(input));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll(
    "=",
    "",
  );
}

async function drain(
  body: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<Uint8Array | "too_large"> {
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      return "too_large";
    }
    chunks.push(value);
  }
  const joined = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    joined.set(chunk, at);
    at += chunk.byteLength;
  }
  return joined;
}

async function failure(
  status: number,
  body: ReadableStream<Uint8Array> | null,
): Promise<CallResult<never>> {
  const bytes = await drain(body, 64 * 1024).catch(() => "too_large" as const);
  let json: unknown;
  try {
    json = bytes === "too_large"
      ? undefined
      : JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    json = undefined;
  }
  const parsed = errorBodySchema.safeParse(json);
  if (parsed.success) return { ok: false, error: parsed.data.error };
  return {
    ok: false,
    error: {
      code: errorCodeForStatus(status) ?? "internal",
      message: "request failed",
    },
  };
}

export function openSession(input: SessionInput): CoreSession {
  const base = `http://127.0.0.1:${input.apiPort}`;
  const rpc: RpcClient = createRpcClient({
    baseUrl: base,
    token: input.userToken,
    fetch: input.fetch,
  });
  const routeOf = (kind: string, resource: string, method: string) =>
    routeByName(`${kind}:${resource}/${method}`);
  return {
    apiPort: input.apiPort,
    coreEpoch: input.coreEpoch,
    async call(kind, resource, method, body) {
      const name = lookupCall(kind, resource, method);
      const route = name === undefined ? undefined : routeByName(name);
      if (route === undefined || !isAllowed(kind, resource, method)) {
        return forbidden();
      }
      return await rpc.call(route as Route, body as never);
    },
    async internal(kind, resource, method, body) {
      const route = routeOf(kind, resource, method);
      if (route === undefined || route.kind === "file") return forbidden();
      return await rpc.call(route as Route, body as never);
    },
    async readStream(resource, method, body, limit) {
      const route = routeOf("file", resource, method);
      if (route === undefined || input.stream === undefined) return forbidden();
      const checked = route.input.safeParse(body);
      if (!checked.success) {
        return {
          ok: false,
          error: { code: "invalid_input", message: "invalid input" },
        };
      }
      let response: Awaited<ReturnType<StreamFetch>>;
      try {
        response = await input.stream(`${base}${routePath(route)}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${input.userToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(checked.data),
        });
      } catch {
        return lost();
      }
      if (response.status !== 200) {
        return await failure(response.status, response.body);
      }
      try {
        const bytes = await drain(response.body, limit);
        if (bytes === "too_large") {
          return {
            ok: false,
            error: { code: "too_large", message: "file is too large" },
          };
        }
        return { ok: true, value: bytes };
      } catch {
        // 끝에서 hash·크기가 어긋나면 core가 응답을 끊는다. 받은 조각은 쓰지 않는다.
        return lost();
      }
    },
    upload(resource, method, body, bytes) {
      return sendBytes(routeOf("upload", resource, method), body, bytes);
    },
    workerBytes(resource, method, body, bytes) {
      return sendBytes(routeOf("worker", resource, method), body, bytes);
    },
  };

  async function sendBytes(
    route: Route | undefined,
    body: unknown,
    bytes: Uint8Array,
  ): Promise<CallResult> {
    if (route === undefined || input.stream === undefined) return forbidden();
    const checked = route.input.safeParse(body);
    if (!checked.success) {
      return {
        ok: false,
        error: { code: "invalid_input", message: "invalid input" },
      };
    }
    let response: Awaited<ReturnType<StreamFetch>>;
    try {
      response = await input.stream(`${base}${routePath(route)}`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.userToken}`,
          "content-type": "application/octet-stream",
          [UPLOAD_INPUT_HEADER]: encodeInput(checked.data),
        },
        body: bytes,
      });
    } catch {
      return lost();
    }
    if (response.status !== 200) {
      return await failure(response.status, response.body);
    }
    const raw = await drain(response.body, 64 * 1024).catch(() =>
      "too_large" as const
    );
    let json: unknown;
    try {
      json = raw === "too_large"
        ? undefined
        : JSON.parse(new TextDecoder().decode(raw));
    } catch {
      json = undefined;
    }
    const output = (route.output as {
      safeParse(value: unknown): {
        success: boolean;
        data?: unknown;
      };
    }).safeParse(json);
    if (!output.success) {
      return {
        ok: false,
        error: { code: "internal", message: "internal error" },
      };
    }
    return { ok: true, value: output.data };
  }
}
