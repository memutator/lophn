// board 결과: board_by 값마다 lane.
import type {
  Contract,
  ResultView,
  SearchQuery,
} from "../../../contracts/documents/mod.ts";
import { compareValues, declaredValues } from "./board-lanes.ts";
import { refAt, refOf, valueAt } from "./row.ts";
import type { BoardLane, BoardResult, ResultRow, Row } from "./types.ts";

// rows는 이미 정렬되어 있다. lane 안에서 그 순서를 지킨다.
export function toBoard(
  rows: readonly Row[],
  query: SearchQuery,
  view: ResultView,
  contract: Contract,
): BoardResult {
  const by = view.board_by ?? "";
  const groups = new Map<string, { value: unknown; rows: ResultRow[] }>();
  for (const row of rows) {
    const value = valueAt(row, by);
    const id = JSON.stringify(value);
    let group = groups.get(id);
    if (group === undefined) {
      group = { value, rows: [] };
      groups.set(id, group);
    }
    group.rows.push({
      ref: refOf(row.base),
      cells: view.columns.map((c) => ({
        path: c.path,
        value: valueAt(row, c.path),
        ref: refAt(row, c.path),
      })),
    });
  }

  const declared = declaredValues(contract, query, by) ?? [];
  const nullGroup = groups.get("null");
  const others = [...groups.values()]
    .filter((g) => g.value !== null && !declared.includes(g.value as string))
    .sort((a, b) => compareValues(a.value, b.value));
  const ordered: { value: unknown; rows: ResultRow[] }[] = [
    ...declared.map((value) =>
      groups.get(JSON.stringify(value)) ?? { value, rows: [] }
    ),
    ...others,
    ...(nullGroup === undefined ? [] : [nullGroup]),
  ];

  const lanes: BoardLane[] = ordered.map((g) => ({
    value: g.value,
    rows: g.rows.slice(0, view.page_size),
    more: Math.max(0, g.rows.length - view.page_size),
  }));
  return { kind: "board", lanes, total: rows.length };
}
