// 요청 하나와 step 기대값 비교. 인증 header는 값 대신 존재와 종류만 본다.
import { isSecretKey, same, sha256 } from "./normalize.ts";
import type { Expectation, LoggedHeader } from "./types.ts";

export type Incoming = {
  method: string;
  path: string;
  headers: Record<string, string>;
  body: unknown;
};

export type MatchResult = { ok: true } | { ok: false; detail: string };

function headerKind(name: string, value: string): LoggedHeader["kind"] {
  if (name === "authorization") {
    return value.toLowerCase().startsWith("bearer ") ? "bearer" : "other";
  }
  if (name === "x-api-key") return "api_key";
  return "other";
}

export async function loggedHeaders(
  headers: Record<string, string>,
): Promise<LoggedHeader[]> {
  return await Promise.all(
    Object.keys(headers).sort().map(async (name) => {
      const value = headers[name];
      if (isSecretKey(name)) {
        return { name, present: true as const, kind: headerKind(name, value) };
      }
      // hash는 UA 동일 단언도 가능하게 하면서 URL/header 원문을 남기지 않는다.
      return {
        name,
        present: true as const,
        value: `sha256:${await sha256(value)}`,
      };
    }),
  );
}

function expectedHeader(
  name: string,
  expected: string,
  actual: string,
): boolean {
  if (!isSecretKey(name)) {
    return actual === expected;
  }
  if (expected === "bearer") return actual.toLowerCase().startsWith("bearer ");
  if (expected === "api_key") return name === "x-api-key" && actual.length > 0;
  return actual.length > 0;
}

export function matches(
  expect: Expectation | undefined,
  request: Incoming,
): MatchResult {
  if (!expect) return { ok: true };
  if (expect.method && request.method !== expect.method.toUpperCase()) {
    return { ok: false, detail: `method ${request.method}` };
  }
  if (expect.path && request.path !== expect.path) {
    return { ok: false, detail: "path" };
  }
  for (const [name, expected] of Object.entries(expect.headers ?? {})) {
    const actual = request.headers[name.toLowerCase()];
    if (
      actual === undefined ||
      !expectedHeader(name.toLowerCase(), expected, actual)
    ) {
      return { ok: false, detail: `header ${name.toLowerCase()}` };
    }
  }
  if (expect.body !== undefined && !same(expect.body, request.body)) {
    return { ok: false, detail: "body" };
  }
  return { ok: true };
}
