// series·series_instances·series_keys 표의 행 읽기·쓰기. command와 read가 같이 쓴다.

import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  Series,
  SeriesDraft,
  SeriesInstance,
} from "../../../protocol/projects/mod.ts";
import {
  seriesDraftSchema,
  seriesInstanceSchema,
  seriesOrderSchema,
  seriesSchema,
} from "../../../protocol/projects/mod.ts";
import type { Sql, SqlRow, Tx } from "../../../protocol/platform/mod.ts";
import { canonicalize } from "../../../base/mod.ts";
function text(row: SqlRow, column: string): string | undefined {
  const value = row[column];
  return typeof value === "string" ? value : undefined;
}

function invalidRow(): Result<never> {
  return err({ code: "internal", message: "stored series row is invalid" });
}

function jsonColumn<T>(row: SqlRow, column: string): T | undefined | null {
  const value = text(row, column);
  if (value === undefined) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

function placeOf(row: SqlRow): Series["place"] | undefined {
  const kind = text(row, "place_kind");
  const id = text(row, "place_id");
  if (kind === undefined || id === undefined) return undefined;
  if (kind !== "project" && kind !== "app") return undefined;
  return { kind, id };
}

const SERIES_COLUMNS =
  'id, place_kind, place_id, name, title, format, "order", next_rule, draft,' +
  " revision, status";

// 행에서 가족 값을 읽는다. STRICT 표가 CHECK로 모양을 지키므로 문자열 가지를
// 믿고 schema에서 다시 검사한다.
function seriesFromRow(row: SqlRow): Result<Series> {
  const orderText = text(row, "order");
  const revision = text(row, "revision");
  const status = text(row, "status");
  const place = placeOf(row);
  if (orderText === undefined || revision === undefined) return invalidRow();
  if (status !== "active" && status !== "archived") return invalidRow();
  if (place === undefined) return invalidRow();
  let order: unknown;
  try {
    order = JSON.parse(orderText);
  } catch {
    return invalidRow();
  }
  const draft = jsonColumn<unknown>(row, "draft");
  if (draft === undefined) return invalidRow();
  const parsed = seriesSchema.safeParse({
    id: text(row, "id"),
    place,
    name: text(row, "name"),
    title: text(row, "title"),
    format: text(row, "format"),
    order,
    next_rule: text(row, "next_rule"),
    draft,
    revision,
    status,
  });
  return parsed.success ? ok(parsed.data) : invalidRow();
}

export function loadSeries(sql: Sql, id: string): Result<Series | null> {
  const row = sql.get(`SELECT ${SERIES_COLUMNS} FROM series WHERE id = ?`, [
    id,
  ]);
  if (row === undefined) return ok(null);
  return seriesFromRow(row);
}

export function loadSeriesRow(
  sql: Sql,
  id: string,
): Result<Pick<Series, "id" | "revision" | "status"> | null> {
  const row = sql.get(
    "SELECT id, revision, status FROM series WHERE id = ?",
    [id],
  );
  if (row === undefined) return ok(null);
  const revision = text(row, "revision");
  const status = text(row, "status");
  const id2 = text(row, "id");
  if (revision === undefined || id2 === undefined) return invalidRow();
  if (status !== "active" && status !== "archived") return invalidRow();
  return ok({ id: id2, revision, status });
}

export function loadSeriesByName(
  sql: Sql,
  place: Series["place"],
  name: string,
): Result<Series | null> {
  const row = sql.get(
    `SELECT ${SERIES_COLUMNS} FROM series
     WHERE place_kind = ? AND place_id = ? AND name = ?`,
    [place.kind, place.id, name],
  );
  if (row === undefined) return ok(null);
  return seriesFromRow(row);
}

export function listSeries(
  sql: Sql,
  place: Series["place"],
  status: "active" | "archived" | undefined,
): Result<Series[]> {
  const rows = sql.all(
    `SELECT ${SERIES_COLUMNS} FROM series
     WHERE place_kind = ? AND place_id = ?${status ? " AND status = ?" : ""}
     ORDER BY id`,
    status ? [place.kind, place.id, status] : [place.kind, place.id],
  );
  const series: Series[] = [];
  for (const row of rows) {
    const parsed = seriesFromRow(row);
    if (!parsed.ok) return parsed;
    series.push(parsed.value);
  }
  return ok(series);
}

// 자리 없는 전체 가족 목록. seriesList의 place는 생략할 수 있다.
export function listAllSeries(
  sql: Sql,
  status: "active" | "archived" | undefined,
): Result<Series[]> {
  const rows = sql.all(
    `SELECT ${SERIES_COLUMNS} FROM series${status ? " WHERE status = ?" : ""}
     ORDER BY id`,
    status ? [status] : [],
  );
  const series: Series[] = [];
  for (const row of rows) {
    const parsed = seriesFromRow(row);
    if (!parsed.ok) return parsed;
    series.push(parsed.value);
  }
  return ok(series);
}

export function insertSeries(tx: Tx, value: Series): void {
  tx.sql.run(
    `INSERT INTO series (${SERIES_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      value.id,
      value.place.kind,
      value.place.id,
      value.name,
      value.title,
      value.format,
      canonicalize(value.order),
      value.next_rule,
      value.draft === null ? null : canonicalize(value.draft),
      value.revision,
      value.status,
    ],
  );
}

export function updateSeries(tx: Tx, value: Series): void {
  tx.sql.run(
    `UPDATE series SET title = ?, format = ?, "order" = ?, next_rule = ?,
       draft = ?, revision = ?, status = ?
     WHERE id = ?`,
    [
      value.title,
      value.format,
      canonicalize(value.order),
      value.next_rule,
      value.draft === null ? null : canonicalize(value.draft),
      value.revision,
      value.status,
      value.id,
    ],
  );
}

const INSTANCE_COLUMNS =
  "series, document, key, order_value, order_version, revision";

function instanceFromRow(row: SqlRow): Result<SeriesInstance> {
  const parsed = seriesInstanceSchema.safeParse({
    series: text(row, "series"),
    document: text(row, "document"),
    key: text(row, "key"),
    order_value: row["order_value"] ?? null,
    order_version: text(row, "order_version") ?? null,
    revision: text(row, "revision"),
  });
  return parsed.success ? ok(parsed.data) : invalidRow();
}

export function loadInstance(
  sql: Sql,
  series: string,
  document: string,
): Result<SeriesInstance | null> {
  const row = sql.get(
    `SELECT ${INSTANCE_COLUMNS} FROM series_instances
     WHERE series = ? AND document = ?`,
    [series, document],
  );
  if (row === undefined) return ok(null);
  return instanceFromRow(row);
}

export function listInstances(
  sql: Sql,
  series: string,
): Result<SeriesInstance[]> {
  const rows = sql.all(
    `SELECT ${INSTANCE_COLUMNS} FROM series_instances WHERE series = ?`,
    [series],
  );
  const instances: SeriesInstance[] = [];
  for (const row of rows) {
    const parsed = instanceFromRow(row);
    if (!parsed.ok) return parsed;
    instances.push(parsed.value);
  }
  return ok(instances);
}

// 멤버의 order_value는 유한 number 또는 비어 있지 않은 string이다.
export function insertInstance(tx: Tx, instance: SeriesInstance): void {
  tx.sql.run(
    `INSERT INTO series_instances (${INSTANCE_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      instance.series,
      instance.document,
      instance.key,
      typeof instance.order_value === "number"
        ? instance.order_value.toString()
        : instance.order_value,
      instance.order_version,
      instance.revision,
    ],
  );
}

export function deleteInstance(tx: Tx, series: string, document: string): void {
  tx.sql.run(
    "DELETE FROM series_instances WHERE series = ? AND document = ?",
    [series, document],
  );
}

export function insertKeyReservation(
  tx: Tx,
  series: string,
  key: string,
  document: string,
  first_seq: string,
): void {
  tx.sql.run(
    "INSERT INTO series_keys (series, key, document, first_seq) VALUES (?, ?, ?, ?)",
    [series, key, document, first_seq],
  );
}

export function loadKeyReservation(
  sql: Sql,
  series: string,
  key: string,
): Result<
  { series: string; key: string; document: string; first_seq: string } | null
> {
  const row = sql.get(
    "SELECT series, key, document, first_seq FROM series_keys WHERE series = ? AND key = ?",
    [series, key],
  );
  if (row === undefined) return ok(null);
  const existingSeries = text(row, "series");
  const existingKey = text(row, "key");
  const document = text(row, "document");
  const firstSeq = text(row, "first_seq");
  if (
    existingSeries === undefined || existingKey === undefined ||
    document === undefined || firstSeq === undefined
  ) return invalidRow();
  return ok({
    series: existingSeries,
    key: existingKey,
    document,
    first_seq: firstSeq,
  });
}

export function listReservedKeys(
  sql: Sql,
  series: string,
): Result<string[]> {
  const rows = sql.all(
    "SELECT key FROM series_keys WHERE series = ?",
    [series],
  );
  const keys: string[] = [];
  for (const row of rows) {
    const key = text(row, "key");
    if (key === undefined) return invalidRow();
    keys.push(key);
  }
  return ok(keys);
}

// order 열의 정본 JSON을 다시 읽는다. seriesFromRow의 order parse와 같은 근원이다.
export function parseStoredOrder(value: string): Result<Series["order"]> {
  try {
    const parsed = seriesOrderSchema.safeParse(JSON.parse(value));
    return parsed.success ? ok(parsed.data) : invalidRow();
  } catch {
    return invalidRow();
  }
}

// draft 열의 정본 JSON을 다시 읽는다.
export function parseStoredDraft(value: string): Result<SeriesDraft> {
  try {
    const parsed = seriesDraftSchema.safeParse(JSON.parse(value));
    return parsed.success ? ok(parsed.data) : invalidRow();
  } catch {
    return invalidRow();
  }
}
