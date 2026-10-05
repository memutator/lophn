// saved_views 표의 행 읽기·쓰기. command와 read가 같이 쓴다.

import { canonicalize, err, ok, type Result } from "../../base/mod.ts";
import type { SavedView } from "../../contracts/documents/mod.ts";
import type { Sql, SqlRow, Tx } from "../../contracts/platform/mod.ts";

export type SavedViewRow = {
  id: string;
  name: string;
  place: { kind: "project" | "app"; id: string } | null;
  filter: SavedView["filter"];
  sort: SavedView["sort"];
  revision: string;
};

function text(row: SqlRow, column: string): string | undefined {
  const value = row[column];
  return typeof value === "string" ? value : undefined;
}

function invalidRow(): Result<never> {
  return err({ code: "internal", message: "stored saved view row is invalid" });
}

const SAVED_VIEW_COLUMNS =
  "id, name, place_kind, place_id, filter, sort, revision";

function viewFromRow(row: SqlRow): Result<SavedViewRow> {
  // STRICT 표라서 가지 모양은 CHECK가 지킨다. filter JSON은 여기서 다시 검사한다.
  const id = text(row, "id");
  const name = text(row, "name");
  const placeKind = text(row, "place_kind");
  const placeId = text(row, "place_id");
  const filterJson = text(row, "filter");
  const sort = text(row, "sort");
  const revision = text(row, "revision");
  if (
    id === undefined || name === undefined || filterJson === undefined ||
    sort === undefined || revision === undefined
  ) return invalidRow();
  if (
    sort !== "updated_desc" && sort !== "updated_asc" &&
    sort !== "title_asc" && sort !== "address_asc"
  ) return invalidRow();
  let place: SavedViewRow["place"] = null;
  if (placeKind !== undefined && placeId !== undefined) {
    if (placeKind !== "project" && placeKind !== "app") return invalidRow();
    place = { kind: placeKind, id: placeId };
  }
  let filter: unknown;
  try {
    filter = JSON.parse(filterJson);
  } catch {
    return invalidRow();
  }
  if (!savedViewFilter(filter)) return invalidRow();
  return ok({
    id,
    name,
    place,
    filter: filter as SavedViewRow["filter"],
    sort,
    revision,
  });
}

// store.ts가 contract output schema에 의존하지 않게 여기서 좁힌다(read는 출력 schema).
function savedViewFilter(value: unknown): value is SavedView["filter"] {
  if (typeof value !== "object" || value === null) return false;
  const filter = value as Record<string, unknown>;
  const known = [
    "title_contains",
    "text",
    "formats",
    "changed_within_ms",
    "context",
    "document_status",
  ];
  // 정의하지 않은 조건은 저장하지 않는다. 읽는 쪽도 같은 검사로 좁힌다(R23).
  for (const key of Object.keys(filter)) {
    if (!known.includes(key)) return false;
  }
  const status = filter.document_status;
  if (
    status !== undefined && status !== "active" && status !== "archived" &&
    status !== "all"
  ) return false;
  const strings = ["title_contains", "text"];
  for (const key of strings) {
    const value = filter[key];
    if (
      value !== undefined && (typeof value !== "string" ||
        value.trim().length === 0)
    ) return false;
  }
  const formats = filter.formats;
  if (
    formats !== undefined && (!Array.isArray(formats) ||
      formats.length === 0 ||
      formats.some((name) => typeof name !== "string" || name.length === 0))
  ) return false;
  const within = filter.changed_within_ms;
  if (
    within !== undefined && (typeof within !== "number" ||
      !Number.isSafeInteger(within) || within < 1)
  ) return false;
  const context = filter.context;
  if (
    context !== undefined && (typeof context !== "string" ||
      !context.startsWith("ctx_"))
  ) return false;
  return true;
}

export function loadSavedViewRow(
  sql: Sql,
  id: string,
): Result<SavedViewRow | null> {
  const row = sql.get(
    `SELECT ${SAVED_VIEW_COLUMNS} FROM saved_views WHERE id = ?`,
    [id],
  );
  if (row === undefined) return ok(null);
  return viewFromRow(row);
}

function sameName(
  sql: Sql,
  id: string,
  name: string,
): boolean {
  const row = sql.get(
    `SELECT id FROM saved_views WHERE name = ? AND id <> ?`,
    [name, id],
  );
  return row !== undefined;
}

export function listSavedViews(
  sql: Sql,
  filter: { limit: number; offset: number },
): Result<{ views: SavedViewRow[]; complete: boolean }> {
  // saved view 목록 자체는 조건이 없다(contract viewList 입력이 cursor뿐이다).
  // 저장 순 정의는 ID다. open의 문서 정렬과 다른 것이다.
  const rows = sql.all(
    `SELECT ${SAVED_VIEW_COLUMNS} FROM saved_views
     ORDER BY id LIMIT ? OFFSET ?`,
    [filter.limit + 1, filter.offset],
  );
  const views: SavedViewRow[] = [];
  for (const row of rows.slice(0, filter.limit)) {
    const parsed = viewFromRow(row);
    if (!parsed.ok) return parsed;
    views.push(parsed.value);
  }
  return ok({
    views,
    complete: rows.length <= filter.limit,
  });
}

function filterJson(filter: SavedView["filter"]): string {
  return canonicalize(filter);
}

export function insertSavedView(tx: Tx, view: SavedViewRow): void {
  tx.sql.run(
    `INSERT INTO saved_views (${SAVED_VIEW_COLUMNS})
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      view.id,
      view.name,
      view.place?.kind ?? null,
      view.place?.id ?? null,
      filterJson(view.filter),
      view.sort,
      view.revision,
    ],
  );
}

export function updateSavedView(tx: Tx, view: SavedViewRow): void {
  tx.sql.run(
    `UPDATE saved_views SET name = ?, place_kind = ?, place_id = ?,
       filter = ?, sort = ?, revision = ?
     WHERE id = ?`,
    [
      view.name,
      view.place?.kind ?? null,
      view.place?.id ?? null,
      filterJson(view.filter),
      view.sort,
      view.revision,
      view.id,
    ],
  );
}

export function deleteSavedView(tx: Tx, id: string): void {
  tx.sql.run(`DELETE FROM saved_views WHERE id = ?`, [id]);
}

export { sameName };
