// terms·term_evidence 표의 행 읽기·쓰기. command와 read가 같이 쓴다.

import { err, ok, type Result } from "../../base/mod.ts";
import type { Term, TermEvidence } from "../../contracts/documents/mod.ts";
import type { Sql, SqlRow, Tx } from "../../contracts/platform/mod.ts";

type Reader = Pick<Sql, "get" | "all">;

function text(row: SqlRow, column: string): string | undefined {
  const value = row[column];
  return typeof value === "string" ? value : undefined;
}

function integer(row: SqlRow, column: string): number | null | undefined {
  const value = row[column];
  if (value === null) return null;
  if (typeof value === "bigint") return Number(value);
  return typeof value === "number" ? value : undefined;
}

function invalidRow(): Result<never> {
  return err({ code: "internal", message: "stored term row is invalid" });
}

const TERM_COLUMNS = "id, context, name, definition, revision, status";

function evidenceFromRow(row: SqlRow): Result<TermEvidence> {
  const document = text(row, "document");
  const version = text(row, "version");
  const start = integer(row, "start_line");
  const end = integer(row, "end_line");
  const section = row["section"];
  if (
    document === undefined || version === undefined ||
    start === undefined || end === undefined ||
    (section !== null && typeof section !== "string")
  ) return invalidRow();
  return ok({
    document,
    version,
    section: section as string | null,
    start_line: start,
    end_line: end,
  } as TermEvidence);
}

export function listEvidence(
  sql: Reader,
  term: string,
): Result<TermEvidence[]> {
  const rows = sql.all(
    `SELECT document, version, section, start_line, end_line
     FROM term_evidence WHERE term = ? ORDER BY position`,
    [term],
  );
  const items: TermEvidence[] = [];
  for (const row of rows) {
    const parsed = evidenceFromRow(row);
    if (!parsed.ok) return parsed;
    items.push(parsed.value);
  }
  return ok(items);
}

function termFromRow(sql: Reader, row: SqlRow): Result<Term> {
  const status = text(row, "status");
  const revision = text(row, "revision");
  const id = text(row, "id");
  const context = text(row, "context");
  const name = text(row, "name");
  const definition = row["definition"];
  if (
    (status !== "active" && status !== "archived") || revision === undefined ||
    id === undefined || context === undefined || name === undefined ||
    (definition !== null && typeof definition !== "string")
  ) return invalidRow();
  const evidence = listEvidence(sql, id);
  if (!evidence.ok) return evidence;
  return ok({
    id,
    context,
    name,
    definition: definition as string | null,
    evidence: evidence.value,
    revision,
    status,
  } as Term);
}

export function loadTerm(sql: Reader, id: string): Result<Term | null> {
  const row = sql.get(`SELECT ${TERM_COLUMNS} FROM terms WHERE id = ?`, [id]);
  return row === undefined ? ok(null) : termFromRow(sql, row);
}

// 같은 context의 active 이름이 이미 쓰이는가. 정확한 문자열 비교다.
export function activeNameOwner(
  sql: Reader,
  context: string,
  name: string,
): string | null {
  const row = sql.get(
    `SELECT id FROM terms WHERE context = ? AND name = ? AND status = 'active'`,
    [context, name],
  );
  return row === undefined ? null : String(row["id"]);
}

// active 정의(definition 있음)나 후보(definition 없음)를 이름 순으로 읽는다.
export function listActive(
  sql: Reader,
  context: string,
  kind: "definitions" | "candidates",
  range: { offset: number; limit: number },
): Result<Term[]> {
  const rows = sql.all(
    `SELECT ${TERM_COLUMNS} FROM terms
     WHERE context = ? AND status = 'active' AND definition IS ${
      kind === "definitions" ? "NOT NULL" : "NULL"
    }
     ORDER BY name, id LIMIT ? OFFSET ?`,
    [context, range.limit, range.offset],
  );
  const terms: Term[] = [];
  for (const row of rows) {
    const parsed = termFromRow(sql, row);
    if (!parsed.ok) return parsed;
    terms.push(parsed.value);
  }
  return ok(terms);
}

export type TermHead = {
  id: string;
  context: string;
  name: string;
  definition: string | null;
  revision: string;
  status: "active" | "archived";
};

export function insertTerm(tx: Tx, term: TermHead): void {
  tx.sql.run(
    `INSERT INTO terms (${TERM_COLUMNS}) VALUES (?, ?, ?, ?, ?, ?)`,
    [
      term.id,
      term.context,
      term.name,
      term.definition,
      term.revision,
      term.status,
    ],
  );
}

export function updateTerm(tx: Tx, term: TermHead): void {
  tx.sql.run(
    `UPDATE terms SET name = ?, definition = ?, revision = ?, status = ?
     WHERE id = ?`,
    [term.name, term.definition, term.revision, term.status, term.id],
  );
}

// 근거 교체는 term의 revision·event와 같은 transaction에서만 부른다.
export function replaceEvidence(
  tx: Tx,
  term: string,
  items: readonly TermEvidence[],
): void {
  tx.sql.run(`DELETE FROM term_evidence WHERE term = ?`, [term]);
  insertEvidence(tx, term, items);
}

export function insertEvidence(
  tx: Tx,
  term: string,
  items: readonly TermEvidence[],
): void {
  for (let position = 0; position < items.length; position += 1) {
    const item = items[position];
    tx.sql.run(
      `INSERT INTO term_evidence
         (term, position, document, version, section, start_line, end_line)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        term,
        position,
        item.document,
        item.version,
        item.section,
        item.start_line,
        item.end_line,
      ],
    );
  }
}
