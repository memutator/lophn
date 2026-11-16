import type {
  ChangesetCell,
  ChangesetValue,
} from "../../../base/changeset-invert.ts";
import type { SqlParam, SyncDb } from "./db.ts";

export const ident = (name: string): string =>
  `"${name.replaceAll('"', '""')}"`;

// 앱 표가 아닌 것. cap-store session과 폰 guest authorizer도 같은 접두사로 거른다.
export function hiddenTable(name: string): boolean {
  return name.startsWith("sqlite_") || name.startsWith("lophn_");
}

const INT64_MIN = BigInt("-9223372036854775808");

// 정수는 SQL literal로 넣어 driver가 INTEGER와 REAL을 고르지 않게 한다. 빈 blob은 bind하면 NULL이 되는
// driver가 있어(spike의 폰 driver) literal로 넣는다. 나머지는 bind한다.
export function sqlValue(value: ChangesetValue, params: SqlParam[]): string {
  if (value === null) return "NULL";
  if (typeof value === "bigint") {
    return value === INT64_MIN ? "(-9223372036854775807-1)" : String(value);
  }
  if (value instanceof Uint8Array && value.length === 0) return "X''";
  params.push(value);
  return "?";
}

export const hlcLiteral = (hlc: bigint): string => String(hlc);

export type TableShape = {
  table: string;
  columns: string[];
  primaryKey: boolean[];
};

// 표가 없으면 null이다.
export function tableShape(db: SyncDb, table: string): TableShape | null {
  const rows = db.all(`pragma table_info(${ident(table)})`);
  if (rows.length === 0) return null;
  return {
    table,
    columns: rows.map((row) => String(row["name"])),
    primaryKey: rows.map((row) => Number(row["pk"]) > 0),
  };
}

// PK 칸 값으로 그 row를 고르는 WHERE. NULL PK도 맞추도록 `is`를 쓴다.
export function keyWhere(
  shape: TableShape,
  record: readonly ChangesetCell[],
  params: SqlParam[],
): string {
  const parts: string[] = [];
  shape.primaryKey.forEach((pk, i) => {
    if (!pk) return;
    parts.push(
      `${ident(shape.columns[i]!)} is ${sqlValue(record[i] as ChangesetValue, params)}`,
    );
  });
  return parts.join(" and ");
}

// 값을 storage class 그대로 읽는 select 목록. INTEGER는 text로 받아 bigint로 바꾼다(driver마다 number·bigint가 다르다).
function typedColumns(shape: TableShape): string {
  return shape.columns
    .map((column, i) => {
      const c = ident(column);
      return `typeof(${c}) as "t${i}", case typeof(${c}) when 'integer' then cast(${c} as text) else ${c} end as "v${i}"`;
    })
    .join(", ");
}

function typedValues(
  shape: TableShape,
  row: Record<string, unknown>,
): ChangesetValue[] {
  return shape.columns.map((_, i) => storedValue(row[`t${i}`], row[`v${i}`]));
}

// `typeof(x)`와 INTEGER를 text로 읽은 값에서 원래 값을 되살린다.
export function storedValue(type: unknown, value: unknown): ChangesetValue {
  if (type === "null") return null;
  if (type === "integer") return BigInt(String(value));
  if (type === "real") return Number(value);
  if (type === "text") return String(value);
  return value as Uint8Array;
}

export function readRow(
  db: SyncDb,
  shape: TableShape,
  key: readonly ChangesetCell[],
): ChangesetValue[] | null {
  const params: SqlParam[] = [];
  const where = keyWhere(shape, key, params);
  const row = db.all(
    `select ${typedColumns(shape)} from ${ident(shape.table)} where ${where}`,
    params,
  )[0];
  return row === undefined ? null : typedValues(shape, row);
}

export function readRows(db: SyncDb, shape: TableShape): ChangesetValue[][] {
  return db
    .all(`select ${typedColumns(shape)} from ${ident(shape.table)}`)
    .map((row) => typedValues(shape, row));
}

// 앱 표 이름(숨은 표 빼고) 이름 순.
export function userTables(db: SyncDb): string[] {
  return db
    .all("select name from sqlite_master where type = 'table' order by name")
    .map((row) => String(row["name"]))
    .filter((name) => !hiddenTable(name));
}
