// 검색 결과 화면의 순수 규칙: 열 값 읽기, 개체 링크 경로, 개수 글, board 열 나누기, page 번호 줄임.
// React와 DOM을 모른다.
import type { DeclaredSearch, SearchRow } from "./source.ts";

export type ResultColumn = DeclaredSearch["result"]["columns"][number];

/** 칸에 적을 글. 목록은 쉼표로 잇고 없는 값은 빈 글이다. */
export function cellText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(cellText).join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function valueOf(row: SearchRow, path: string): string {
  return path === "key" ? row.key : cellText(row.values[path]);
}

/** `key`와 `별칭.key` 열은 개체 이름이다. 그 밖의 열은 값일 뿐이다. */
export function isObjectColumn(column: ResultColumn): boolean {
  return column.path === "key" || column.path.endsWith(".key");
}

/**
 * 개체 이름 열이 가리키는 문서 경로(project 폴더 기준). `key`는 줄 자신의 path이고
 * `별칭.key`는 같은 줄의 `별칭.path` 값이다. 모르면 undefined.
 */
export function documentPath(
  row: SearchRow,
  column: ResultColumn,
): string | undefined {
  if (column.path === "key") return row.path;
  const path = row.values[`${column.path.slice(0, -".key".length)}.path`];
  return typeof path === "string" && path !== "" ? path : undefined;
}

function plural(word: string): string {
  if (/[^aeiou]y$/.test(word)) return `${word.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/.test(word)) return `${word}es`;
  return `${word}s`;
}

/** 결과 개수 글에 쓰는 개체 이름: 선언의 from type을 소문자로 한 단수와 복수. */
export function nouns(search: DeclaredSearch): {
  readonly singular: string;
  readonly plural: string;
} {
  const singular = search.query.from.toLowerCase();
  return { singular, plural: plural(singular) };
}

/** 지금 보는 범위. 줄이 없으면 null. */
export function visibleRange(
  page: number,
  pageSize: number,
  count: number,
  total: number,
): { readonly from: number; readonly to: number } | null {
  if (count === 0) return null;
  const from = page * pageSize + 1;
  return { from, to: Math.min(total, from - 1 + count) };
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/** 보일 page 번호(0부터)와 줄임(null). 처음·끝·지금 둘레 두 개만 보인다. */
export function pageNumbers(
  page: number,
  pages: number,
): readonly (number | null)[] {
  const keep = new Set<number>([0, pages - 1]);
  for (let at = page - 2; at <= page + 2; at += 1) {
    if (at >= 0 && at < pages) keep.add(at);
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((at, index) => {
    const before = sorted[index - 1];
    if (before !== undefined && at - before > 1) {
      if (at - before === 2) out.push(before + 1);
      else out.push(null);
    }
    out.push(at);
  });
  return out;
}

export interface BoardLane {
  readonly value: string;
  readonly rows: readonly SearchRow[];
}

/** board_by 값마다 한 열. 값은 처음 나온 순서이고 열 안은 줄 순서다. */
export function boardLanes(
  rows: readonly SearchRow[],
  boardBy: string,
): readonly BoardLane[] {
  const lanes = new Map<string, SearchRow[]>();
  for (const row of rows) {
    const value = valueOf(row, boardBy);
    const lane = lanes.get(value);
    if (lane === undefined) lanes.set(value, [row]);
    else lane.push(row);
  }
  return [...lanes].map(([value, laneRows]) => ({ value, rows: laneRows }));
}

export function capitalize(text: string): string {
  return text === "" ? text : text[0]!.toUpperCase() + text.slice(1);
}

/** 카드 아래 줄의 한 조각: 숫자 값은 열 이름을 붙이고("6 scenarios") 글 값은 그대로 보인다. */
export function metaPiece(row: SearchRow, column: ResultColumn): string {
  const raw = row.values[column.path];
  const text = cellText(raw);
  if (text === "") return "";
  if (typeof raw !== "number") return text;
  const label = column.label.toLowerCase();
  return `${text} ${
    raw === 1 && label.endsWith("s") ? label.slice(0, -1) : label
  }`;
}
