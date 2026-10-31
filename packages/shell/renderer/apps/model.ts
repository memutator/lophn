import type { AppRow } from "./source.ts";

/** 보관하지 않은 앱을 먼저, 그 안에서는 사람이 지은 이름 순서다. */
export function sortApps(rows: readonly AppRow[]): AppRow[] {
  return [...rows].sort(
    (a, b) =>
      Number(a.archived) - Number(b.archived) ||
      a.name.localeCompare(b.name, "en") ||
      a.id.localeCompare(b.id),
  );
}
