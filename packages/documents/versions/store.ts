// documents·versions 표의 행 읽기·쓰기. command와 read가 같이 쓴다.

import { err, ok, type Result } from "../../base/mod.ts";
import {
  type ContentFile,
  contentFileSchema,
  type Document,
  documentSchema,
  type FileSource,
  fileSourceSchema,
  type FormatRef,
  type Version,
  versionSchema,
  type VersionSource,
  versionSourceSchema,
} from "../../contracts/documents/mod.ts";
import type { Sql, SqlRow, Tx } from "../../contracts/platform/mod.ts";

export type VersionRow = {
  id: string;
  document: string;
  number: number;
  files_hash: string;
  primary_path: string;
  file_count: number;
  content_hash: string;
  format: FormatRef;
  saved_by: string;
  saved_at: string;
  run: string | null;
  source: VersionSource | null;
};

function text(row: SqlRow, column: string): string | undefined {
  const value = row[column];
  return typeof value === "string" ? value : undefined;
}

function integer(row: SqlRow, column: string): number | undefined {
  const value = row[column];
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" ? value : undefined;
}

function invalidRow(): Result<never> {
  return err({ code: "internal", message: "stored document row is invalid" });
}

function sourceOf(row: SqlRow): FileSource | null | undefined {
  const kind = text(row, "source_kind");
  if (kind === undefined) return null;
  const path = text(row, "source_path");
  const project = text(row, "source_project") ?? null;
  if (kind === "project_file") {
    const parsed = fileSourceSchema.safeParse({
      kind,
      project,
      path,
    });
    return parsed.success ? parsed.data : undefined;
  }
  const parsed = fileSourceSchema.safeParse({
    kind,
    instruction_target: text(row, "source_instruction_target"),
    project,
    path,
  });
  return parsed.success ? parsed.data : undefined;
}

function placeOf(row: SqlRow): Document["place"] | undefined {
  const kind = text(row, "place_kind");
  if (kind === undefined) return null;
  if (kind !== "project" && kind !== "app") return undefined;
  return { kind, id: text(row, "place_id") ?? "" };
}

export function documentFromRow(row: SqlRow): Result<Document> {
  const source = sourceOf(row);
  const place = placeOf(row);
  if (source === undefined || place === undefined) return invalidRow();
  const parsed = documentSchema.safeParse({
    id: text(row, "id"),
    place,
    name: text(row, "name") ?? null,
    title: text(row, "title"),
    file_source: source,
    latest_version: text(row, "latest_version"),
    revision: text(row, "revision"),
    status: text(row, "status"),
  });
  return parsed.success ? ok(parsed.data) : invalidRow();
}

export function versionFromRow(row: SqlRow): Result<VersionRow> {
  const sourceText = text(row, "source");
  let source: VersionSource | null = null;
  if (sourceText !== undefined) {
    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(sourceText);
    } catch {
      return invalidRow();
    }
    const parsed = versionSourceSchema.safeParse(parsedJson);
    if (!parsed.success) return invalidRow();
    source = parsed.data;
  }
  const explicit = integer(row, "format_explicit");
  const number = integer(row, "number");
  const fileCount = integer(row, "file_count");
  if (explicit === undefined || number === undefined || fileCount === undefined) {
    return invalidRow();
  }
  const value: VersionRow = {
    id: text(row, "id") ?? "",
    document: text(row, "document") ?? "",
    number,
    files_hash: text(row, "files_hash") ?? "",
    primary_path: text(row, "primary_path") ?? "",
    file_count: fileCount,
    content_hash: text(row, "content_hash") ?? "",
    format: {
      name: text(row, "format_name") ?? "",
      module_hash: text(row, "module_hash") ?? "",
      explicit: explicit === 1,
    },
    saved_by: text(row, "saved_by") ?? "",
    saved_at: text(row, "saved_at") ?? "",
    run: text(row, "run") ?? null,
    source,
  };
  if (
    value.id.length === 0 || value.document.length === 0 ||
    value.files_hash.length === 0 || value.content_hash.length === 0 ||
    value.format.name.length === 0 || value.format.module_hash.length === 0 ||
    value.saved_by.length === 0 || value.saved_at.length === 0 ||
    value.primary_path.length === 0 || value.number < 1 || value.file_count < 1
  ) return invalidRow();
  return ok(value);
}

const DOCUMENT_COLUMNS =
  "id, place_kind, place_id, name, title, source_kind, source_instruction_target," +
  " source_project, source_path, latest_version, revision, status";

export function loadDocument(sql: Sql, id: string): Result<Document | null> {
  const row = sql.get(
    `SELECT ${DOCUMENT_COLUMNS} FROM documents WHERE id = ?`,
    [id],
  );
  if (row === undefined) return ok(null);
  return documentFromRow(row);
}

export function loadVersion(sql: Sql, id: string): Result<VersionRow | null> {
  const row = sql.get(`SELECT * FROM versions WHERE id = ?`, [id]);
  if (row === undefined) return ok(null);
  return versionFromRow(row);
}

export function loadLatestVersion(
  sql: Sql,
  document: string,
): Result<VersionRow | null> {
  const row = sql.get(
    `SELECT * FROM versions WHERE document = ? ORDER BY number DESC LIMIT 1`,
    [document],
  );
  if (row === undefined) return ok(null);
  return versionFromRow(row);
}

export function loadVersionByNumber(
  sql: Sql,
  document: string,
  number: number,
): Result<VersionRow | null> {
  const row = sql.get(
    `SELECT * FROM versions WHERE document = ? AND number = ?`,
    [document, number],
  );
  if (row === undefined) return ok(null);
  return versionFromRow(row);
}

export function loadFiles(sql: Sql, version: string): Result<ContentFile[]> {
  const rows = sql.all(
    `SELECT path, blob_hash, bytes, media_type, primary_file
     FROM version_files WHERE version = ? ORDER BY path`,
    [version],
  );
  const files: ContentFile[] = [];
  for (const row of rows) {
    const parsed = contentFileSchema.safeParse({
      path: text(row, "path"),
      blob_hash: text(row, "blob_hash"),
      bytes: integer(row, "bytes"),
      media_type: text(row, "media_type"),
      primary: integer(row, "primary_file") === 1,
    });
    if (!parsed.success) return invalidRow();
    files.push(parsed.data);
  }
  return ok(files);
}

export function assembleVersion(
  sql: Sql,
  row: VersionRow,
): Result<Version> {
  const files = loadFiles(sql, row.id);
  if (!files.ok) return files;
  // 파일 목록 행은 준비 worker가 남긴다(documents T8). 없으면 정규화 목록 blob 참조다.
  const listed = files.value.length > 0
    ? files.value
    : { hash: row.files_hash, size_bytes: 0 };
  const parsed = versionSchema.safeParse({ ...row, files: listed });
  return parsed.success ? ok(parsed.data) : invalidRow();
}

function sourceColumns(source: FileSource | null): (string | null)[] {
  if (source === null) return [null, null, null, null];
  if (source.kind === "project_file") {
    return [source.kind, null, source.project, source.path];
  }
  return [
    source.kind,
    source.instruction_target,
    source.project,
    source.path,
  ];
}

export function insertDocument(tx: Tx, document: Document): void {
  const place = document.place;
  tx.sql.run(
    `INSERT INTO documents (${DOCUMENT_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      document.id,
      place?.kind ?? null,
      place?.id ?? null,
      document.name,
      document.title,
      ...sourceColumns(document.file_source),
      document.latest_version,
      document.revision,
      document.status,
    ],
  );
}

export function replaceDocument(tx: Tx, document: Document): void {
  const place = document.place;
  tx.sql.run(
    `UPDATE documents SET place_kind = ?, place_id = ?, name = ?, title = ?,
       source_kind = ?, source_instruction_target = ?, source_project = ?,
       source_path = ?, latest_version = ?, revision = ?, status = ?
     WHERE id = ?`,
    [
      place?.kind ?? null,
      place?.id ?? null,
      document.name,
      document.title,
      ...sourceColumns(document.file_source),
      document.latest_version,
      document.revision,
      document.status,
      document.id,
    ],
  );
}

export function insertVersion(
  tx: Tx,
  version: Version,
  summary: { files_hash: string; primary_path: string; file_count: number },
): void {
  tx.sql.run(
    `INSERT INTO versions
       (id, document, number, files_hash, primary_path, file_count, content_hash,
        format_name, module_hash, format_explicit, saved_by, saved_at, run, source)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      version.id,
      version.document,
      version.number,
      summary.files_hash,
      summary.primary_path,
      summary.file_count,
      version.content_hash,
      version.format.name,
      version.format.module_hash,
      version.format.explicit ? 1 : 0,
      version.saved_by,
      version.saved_at,
      version.run,
      version.source === null ? null : JSON.stringify(version.source),
    ],
  );
  const files = Array.isArray(version.files) ? version.files : [];
  for (const file of files) {
    tx.sql.run(
      `INSERT INTO version_files
         (version, path, blob_hash, bytes, media_type, primary_file)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        version.id,
        file.path,
        file.blob_hash,
        file.bytes,
        file.media_type,
        file.primary ? 1 : 0,
      ],
    );
  }
}

export function maxVersionNumber(sql: Sql, document: string): number | null {
  const row = sql.get(
    `SELECT MAX(number) AS max_number FROM versions WHERE document = ?`,
    [document],
  );
  const value = row === undefined ? undefined : integer(row, "max_number");
  return value === undefined ? null : value;
}

export type DocumentListFilter = {
  place?: { kind: string; id: string } | null;
  status?: string;
  limit: number;
  offset: number;
};

export function listDocuments(
  sql: Sql,
  filter: DocumentListFilter,
): Result<Document[]> {
  const where: string[] = [];
  const params: (string | number | null)[] = [];
  if (filter.place !== undefined) {
    if (filter.place === null) {
      where.push("place_kind IS NULL");
    } else {
      where.push("place_kind = ? AND place_id = ?");
      params.push(filter.place.kind, filter.place.id);
    }
  }
  if (filter.status !== undefined) {
    where.push("status = ?");
    params.push(filter.status);
  }
  const clause = where.length === 0 ? "" : `WHERE ${where.join(" AND ")}`;
  const rows = sql.all(
    `SELECT ${DOCUMENT_COLUMNS} FROM documents ${clause}
     ORDER BY id LIMIT ? OFFSET ?`,
    [...params, filter.limit, filter.offset],
  );
  const documents: Document[] = [];
  for (const row of rows) {
    const parsed = documentFromRow(row);
    if (!parsed.ok) return parsed;
    documents.push(parsed.value);
  }
  return ok(documents);
}

export function listVersions(
  sql: Sql,
  document: string,
  range: { from?: number; to?: number; limit: number; offset: number },
): Result<VersionRow[]> {
  const where = ["document = ?"];
  const params: (string | number)[] = [document];
  if (range.from !== undefined) {
    where.push("number >= ?");
    params.push(range.from);
  }
  if (range.to !== undefined) {
    where.push("number <= ?");
    params.push(range.to);
  }
  const rows = sql.all(
    `SELECT * FROM versions WHERE ${where.join(" AND ")}
     ORDER BY number LIMIT ? OFFSET ?`,
    [...params, range.limit, range.offset],
  );
  const versions: VersionRow[] = [];
  for (const row of rows) {
    const parsed = versionFromRow(row);
    if (!parsed.ok) return parsed;
    versions.push(parsed.value);
  }
  return ok(versions);
}
