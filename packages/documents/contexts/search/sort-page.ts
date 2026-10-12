// 행 순서와 table page.
import type { SearchQuery } from "../../../contracts/documents/mod.ts";
import { valueAt } from "./row.ts";
import type { Row, SearchError } from "./types.ts";

function rank(value: unknown): number {
  if (value === null || value === undefined) return 3;
  if (typeof value === "number") return 0;
  if (typeof value === "string") return 1;
  return 2;
}

// 오름차순 비교. null은 부르는 쪽이 따로 다룬다. number는 값, 문자열은 code unit 순이다.
function compareValues(a: unknown, b: unknown): number {
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra - rb;
  const x = ra === 2 ? JSON.stringify(a) : (a as number | string);
  const y = rb === 2 ? JSON.stringify(b) : (b as number | string);
  return x < y ? -1 : x > y ? 1 : 0;
}

// null은 방향과 상관없이 마지막이다.
function compareDirected(a: unknown, b: unknown, desc: boolean): number {
  const aNull = rank(a) === 3;
  const bNull = rank(b) === 3;
  if (aNull || bNull) return aNull === bNull ? 0 : aNull ? 1 : -1;
  const c = compareValues(a, b);
  return desc ? -c : c;
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function aliasIndices(row: Row): number[] {
  return Object.values(row.aliases).map((a) => a.index);
}

function tieBreak(a: Row, b: Row): number {
  const byKey = compareText(a.base.key, b.base.key);
  if (byKey !== 0) return byKey;
  const byPath = compareText(a.base.path, b.base.path);
  if (byPath !== 0) return byPath;
  const ia = aliasIndices(a);
  const ib = aliasIndices(b);
  for (let i = 0; i < Math.min(ia.length, ib.length); i++) {
    if (ia[i] !== ib[i]) return ia[i] - ib[i];
  }
  return ia.length - ib.length;
}

// fromIsSeries: 시작 type의 source가 series인지(기본 순서가 추출 순서인지 key 순서인지 정한다).
export function sortRows(
  rows: readonly Row[],
  query: SearchQuery,
  fromIsSeries: boolean,
): Row[] {
  const keys = query.sort ?? [];
  const group = query.group?.by;
  return [...rows].sort((a, b) => {
    if (group !== undefined) {
      const c = compareDirected(valueAt(a, group), valueAt(b, group), false);
      if (c !== 0) return c;
    }
    for (const key of keys) {
      const c = compareDirected(
        valueAt(a, key.path),
        valueAt(b, key.path),
        key.dir === "desc",
      );
      if (c !== 0) return c;
    }
    if (keys.length === 0) {
      const c = fromIsSeries
        ? a.base_index - b.base_index
        : compareText(a.base.key, b.base.key);
      if (c !== 0) return c;
    }
    return tieBreak(a, b);
  });
}

function encodeCursor(offset: number, fingerprint: string): string {
  return `${offset}:${fingerprint}`;
}

function decodeCursor(cursor: string, fingerprint: string): number | null {
  const match = /^(\d+):([\s\S]*)$/.exec(cursor);
  if (match === null || match[2] !== fingerprint) return null;
  const offset = Number(match[1]);
  return Number.isSafeInteger(offset) ? offset : null;
}

// fingerprint는 (검색 이름, 입력)의 지문이다. 다른 지문의 cursor는 cursor_mismatch다.
export function paginate<T>(
  items: readonly T[],
  pageSize: number,
  cursor: string | null,
  fingerprint: string,
):
  | { ok: true; items: T[]; total: number; next_cursor: string | null }
  | { ok: false; error: SearchError } {
  let offset = 0;
  if (cursor !== null) {
    const decoded = decodeCursor(cursor, fingerprint);
    if (decoded === null || decoded > items.length) {
      return { ok: false, error: { code: "cursor_mismatch" } };
    }
    offset = decoded;
  }
  const end = offset + pageSize;
  return {
    ok: true,
    items: items.slice(offset, end),
    total: items.length,
    next_cursor: end < items.length ? encodeCursor(end, fingerprint) : null,
  };
}
