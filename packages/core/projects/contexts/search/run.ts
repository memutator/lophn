// 선언 검색 하나를 실행한다: 입력 → follow → 조건 → 순서 → table page 또는 board.
import { toBoard } from "./board.ts";
import { resolveInputs } from "./inputs.ts";
import { expandFollows } from "./relations.ts";
import { refAt, refOf, valueAt } from "./row.ts";
import { fingerprintOf } from "./run-fingerprint.ts";
import { paginate, sortRows } from "./sort-page.ts";
import type { ResultRow, RunSearchArgs, SearchResult } from "./types.ts";
import { evaluate } from "./where.ts";

export function runSearch(args: RunSearchArgs): SearchResult {
  const { bundle, entities } = args;
  const search = bundle.searches.find((s) => s.name === args.search);
  if (search === undefined) {
    return { ok: false, error: { code: "search_unknown" } };
  }
  const resolved = resolveInputs(search, args.inputs);
  if (!resolved.ok) return resolved;
  const inputs = resolved.inputs;
  const { query, result: view } = search;

  const where = query.where;
  const rows = expandFollows(query, bundle.contract, entities, inputs).filter(
    (row) => where == null || evaluate(where, row, inputs),
  );
  const fromIsSeries = bundle.contract.types.find((t) => t.name === query.from)
    ?.source.kind === "series";
  const sorted = sortRows(rows, query, fromIsSeries);

  if (view.kind === "board") {
    return {
      ok: true,
      result: toBoard(sorted, query, view, bundle.contract),
    };
  }

  const page = paginate(
    sorted,
    view.page_size,
    args.cursor ?? null,
    fingerprintOf(search.name, inputs),
  );
  if (!page.ok) return page;
  const groupBy = query.group?.by;
  const resultRows: ResultRow[] = page.items.map((row) => {
    const out: ResultRow = {
      ref: refOf(row.base),
      cells: view.columns.map((column) => ({
        path: column.path,
        value: valueAt(row, column.path),
        ref: refAt(row, column.path),
      })),
    };
    if (groupBy !== undefined) out.group = valueAt(row, groupBy);
    return out;
  });
  return {
    ok: true,
    result: {
      kind: "table",
      rows: resultRows,
      total: page.total,
      next_cursor: page.next_cursor,
    },
  };
}
