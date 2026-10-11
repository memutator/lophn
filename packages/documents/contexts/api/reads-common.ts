// context API 읽기가 같이 쓰는 것: 요청한 쪽 검사, 읽기 공통 필드, 순서 비교, cursor.
import { canonicalize, err, ok, type Result } from "../../../base/mod.ts";
import {
  type BundleContent,
  bundleContentSchema,
  CONTEXT_PAGE_DEFAULT,
  CONTEXT_PAGE_MAX,
} from "../../../contracts/documents/mod.ts";
import type { BundleRow, ContextApiActor, ContextApiState } from "./state.ts";

// 읽기는 user와 lophn agent(역할 무관)만 한다. coding agent와 machine에게는 통로가 없다.
export function checkReader(actor: ContextApiActor): Result<true> {
  if (actor.kind === "user" || actor.kind === "agent") return ok(true);
  return err({
    code: "forbidden",
    message: `${actor.kind} cannot read contexts`,
  });
}

export const notFound = (what: string, id: string) =>
  err({ code: "not_found" as const, message: `${what} ${id} not found` });

export const invalidInput = (message: string) =>
  err({ code: "invalid_input" as const, message });

// 모든 읽기 결과가 가진 공통 필드. page가 없는 읽기는 next_cursor가 null이다.
export function common(state: ContextApiState): {
  as_of_seq: string;
  next_cursor: null;
} {
  return { as_of_seq: String(state.seq), next_cursor: null };
}

// ---------- 순서 ----------

// JS 문자열 비교는 UTF-16 code unit 순이다.
export function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export type KeyPart = string | number;
export type Key = readonly KeyPart[];

export function compareKey(a: Key, b: Key): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const left = a[i]!;
    const right = b[i]!;
    const diff = typeof left === "number" && typeof right === "number"
      ? left - right
      : compareText(String(left), String(right));
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return a.length - b.length;
}

// ---------- cursor ----------

// cursor는 호출의 scope(어느 읽기·대상·조건인지)와 이어 볼 자리를 담은 불투명 문자열이다.
export function encodeCursor(payload: unknown): string {
  return btoa(encodeURIComponent(canonicalize(payload)));
}

export function decodeCursor(cursor: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(decodeURIComponent(atob(cursor)));
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function pageLimit(limit: number | undefined): Result<number> {
  if (limit === undefined) return ok(CONTEXT_PAGE_DEFAULT);
  if (!Number.isInteger(limit) || limit < 1 || limit > CONTEXT_PAGE_MAX) {
    return invalidInput(`limit must be 1-${CONTEXT_PAGE_MAX}`);
  }
  return ok(limit);
}

export type KeyedPage<T> = {
  items: T[];
  complete: boolean;
  next_cursor: string | null;
};

// 정렬이 끝난 목록을 마지막으로 본 항목의 key 뒤부터 limit개 자른다. 사이에 항목이 생기거나 사라져도
// 빠지거나 겹치지 않는다.
export function pageByKey<T>(
  sorted: readonly T[],
  keyOf: (item: T) => Key,
  scope: string,
  call: { cursor?: string; limit?: number },
): Result<KeyedPage<T>> {
  const limit = pageLimit(call.limit);
  if (!limit.ok) return limit;
  let start = 0;
  if (call.cursor !== undefined) {
    const payload = decodeCursor(call.cursor);
    if (
      payload === null || payload.scope !== scope ||
      !Array.isArray(payload.after) ||
      !payload.after.every((part) =>
        typeof part === "string" || typeof part === "number"
      )
    ) {
      return invalidInput("cursor does not belong to this read");
    }
    const after = payload.after as Key;
    const found = sorted.findIndex((item) =>
      compareKey(keyOf(item), after) > 0
    );
    start = found < 0 ? sorted.length : found;
  }
  const items = sorted.slice(start, start + limit.value);
  const complete = start + items.length >= sorted.length;
  return ok({
    items,
    complete,
    next_cursor: complete
      ? null
      : encodeCursor({ scope, after: keyOf(items[items.length - 1]!) }),
  });
}

// ---------- 판 ----------

export function appliedBundleOf(
  state: ContextApiState,
  context: { applied_bundle: string | null },
): BundleRow | null {
  return context.applied_bundle === null
    ? null
    : state.bundles.get(context.applied_bundle) ?? null;
}

// 저장된 content는 submit이 검사했으므로 읽기에서는 기본값을 채워 모양만 얻는다.
export function parseContent(row: BundleRow): Result<BundleContent> {
  const parsed = bundleContentSchema.safeParse(row.content);
  return parsed.success ? ok(parsed.data) : err({
    code: "unavailable",
    message: `bundle ${row.id} content cannot be read`,
  });
}
