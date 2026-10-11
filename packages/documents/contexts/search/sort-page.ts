// 행 순서와 table page.
import type { SearchQuery } from "../../../contracts/documents/mod.ts";
import type { Row, SearchError } from "./types.ts";

// fromIsSeries: 시작 type의 source가 series인지(기본 순서가 추출 순서인지 key 순서인지 정한다).
export function sortRows(
  rows: readonly Row[],
  _query: SearchQuery,
  _fromIsSeries: boolean,
): Row[] {
  return [...rows];
}

// fingerprint는 (검색 이름, 입력)의 지문이다. 다른 지문의 cursor는 cursor_mismatch다.
export function paginate<T>(
  _items: readonly T[],
  _pageSize: number,
  _cursor: string | null,
  _fingerprint: string,
):
  | { ok: true; items: T[]; total: number; next_cursor: string | null }
  | { ok: false; error: SearchError } {
  return { ok: true, items: [], total: 0, next_cursor: null };
}
