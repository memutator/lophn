// 사람 token은 이 객체의 메모리에만 있다. 직렬화·log·renderer로 나가지 않는다.
import {
  createRpcClient,
  type RpcClient,
  type RpcFetch,
} from "../../../../protocol/client/mod.ts";
import {
  errorBodySchema,
  errorCodeForStatus,
  type Route,
  routePath,
  UPLOAD_INPUT_HEADER,
} from "../../../../protocol/base/mod.ts";

import { isAllowed, lookupCall } from "./allowlist.ts";
import { routeByName } from "./routes.ts";

type CallResult<T = unknown> =
  | { ok: true; value: T }
  | {
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
    /** 끊기면 응답 stream도 끊는다. */
    signal?: AbortSignal;
  },
) => Promise<{
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}>;

/** file route의 응답. 상태가 200이 아니어도 core가 준 그대로다. */
interface FileStream {
  status: number;
  headers: Headers;
  body: ReadableStream<Uint8Array> | null;
}

/** renderer가 `file` kind로 받는 byte 응답. content type은 core가 정한 것이다. */
interface FileBytes {
  bytes: Uint8Array;
  contentType: string;
}

/** renderer가 `file` kind로 한 번에 받는 byte 상한. */
const FILE_REPLY_MAX_BYTES = 32 * 1024 * 1024;

export interface CoreSession {
  readonly apiPort: number;
  readonly coreEpoch: string;
  /**
   * renderer가 부르는 통로. allowlist 밖은 네트워크로 나가지 않는다. `upload`는 bytes를 본문으로 보내고
   * `file`은 `{ bytes, contentType }`로 답한다.
   */
  call(
    kind: string,
    resource: string,
    method: string,
    body: unknown,
    bytes?: Uint8Array,
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
  /**
   * file route의 응답을 당겨 읽을 stream 그대로 낸다. main 안의 통로(앱 화면)만 쓴다. 보내지 못하면
   * 상태 403(허용 안 됨)·400(입력)·503(연결)에 본문이 없다. signal이 끊기면 응답도 끊긴다.
   */
  fileStream(
    resource: string,
    method: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<FileStream>;
  /** upload route에 바이트를 보낸다. 입력은 header의 base64url JSON이다. */
  upload(
    resource: string,
    method: string,
    input: unknown,
    bytes: Uint8Array,
  ): Promise<CallResult>;
}

interface SessionInput {
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
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
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
    json =
      bytes === "too_large"
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
    async call(kind, resource, method, body, bytes) {
      const name = lookupCall(kind, resource, method);
      const route = name === undefined ? undefined : routeByName(name);
      if (route === undefined || !isAllowed(kind, resource, method)) {
        return forbidden();
      }
      if (kind === "file") {
        return await readBytes(resource, method, body, FILE_REPLY_MAX_BYTES);
      }
      if (kind === "upload") {
        if (bytes === undefined) {
          return {
            ok: false,
            error: { code: "invalid_input", message: "invalid input" },
          };
        }
        return await sendBytes(route, body, bytes);
      }
      return await rpc.call(route as Route, body as never);
    },
    async internal(kind, resource, method, body) {
      const route = routeOf(kind, resource, method);
      if (route === undefined || route.kind === "file") return forbidden();
      return await rpc.call(route as Route, body as never);
    },
    async readStream(resource, method, body, limit) {
      const read = await readBytes(resource, method, body, limit);
      return read.ok ? { ok: true, value: read.value.bytes } : read;
    },
    async fileStream(resource, method, body, signal) {
      const opened = await openFile(resource, method, body, signal);
      if (opened.ok) return opened.value;
      const status =
        opened.error.code === "forbidden"
          ? 403
          : opened.error.code === "invalid_input"
            ? 400
            : 503;
      return { status, headers: new Headers(), body: null };
    },
    upload(resource, method, body, bytes) {
      return sendBytes(routeOf("upload", resource, method), body, bytes);
    },
  };

  async function openFile(
    resource: string,
    method: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<CallResult<FileStream>> {
    const route = routeOf("file", resource, method);
    if (route === undefined || input.stream === undefined) return forbidden();
    const checked = route.input.safeParse(body);
    if (!checked.success) {
      return {
        ok: false,
        error: { code: "invalid_input", message: "invalid input" },
      };
    }
    try {
      return {
        ok: true,
        value: await input.stream(`${base}${routePath(route)}`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${input.userToken}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(checked.data),
          ...(signal ? { signal } : {}),
        }),
      };
    } catch {
      return lost();
    }
  }

  async function readBytes(
    resource: string,
    method: string,
    body: unknown,
    limit: number,
  ): Promise<CallResult<FileBytes>> {
    const opened = await openFile(resource, method, body);
    if (!opened.ok) return opened;
    const response = opened.value;
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
      return {
        ok: true,
        value: {
          bytes,
          contentType:
            response.headers.get("content-type") ?? "application/octet-stream",
        },
      };
    } catch {
      // 끝에서 hash·크기가 어긋나면 core가 응답을 끊는다. 받은 조각은 쓰지 않는다.
      return lost();
    }
  }

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
    const raw = await drain(response.body, 64 * 1024).catch(
      () => "too_large" as const,
    );
    let json: unknown;
    try {
      json =
        raw === "too_large"
          ? undefined
          : JSON.parse(new TextDecoder().decode(raw));
    } catch {
      json = undefined;
    }
    const output = (
      route.output as {
        safeParse(value: unknown): {
          success: boolean;
          data?: unknown;
        };
      }
    ).safeParse(json);
    if (!output.success) {
      return {
        ok: false,
        error: { code: "internal", message: "internal error" },
      };
    }
    return { ok: true, value: output.data };
  }
}
