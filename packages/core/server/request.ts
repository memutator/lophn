import {
  asInternalError,
  err,
  type LophnError,
  ok,
  type Result,
} from "../../base/mod.ts";
import {
  API_MAJOR,
  type AuthenticatedContext,
  DEFAULT_API_PORT,
  ERROR_HTTP_STATUS,
  type ErrorBody,
  HEADER_MAX_BYTES,
  RPC_JSON_MAX_BYTES,
  RPC_JSON_MAX_DEPTH,
  RPC_JSON_MAX_ITEMS,
} from "../../protocol/platform/mod.ts";
import type { CredentialRegistry } from "./identity/mod.ts";

// body를 읽기 전의 고정 한도(platform/security#R8, architecture/platform 2.3).
export const BODY_TIMEOUT_MS = 5_000;
export const JSON_MAX_BYTES = RPC_JSON_MAX_BYTES;
export const JSON_MAX_DEPTH = RPC_JSON_MAX_DEPTH;
export const JSON_MAX_ITEMS = RPC_JSON_MAX_ITEMS;
export const MAX_HEADER_BYTES = HEADER_MAX_BYTES;

const encoder = new TextEncoder();

export type RequestFailure = { status: number; error: LophnError };

export function failure(error: LophnError): RequestFailure {
  return { status: ERROR_HTTP_STATUS[error.code], error };
}

export function errorBody(error: LophnError): ErrorBody {
  const body: ErrorBody = {
    error: { code: error.code, message: error.message },
  };
  if (error.details !== undefined) body.error.details = error.details;
  return body;
}

// handler가 던진 것은 경계에서 internal로 바꾼다. stack·원문·token은 없다(platform/api#R4).
export function safeError(thrown: unknown): LophnError {
  return asInternalError(thrown);
}

// 실제 bind port P의 allowlist. proxy header는 보지 않는다(platform/identity#R12).
export function allowedHosts(port: number): ReadonlySet<string> {
  return new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]);
}

export function defaultPort(): number {
  return DEFAULT_API_PORT;
}

export function apiMajor(): number {
  return API_MAJOR;
}

export type GateInput = {
  url: string;
  origin: string | null;
  authorization: string | null;
  port: number;
};

export type GateDecision =
  | { ok: true; context: AuthenticatedContext }
  | { ok: false; failure: RequestFailure };

// Deno는 클라이언트가 보낸 Host를 요청 URL authority로 바꾼다. header는 그대로 두지 않는다.
export function hostOf(url: string): string | null {
  try {
    return new URL(url).host || null;
  } catch {
    return null;
  }
}

// 검사 순서는 Host → Origin → Bearer다. 동작 자격은 route를 안 뒤에 본다(platform/identity#R13).
export async function gateRequest(
  input: GateInput,
  credentials: CredentialRegistry,
): Promise<GateDecision> {
  const host = hostOf(input.url);
  if (!host || !allowedHosts(input.port).has(host)) {
    return {
      ok: false,
      failure: failure({
        code: "invalid_input",
        message: "host not allowed",
      }),
    };
  }
  if (input.origin !== null) {
    return {
      ok: false,
      failure: failure({
        code: "forbidden",
        message: "origin not allowed",
      }),
    };
  }
  const bearer = bearerToken(input.authorization);
  if (!bearer) {
    return {
      ok: false,
      failure: failure({
        code: "unauthorized",
        message: "credential required",
      }),
    };
  }
  const authenticated = await credentials.authenticate(bearer);
  if (!authenticated.ok) {
    return { ok: false, failure: failure(authenticated.error) };
  }
  return { ok: true, context: authenticated.value };
}

// "Bearer <token>"만 받는다. query·cookie는 여기 오기 전에 없다.
function bearerToken(header: string | null): string | undefined {
  if (!header) return undefined;
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header);
  return match?.[1];
}

export type BodyLimit = {
  maxBytes: number;
  timeoutMs: number;
};

// Content-Length는 읽기 전에, chunked는 누적 bytes로 상한을 넘기 전에 끊는다.
export async function readLimitedBody(
  request: Request,
  limit: BodyLimit,
): Promise<Result<Uint8Array, RequestFailure>> {
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    if (!/^\d+$/.test(declared) || Number(declared) > limit.maxBytes) {
      return err(failure({
        code: "invalid_input",
        message: "body exceeds limit",
      }));
    }
  }
  const body = request.body;
  if (!body) return ok(new Uint8Array());
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<Result<Uint8Array, RequestFailure>>((resolve) => {
    timer = setTimeout(() => {
      resolve(err(failure({
        code: "invalid_input",
        message: "body read timed out",
      })));
      try {
        void reader.cancel();
      } catch { /* already closed */ }
    }, limit.timeoutMs);
  });
  const read = (async (): Promise<Result<Uint8Array, RequestFailure>> => {
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        total += next.value.byteLength;
        if (total > limit.maxBytes) {
          return err(failure({
            code: "invalid_input",
            message: "body exceeds limit",
          }));
        }
        chunks.push(next.value);
      }
    } catch {
      // 선언 길이와 실제 stream이 다르면 Deno가 읽기를 끊는다. 그것도 한도 거절이다.
      return err(failure({
        code: "invalid_input",
        message: "body exceeds limit",
      }));
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return ok(bytes);
  })();
  const result = await Promise.race([read, timeout]);
  if (timer !== undefined) clearTimeout(timer);
  return result;
}

export type ParsedJson = { value: unknown };

// 깊이 16, object/array 항목 4,096. 읽은 bytes 위에서만 센다.
export function parseLimitedJson(
  bytes: Uint8Array,
): Result<unknown, RequestFailure> {
  if (bytes.byteLength > JSON_MAX_BYTES) {
    return err(failure({
      code: "invalid_input",
      message: "body exceeds limit",
    }));
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return err(failure({
      code: "invalid_input",
      message: "invalid json",
    }));
  }
  const counted = countJson(value);
  if (!counted.ok) return counted;
  return ok(value);
}

function countJson(value: unknown): Result<void, RequestFailure> {
  return walk(value, 1, { items: 0 });
}

function walk(
  value: unknown,
  depth: number,
  state: { items: number },
): Result<void, RequestFailure> {
  if (depth > JSON_MAX_DEPTH) {
    return err(failure({
      code: "invalid_input",
      message: "json too deep",
    }));
  }
  if (Array.isArray(value)) {
    state.items += value.length;
    if (state.items > JSON_MAX_ITEMS) {
      return err(failure({
        code: "invalid_input",
        message: "json too large",
      }));
    }
    for (const item of value) {
      const child = walk(item, depth + 1, state);
      if (!child.ok) return child;
    }
    return ok(undefined);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value);
    state.items += entries.length;
    if (state.items > JSON_MAX_ITEMS) {
      return err(failure({
        code: "invalid_input",
        message: "json too large",
      }));
    }
    for (const [, child] of entries) {
      const walked = walk(child, depth + 1, state);
      if (!walked.ok) return walked;
    }
  }
  return ok(undefined);
}

export function headerBytes(request: Request): number {
  let total = encoder.encode(
    `${request.method} ${new URL(request.url).pathname} HTTP/1.1\r\n`,
  ).byteLength;
  request.headers.forEach((value, name) => {
    total += encoder.encode(`${name}: ${value}\r\n`).byteLength;
  });
  return total;
}

export function contentTypeJson(request: Request): boolean {
  const type = request.headers.get("content-type");
  if (!type) return false;
  return type.split(";", 1)[0].trim().toLowerCase() === "application/json";
}
