import { err, ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../protocol/lophn-agent/mod.ts";
import {
  decodeWindowCursor,
  encodeWindowCursor,
  fitJson,
  PAGE_SIZE,
  type WindowCursor,
} from "../result.ts";
import type { RunCredential } from "../work.ts";
import type { ContractCall } from "./common.ts";

// 목록·검색·이력·검사 진단의 이어 보기. 소유 contract의 cursor를 조건과 함께 감싼다.

export function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// 이어 보기 위치. 조건이 다른 목록에서 온 cursor는 거절한다.
export function resume(
  given: string | undefined,
  scope: string,
): Result<WindowCursor | null> {
  if (given === undefined) return ok(null);
  const decoded = decodeWindowCursor(given);
  if (decoded === null || decoded.scope !== scope) {
    return invalid("cursor does not belong to this request");
  }
  return ok(decoded);
}

export function wrap(
  scope: string,
  inner: string | null | undefined,
  skip: number,
): string | null {
  return inner === null || inner === undefined
    ? skip > 0 ? encodeWindowCursor({ inner: null, skip, scope }) : null
    : encodeWindowCursor({ inner, skip, scope });
}

export function continuation(next: string | null): ToolResult["continuation"] {
  return next === null ? null : { has_more: true, read_next: next };
}

export function scopeOf(
  tool: string,
  fixed: Record<string, unknown>,
): string {
  return JSON.stringify([tool, fixed]);
}

export type Body = Record<string, unknown> & {
  next_cursor?: string | null;
  as_of_seq?: string;
};

export function bodyOf(value: unknown): Body {
  return (value ?? {}) as Body;
}

// 목록·검색·이력의 한 page. 앞 20개만 보이고, 소유 contract가 더 줬거나 상한에 걸려 덜어 낸
// 항목은 같은 page의 뒤 위치(skip)에서 이어 읽는다. 항목을 잃지 않는다.
export function windowedResult(
  summary: string,
  scope: string,
  key: string,
  items: readonly unknown[],
  skip: number,
  inner: string | null,
  body: Body,
  extra: Record<string, unknown>,
): ToolResult {
  const view = items.slice(skip, skip + PAGE_SIZE);
  const fitted = fitJson({ ...extra, [key]: view }, [key]);
  const kept = fitted.content === null
    ? 0
    : ((fitted.content as Record<string, unknown>)[key] as unknown[]).length;
  const consumed = skip + kept;
  const next = consumed < items.length
    ? wrap(scope, inner, consumed)
    : body.next_cursor === null || body.next_cursor === undefined
    ? null
    : wrap(scope, body.next_cursor, 0);
  return {
    status: "success",
    summary,
    content: fitted.content as ToolResult["content"],
    complete: fitted.complete && next === null,
    source: null,
    continuation: continuation(next),
    pending: [],
  };
}

// 목차·차이·용어처럼 소유 contract가 쪽을 정하는 읽기다. cursor만 조건과 함께 감싸고, 상한을 넘으면
// 지정한 배열 키의 뒤쪽 항목부터 덜어 낸다. `shape`가 있으면 소유 contract의 결과에서 보일 값만 고른다.
export async function pageThrough(
  ports: ContractCall,
  summary: string,
  contract: string,
  scope: string,
  given: string | undefined,
  fixed: Record<string, unknown>,
  arrayKeys: readonly string[],
  credential: RunCredential,
  shape?: (body: Body) => Record<string, unknown>,
): Promise<Result<ToolResult>> {
  const resumed = resume(given, scope);
  if (!resumed.ok) return resumed;
  const inner = resumed.value?.inner ?? null;
  const read = await ports.call(contract, {
    ...fixed,
    ...(inner === null ? {} : { cursor: inner }),
  }, credential.run);
  if (!read.ok) return read;
  const body = bodyOf(read.value);
  const { next_cursor: nextInner, ...rest } = body;
  const fitted = fitJson(shape === undefined ? rest : shape(rest), arrayKeys);
  const next = nextInner === null || nextInner === undefined
    ? null
    : wrap(scope, nextInner, 0);
  return ok({
    status: "success",
    summary,
    content: fitted.content as ToolResult["content"],
    complete: fitted.complete && next === null,
    source: null,
    continuation: continuation(next),
    pending: [],
  });
}
