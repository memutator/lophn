// roles 통로가 core를 부르는 공통 길. 응답은 main의 contract client가 route output schema로 이미 검사했다.
import type { CoreCall } from "../../../../ipc/core.ts";
import type { CoreSource } from "../../connection/connection.ts";
import type { SourceResult } from "./source.ts";

export interface Page {
  next_cursor: string | null;
}

/** 목록을 끝까지 모을 때 page 상한. 넘으면 모은 것까지만 보인다. */
const PAGE_LIMIT = 20;

export async function call<T>(
  core: CoreSource,
  kind: CoreCall["kind"],
  resource: string,
  method: string,
  body: unknown,
): Promise<SourceResult<T>> {
  try {
    const reply = await core.call({ kind, resource, method, body });
    if (!reply.ok) return { ok: false, code: reply.error?.code ?? "internal" };
    return { ok: true, value: reply.value as T };
  } catch {
    return { ok: false, code: "unavailable" };
  }
}

export function command<T>(
  core: CoreSource,
  resource: string,
  method: string,
  body: { input: unknown; compare?: unknown; key: string },
): Promise<SourceResult<T>> {
  return call<T>(core, "command", resource, method, {
    input: body.input,
    idempotency_key: body.key,
    ...(body.compare === undefined ? {} : { compare: body.compare }),
    prepared: [],
  });
}

export async function pages<T, V extends Page>(
  core: CoreSource,
  resource: string,
  method: string,
  input: Record<string, unknown>,
  rows: (value: V) => readonly T[],
): Promise<SourceResult<readonly T[]>> {
  const found: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < PAGE_LIMIT; page += 1) {
    const result: SourceResult<V> = await call<V>(
      core,
      "read",
      resource,
      method,
      cursor === null ? input : { ...input, cursor },
    );
    if (!result.ok) return result;
    found.push(...rows(result.value));
    cursor = result.value.next_cursor;
    if (cursor === null) break;
  }
  return { ok: true, value: found };
}
