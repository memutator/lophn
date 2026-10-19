import { type Row, valueAt } from "./fields.ts";

function rank(value: unknown): number {
  if (value === null || value === undefined) return 3;
  if (typeof value === "number") return 0;
  if (typeof value === "string") return 1;
  return 2;
}

// 오름차순 비교. number는 값, 문자열은 code unit 순이다. null은 부르는 쪽이 따로 다룬다.
export function compareValues(a: unknown, b: unknown): number {
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

const compareText = (a: string, b: string): number =>
  a < b ? -1 : a > b ? 1 : 0;

// 같으면 key, path 순이다.
export function sortRows(
  rows: readonly Row[],
  sort: readonly { field: string; dir: "asc" | "desc" }[],
): Row[] {
  return [...rows].sort((a, b) => {
    for (const key of sort) {
      const c = compareDirected(
        valueAt(a, key.field),
        valueAt(b, key.field),
        key.dir === "desc",
      );
      if (c !== 0) return c;
    }
    return compareText(a.key, b.key) || compareText(a.path, b.path);
  });
}
