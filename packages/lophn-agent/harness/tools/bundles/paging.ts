import { err, ok, type Result } from "../../../../base/mod.ts";
import type { ToolResult } from "../../../../contracts/lophn-agent/mod.ts";
import {
  decodeWindowCursor,
  encodeWindowCursor,
  fitJson,
  PAGE_SIZE,
  type WindowCursor,
} from "../result.ts";

// 목록·검색·이력·검사 진단의 이어 보기. 소유 contract의 cursor를 조건과 함께 감싼다(R13).

export function invalid(message: string): Result<never> {
  return err({ code: "invalid_input", message });
}

// 이어 보기 위치. 조건이 다른 목록에서 온 cursor는 거절한다(R13).
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
// 항목은 같은 page의 뒤 위치(skip)에서 이어 읽는다. 항목을 잃지 않는다(R13, R14).
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
