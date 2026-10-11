// context ledger 표의 행 읽기·쓰기다. 표마다 load/save 한 벌이고 값은 contracts의 값 모양
// (ContextValue, BundleSummary, CheckReport, SavedViewValue, GlossaryEntry)을 그대로 쓴다.
// SQL 열과 값 사이의 바꿈(JSON 글, blob 참조 두 열)은 여기서만 한다.
//
// 읽기 함수는 `Pick<Sql, "get" | "all">`만 받아서 command의 tx.sql과 읽기 snapshot이 같이 쓴다.
// 쓰기 함수는 `Sql`을 받는다. 저장된 행이 모양을 어기면 Error를 던진다(STRICT 표와 CHECK가 막지만
// 다른 경로로 들어온 행을 믿지 않는다). platform이 던진 Error를 `internal`로 바꾸고 transaction을
// rollback한다.
//
// 쓰는 순서 규칙(adapter가 지킨다): 같은 transaction에서 판의 상태가 서로 바뀔 때
// (적용 ↔ 물러남) 물러나는 행을 먼저 쓴다. 한 context에 applied는 하나라는 partial unique index가
// 문장마다 검사하기 때문이다. contexts.applied_bundle과 context_bundles."check"는 commit 때 검사한다.
import type { z } from "zod";
import {
  type BundleSummary,
  bundleSummarySchema,
  type CheckReport,
  checkReportSchema,
  type ContextValue,
  contextValueSchema,
  type GlossaryEntry,
  glossaryEntrySchema,
  type SavedViewValue,
  savedViewValueSchema,
} from "../../../contracts/documents/mod.ts";
import type { Sql, SqlParam, SqlRow } from "../../../contracts/platform/mod.ts";
import type { BlobReference } from "../api/state.ts";

type Reader = Pick<Sql, "get" | "all">;

// 판의 행. content는 blob이라 참조만 담는다. 내용은 adapter가 blob reader로 읽는다.
export type StoredBundle = BundleSummary & { content_ref: BlobReference };

export type ProjectRef = { id: string; archived: boolean };

// ---------- 행과 값 사이 ----------

// SQLite 정수는 bigint로 올 수 있다. 이 표의 정수는 모두 안전 정수 안이다.
const integer = (cell: SqlParam | undefined) =>
  typeof cell === "bigint" ? Number(cell) : cell;

// 행을 값의 schema로 읽는다. 어긋나면 어느 열이 어긋났는지만 담아 던진다(값은 담지 않는다).
function read<S extends z.ZodType>(
  table: string,
  schema: S,
  row: SqlRow,
  columns: Record<string, unknown>,
): z.output<S> {
  const parsed = schema.safeParse(columns);
  if (!parsed.success) {
    const where = parsed.error.issues.map((issue) => issue.path.join("."));
    throw new Error(`${table} row ${row.id} is malformed: ${where.join(", ")}`);
  }
  return parsed.data;
}

// ---------- 다른 표에서 읽기 ----------

// documents/projects의 projects 표에서 읽는다. 없으면 null이다.
export function loadProject(sql: Reader, id: string): ProjectRef | null {
  const row = sql.get("SELECT id, status FROM projects WHERE id = ?", [id]);
  return row === undefined
    ? null
    : { id: String(row.id), archived: row.status === "archived" };
}

const OWNER_TABLES = {
  bundle: "context_bundles",
  check: "context_checks",
  view: "saved_views",
  entry: "glossary_entries",
} as const;

// 판·검사·saved view·용어 항목의 id로 그것이 속한 context를 찾는다. 없으면 null이다.
export function contextOf(
  sql: Reader,
  kind: keyof typeof OWNER_TABLES,
  id: string,
): string | null {
  const row = sql.get(
    `SELECT context FROM ${OWNER_TABLES[kind]} WHERE id = ?`,
    [
      id,
    ],
  );
  return row === undefined ? null : String(row.context);
}

// ---------- contexts ----------

const contextOfRow = (row: SqlRow): ContextValue =>
  read("contexts", contextValueSchema, row, {
    id: row.id,
    project: row.project,
    title: row.title,
    purpose: row.purpose,
    status: row.status,
    applied_bundle: row.applied_bundle,
    violation_mark: integer(row.violation_mark),
    revision: row.revision,
  });

export function loadContext(sql: Reader, id: string): ContextValue | null {
  const row = sql.get("SELECT * FROM contexts WHERE id = ?", [id]);
  return row === undefined ? null : contextOfRow(row);
}

// project의 context 전부(보관된 것 포함). 제목 유일 검사와 목록이 쓴다. id 순이다.
export function loadProjectContexts(
  sql: Reader,
  project: string,
): ContextValue[] {
  return sql.all("SELECT * FROM contexts WHERE project = ? ORDER BY id", [
    project,
  ]).map(contextOfRow);
}

// 없으면 넣고 있으면 바꾼다(id·project는 바뀌지 않는다).
export function saveContext(sql: Sql, value: ContextValue): void {
  sql.run(
    `INSERT INTO contexts
       (id, project, title, purpose, status, applied_bundle, violation_mark, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       title = excluded.title, purpose = excluded.purpose,
       status = excluded.status, applied_bundle = excluded.applied_bundle,
       violation_mark = excluded.violation_mark, revision = excluded.revision`,
    [
      value.id,
      value.project,
      value.title,
      value.purpose,
      value.status,
      value.applied_bundle,
      value.violation_mark,
      value.revision,
    ],
  );
}

// ---------- context_bundles ----------

const contentRefOfRow = (row: SqlRow): BlobReference => ({
  hash: String(row.content_hash),
  size_bytes: Number(row.content_size),
});

const bundleOfRow = (row: SqlRow): StoredBundle => ({
  ...read("context_bundles", bundleSummarySchema, row, {
    id: row.id,
    context: row.context,
    number: integer(row.number),
    parent: row.parent,
    bundle_hash: row.bundle_hash,
    status: row.status,
    check: row.check,
    created_by: row.created_by,
    revision: row.revision,
  }),
  content_ref: contentRefOfRow(row),
});

// context의 판 전부(버린 draft 포함). id 순이다.
export function loadContextBundles(
  sql: Reader,
  context: string,
): StoredBundle[] {
  return sql.all(
    "SELECT * FROM context_bundles WHERE context = ? ORDER BY id",
    [
      context,
    ],
  ).map(bundleOfRow);
}

// project의 모든 context의 판. context.list가 쓴다. id 순이다.
export function loadProjectBundles(
  sql: Reader,
  project: string,
): StoredBundle[] {
  return sql.all(
    `SELECT b.* FROM context_bundles b JOIN contexts c ON c.id = b.context
     WHERE c.project = ? ORDER BY b.id`,
    [project],
  ).map(bundleOfRow);
}

export function loadBundle(sql: Reader, id: string): StoredBundle | null {
  const row = sql.get("SELECT * FROM context_bundles WHERE id = ?", [id]);
  return row === undefined ? null : bundleOfRow(row);
}

// context·parent는 바뀌지 않으므로 갱신에서 뺀다.
export function saveBundle(sql: Sql, value: StoredBundle): void {
  sql.run(
    `INSERT INTO context_bundles
       (id, context, number, parent, content_hash, content_size, bundle_hash,
        status, "check", created_by, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       number = excluded.number, content_hash = excluded.content_hash,
       content_size = excluded.content_size, bundle_hash = excluded.bundle_hash,
       status = excluded.status, "check" = excluded."check",
       revision = excluded.revision`,
    [
      value.id,
      value.context,
      value.number,
      value.parent,
      value.content_ref.hash,
      value.content_ref.size_bytes,
      value.bundle_hash,
      value.status,
      value.check,
      value.created_by,
      value.revision,
    ],
  );
}

// ---------- context_checks ----------

const checkOfRow = (row: SqlRow): CheckReport =>
  read("context_checks", checkReportSchema, row, {
    id: row.id,
    context: row.context,
    bundle: row.bundle,
    status: row.status,
    snapshot_hash: row.snapshot_hash,
    findings: JSON.parse(String(row.findings)),
    violation_count: integer(row.violation_count),
    started_at: row.started_at,
    finished_at: row.finished_at,
  });

// context의 검사 전부. id 순이다.
export function loadContextChecks(
  sql: Reader,
  context: string,
): CheckReport[] {
  return sql.all("SELECT * FROM context_checks WHERE context = ? ORDER BY id", [
    context,
  ]).map(checkOfRow);
}

export function loadCheck(sql: Reader, id: string): CheckReport | null {
  const row = sql.get("SELECT * FROM context_checks WHERE id = ?", [id]);
  return row === undefined ? null : checkOfRow(row);
}

// 판 하나에 검사 하나이고 끝난 검사는 바뀌지 않으므로 갱신은 결과 열만 쓴다.
export function saveCheck(sql: Sql, value: CheckReport): void {
  sql.run(
    `INSERT INTO context_checks
       (id, context, bundle, status, snapshot_hash, findings, violation_count,
        started_at, finished_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       status = excluded.status, snapshot_hash = excluded.snapshot_hash,
       findings = excluded.findings, violation_count = excluded.violation_count,
       finished_at = excluded.finished_at`,
    [
      value.id,
      value.context,
      value.bundle,
      value.status,
      value.snapshot_hash,
      JSON.stringify(value.findings),
      value.violation_count,
      value.started_at,
      value.finished_at,
    ],
  );
}

// ---------- saved_views ----------

const viewOfRow = (row: SqlRow): SavedViewValue =>
  read("saved_views", savedViewValueSchema, row, {
    id: row.id,
    context: row.context,
    name: row.name,
    search: row.search,
    inputs: JSON.parse(String(row.inputs)),
    origin: row.origin,
    revision: row.revision,
  });

// context의 saved view 전부. id 순이다.
export function loadContextViews(
  sql: Reader,
  context: string,
): SavedViewValue[] {
  return sql.all("SELECT * FROM saved_views WHERE context = ? ORDER BY id", [
    context,
  ]).map(viewOfRow);
}

export function loadView(sql: Reader, id: string): SavedViewValue | null {
  const row = sql.get("SELECT * FROM saved_views WHERE id = ?", [id]);
  return row === undefined ? null : viewOfRow(row);
}

export function saveView(sql: Sql, value: SavedViewValue): void {
  sql.run(
    `INSERT INTO saved_views (id, context, name, search, inputs, origin, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       name = excluded.name, search = excluded.search, inputs = excluded.inputs,
       origin = excluded.origin, revision = excluded.revision`,
    [
      value.id,
      value.context,
      value.name,
      value.search,
      JSON.stringify(value.inputs),
      value.origin,
      value.revision,
    ],
  );
}

export function deleteView(sql: Sql, id: string): void {
  sql.run("DELETE FROM saved_views WHERE id = ?", [id]);
}

// ---------- glossary_entries ----------

const entryOfRow = (row: SqlRow): GlossaryEntry =>
  read("glossary_entries", glossaryEntrySchema, row, {
    id: row.id,
    context: row.context,
    term: row.term,
    meaning: row.meaning,
    set_by: row.set_by,
    updated_at: row.updated_at,
    revision: row.revision,
  });

// context의 용어 항목 전부. id 순이다(읽기 순서는 읽기 handler가 정한다).
export function loadContextEntries(
  sql: Reader,
  context: string,
): GlossaryEntry[] {
  return sql.all(
    "SELECT * FROM glossary_entries WHERE context = ? ORDER BY id",
    [context],
  ).map(entryOfRow);
}

export function loadEntry(sql: Reader, id: string): GlossaryEntry | null {
  const row = sql.get("SELECT * FROM glossary_entries WHERE id = ?", [id]);
  return row === undefined ? null : entryOfRow(row);
}

// 한 context의 항목 수 한도를 BEFORE INSERT trigger가 세므로, 가득 찬 context의 기존 항목을
// 고치는 일이 upsert의 삽입 시도에 걸리지 않게 갱신을 먼저 한다.
export function saveEntry(sql: Sql, value: GlossaryEntry): void {
  const updated = sql.run(
    `UPDATE glossary_entries
     SET term = ?, meaning = ?, set_by = ?, updated_at = ?, revision = ?
     WHERE id = ?`,
    [
      value.term,
      value.meaning,
      value.set_by,
      value.updated_at,
      value.revision,
      value.id,
    ],
  );
  if (Number(updated.changes) > 0) return;
  sql.run(
    `INSERT INTO glossary_entries
       (id, context, term, meaning, set_by, updated_at, revision)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      value.id,
      value.context,
      value.term,
      value.meaning,
      value.set_by,
      value.updated_at,
      value.revision,
    ],
  );
}

export function deleteEntry(sql: Sql, id: string): void {
  sql.run("DELETE FROM glossary_entries WHERE id = ?", [id]);
}
