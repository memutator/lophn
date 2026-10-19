import { err, ok, type Result } from "../../../../base/mod.ts";
import type { KindListQuery } from "../../../../protocol/projects/mod.ts";
import { type FieldInfo, type Row, valueAt } from "./fields.ts";
import { compareValues } from "./sort.ts";

type Aggregate = NonNullable<KindListQuery["aggregate"]>[number];
type Value = number | string | null;
export type Group = { group: unknown; values: Record<string, Value> };

const invalid = (message: string): Result<never> =>
  err({ code: "invalid_input", message });

// count는 field가 있으면 null이 아닌 값의 수다. sum은 number 칸만, min·max는 number·date·string 칸만이다.
function compute(
  aggregate: Aggregate,
  rows: readonly Row[],
): Value {
  if (aggregate.op === "count") {
    return aggregate.field === undefined
      ? rows.length
      : rows.filter((row) => valueAt(row, aggregate.field!) !== null).length;
  }
  const values = rows.map((row) => valueAt(row, aggregate.field!)).filter((
    value,
  ): value is number | string => value !== null);
  if (aggregate.op === "sum") {
    return values.reduce<number>(
      (total, value) => total + (value as number),
      0,
    );
  }
  const sorted = values.sort(compareValues);
  return (aggregate.op === "min" ? sorted[0] : sorted.at(-1)) ?? null;
}

const nameOf = (aggregate: Aggregate): string =>
  aggregate.as ??
    (aggregate.op === "count" && aggregate.field === undefined
      ? "count"
      : `${aggregate.op}_${aggregate.field}`);

export function aggregateRows(
  rows: readonly Row[],
  aggregates: readonly Aggregate[],
  groupBy: string | undefined,
  infos: ReadonlyMap<string, FieldInfo>,
): Result<Group[]> {
  const names = new Set<string>();
  for (const aggregate of aggregates) {
    const name = nameOf(aggregate);
    if (names.has(name)) {
      return invalid(`aggregate result name ${name} is used twice`);
    }
    names.add(name);
    if (aggregate.field === undefined) continue;
    const info = infos.get(aggregate.field);
    if (info === undefined) return invalid(`unknown field ${aggregate.field}`);
    if (aggregate.op === "count") continue;
    const allowed = aggregate.op === "sum"
      ? ["number"]
      : ["number", "date", "string"];
    if (info.list || !allowed.includes(info.type)) {
      return invalid(
        `${aggregate.op} cannot be used on field ${aggregate.field}`,
      );
    }
  }
  if (groupBy !== undefined) {
    const info = infos.get(groupBy);
    if (info === undefined) return invalid(`unknown field ${groupBy}`);
    if (info.list) {
      return invalid(`group_by cannot be used on list field ${groupBy}`);
    }
  }

  const buckets = new Map<string, { group: unknown; rows: Row[] }>();
  for (const row of rows) {
    const group = groupBy === undefined ? null : valueAt(row, groupBy);
    const id = JSON.stringify(group);
    const bucket = buckets.get(id) ?? { group, rows: [] };
    bucket.rows.push(row);
    buckets.set(id, bucket);
  }
  // 묶음이 없어도(item이 없어도) group_by가 없으면 한 묶음이다.
  if (groupBy === undefined && buckets.size === 0) {
    buckets.set("null", { group: null, rows: [] });
  }
  const groups = [...buckets.values()].sort((a, b) =>
    (a.group === null ? 1 : 0) - (b.group === null ? 1 : 0) ||
    compareValues(a.group, b.group)
  );
  return ok(groups.map((bucket) => ({
    group: bucket.group,
    values: Object.fromEntries(
      aggregates.map((
        aggregate,
      ) => [nameOf(aggregate), compute(aggregate, bucket.rows)]),
    ),
  })));
}
