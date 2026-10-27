import { err, ok, type Result } from "../../../../base/mod.ts";
import type { z } from "zod";
import type {
  Kind,
  kindCheck,
  KindCheckQuery,
  kindList,
  KindListQuery,
} from "../../../../protocol/projects/mod.ts";
import type { Sql } from "../../../../protocol/server/mod.ts";
import { countSkipped, readItems, readViolations } from "../index/store.ts";
import { aggregateRows } from "./aggregate.ts";
import { fieldInfos, type Row, valueAt } from "./fields.ts";
import { DEFAULT_LIMIT, fingerprintOf, paginate } from "./page.ts";
import { sortRows } from "./sort.ts";
import { conditionFields, evaluate } from "./where.ts";

type ListOutput = z.infer<typeof kindList.output>;
type CheckViolations = Pick<
  z.infer<typeof kindCheck.output>,
  "violations" | "total" | "next_cursor"
>;

const invalid = (message: string): Result<never> =>
  err({ code: "invalid_input", message });

// reason은 skipped 수가 무엇을 센 것인지 알려 주는 고정 글이다.
const SKIPPED_REASON =
  "documents that could not be read or have a wrong field type";

export function listItems(
  sql: Sql,
  domain: string,
  kinds: readonly Kind[],
  query: KindListQuery,
): Result<ListOutput> {
  const kind = kinds.find((candidate) => candidate.name === query.kind);
  if (kind === undefined) return invalid(`unknown kind ${query.kind}`);
  const infos = fieldInfos(kind);
  const referenced = [
    ...(query.where === undefined ? [] : conditionFields(query.where)),
    ...(query.sort ?? []).map((key) => key.field),
    ...(query.fields ?? []),
    ...(query.group_by === undefined ? [] : [query.group_by]),
  ];
  const unknown = referenced.find((field) => !infos.has(field));
  if (unknown !== undefined) return invalid(`unknown field ${unknown}`);

  const rows: Row[] = readItems(sql, domain, kind.name);
  const matched =
    query.where === undefined
      ? rows
      : rows.filter((row) => evaluate(query.where!, row));
  const skipped = {
    count: countSkipped(sql, domain, kind.name),
    reason: SKIPPED_REASON,
  };

  if (query.aggregate !== undefined) {
    const groups = aggregateRows(
      matched,
      query.aggregate,
      query.group_by,
      infos,
    );
    if (!groups.ok) return groups;
    return ok({
      kind: kind.name,
      mode: "aggregate",
      groups: groups.value as Extract<
        ListOutput,
        { mode: "aggregate" }
      >["groups"],
      total: matched.length,
      skipped,
    });
  }

  const fingerprint = fingerprintOf([
    kind.name,
    query.where ?? null,
    query.sort ?? null,
  ]);
  const page = paginate(
    sortRows(matched, query.sort ?? []),
    query.limit ?? DEFAULT_LIMIT,
    query.cursor,
    fingerprint,
  );
  if (page === null) return invalid("cursor does not belong to this query");
  const wanted = query.fields ?? Object.keys(kind.fields);
  return ok({
    kind: kind.name,
    mode: "items",
    items: page.items.map((row) => ({
      key: row.key,
      path: row.path,
      fields: Object.fromEntries(
        wanted.map((field) => [field, valueAt(row, field)]),
      ) as Record<string, never>,
    })),
    total: matched.length,
    next_cursor: page.next_cursor,
    skipped,
  });
}

export function listViolations(
  sql: Sql,
  domain: string,
  query: KindCheckQuery,
): Result<CheckViolations> {
  const all = readViolations(sql, domain, { kind: query.kind });
  const page = paginate(
    all,
    query.limit ?? DEFAULT_LIMIT,
    query.cursor,
    fingerprintOf([query.kind ?? null]),
  );
  if (page === null) return invalid("cursor does not belong to this query");
  return ok({
    violations: page.items,
    total: all.length,
    next_cursor: page.next_cursor,
  });
}
