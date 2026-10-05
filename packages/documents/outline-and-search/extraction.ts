// format runner(T4) 결과를 derived에 심는 기록과 재생성 target 계산.
// consumer가 결과를 받아 한 derived transaction에 심는다(architecture/documents 7.4).
// 재생성·재파생은 ledger에 아무것도 쓰지 않는다. model·agent run을 시작하지 않는다.
import { ok, type Result } from "../../base/mod.ts";
import { z } from "zod";
import type { SchemaStep } from "../../contracts/platform/mod.ts";
import {
  DERIVED_SEARCH_DB,
  type DerivedStore,
  type DerivedTx,
  rebuildPath,
} from "./adapters/store.ts";
import { estimatedTokens, lineCount, lineOffsets } from "./model.ts";
import { OMISSION_FAILED } from "./work.ts";

export type ExtractionRecord = {
  document: string;
  version: string;
  content_hash: string;
  module_hash: string;
  extraction: {
    status: "ready" | "unsupported" | "unverified" | "failed";
    title?: string | null;
    text?: string;
    text_hash?: string;
    failure_reason?: string;
    sections?: {
      key: string;
      title: string;
      parent: string | null;
      position: number;
      level: number;
      anchor: string | null;
      own_ranges: { start_line: number; end_line: number }[];
      subtree_range: { start_line: number; end_line: number };
      characters: number;
      body_hash: string;
    }[];
  };
};

// consumer가 format runner(T4) 결과를 받아 한 derived transaction에 심는다.
// ready ver만 search_rows에 선다. 실패 판은 이유를 남기고 cursor가 진행한다.
export function recordExtraction(
  store: DerivedStore,
  record: ExtractionRecord,
  savedSeq: string,
): Result<void> {
  return store.transaction((tx) => {
    const extraction = record.extraction;
    tx.sql.run(
      `INSERT OR REPLACE INTO derived_versions
         (version, document, content_hash, module_hash, extraction_status,
          text_hash, line_count, section_count, failure_reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.version,
        record.document,
        record.content_hash,
        record.module_hash,
        extraction.status,
        extraction.text_hash ?? null,
        extraction.status === "ready" && extraction.text !== undefined
          ? lineCount(extraction.text)
          : null,
        extraction.status === "ready" ? extraction.sections?.length ?? 0 : 0,
        extraction.status === "failed"
          ? extraction.failure_reason ?? OMISSION_FAILED
          : null,
      ],
    );
    if (extraction.status === "ready" && extraction.text !== undefined) {
      writeReadyArtifacts(extraction, tx, record);
    }
    writeSearchRows(extraction, tx, record, savedSeq);
    return ok(undefined);
  });
}

function writeReadyArtifacts(
  extraction: ExtractionRecord["extraction"],
  tx: DerivedTx,
  record: ExtractionRecord,
): void {
  const text = extraction.text as string;
  tx.sql.run(
    `INSERT OR REPLACE INTO derived_texts (version, text_hash, text, line_offsets)
     VALUES (?, ?, ?, ?)`,
    [
      record.version,
      extraction.text_hash ?? "",
      text,
      JSON.stringify(lineOffsets(text)),
    ],
  );
  const sections = extraction.sections ?? [];
  for (const section of sections) {
    tx.sql.run(
      `INSERT OR REPLACE INTO derived_sections
         (version, key, title, parent, position, level, anchor,
          own_ranges, subtree_range, characters, estimated_tokens,
          body_hash, children_count)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        record.version,
        section.key,
        section.title,
        section.parent,
        section.position,
        section.level,
        section.anchor,
        JSON.stringify(section.own_ranges),
        JSON.stringify(section.subtree_range),
        section.characters,
        estimatedTokens(section.characters),
        section.body_hash,
        countChildren(sections, section.key),
      ],
    );
  }
}

function countChildren(
  sections: readonly { parent: string | null }[],
  key: string,
): number {
  // children_count는 자기 key를 parent로 두는 목록이다. 같은 key를 parent로 두는
  // section이 여럿이면 모두 센다.
  let count = 0;
  for (const section of sections) {
    if (section.parent === key) count += 1;
  }
  return count;
}

function writeSearchRows(
  extraction: ExtractionRecord["extraction"],
  tx: DerivedTx,
  record: ExtractionRecord,
  savedSeq: string,
): void {
  tx.sql.run(
    `INSERT OR REPLACE INTO search_documents
       (document, indexed_version, title, name, place_kind, place_id, status, saved_seq)
     VALUES (?, ?, ?, NULL, NULL, NULL, 'active', ?)`,
    [record.document, record.version, record.document, savedSeq],
  );
  tx.sql.run(`DELETE FROM search_rows WHERE document = ?`, [record.document]);
  if (extraction.status === "ready" && extraction.text !== undefined) {
    const text = extraction.text as string;
    const sections = extraction.sections ?? [];
    const rows = sections.length > 0
      ? sections.map((section) => ({
        key: section.key as string | null,
        title: section.title as string,
        body: sectionBody(text, section.own_ranges),
        ranges: JSON.stringify(section.own_ranges),
      }))
      : [{
        key: null,
        title: extraction.title ?? record.document,
        body: text,
        ranges: JSON.stringify([]),
      }];
    for (const row of rows) {
      tx.sql.run(
        `INSERT INTO search_rows (document, version, section_key, ranges, title, body)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          record.document,
          record.version,
          row.key,
          row.ranges,
          row.title,
          row.body,
        ],
      );
    }
  }
}

function sectionBody(
  text: string,
  ownRanges: readonly { start_line: number; end_line: number }[],
): string {
  const lines = text.split("\n");
  const parts: string[] = [];
  for (const range of ownRanges) {
    for (let line = range.start_line; line <= range.end_line; line++) {
      const value = lines[line - 1];
      if (value !== undefined) parts.push(value);
    }
  }
  return parts.join("\n");
}

// 재생성 파일의 이름·target. 교체는 writer 연결·WAL을 닫은 뒤 한다.
export function rebuildTarget(root: string): { path: string; name: string } {
  return { path: rebuildPath(root), name: DERIVED_SEARCH_DB };
}

// recordExtraction의 subtree·own range 형식. 기록 전에 검사한다.
const sectionRangeSchema = z.object({
  start_line: z.number().int().positive(),
  end_line: z.number().int().positive(),
});
export const extractionSectionSchema = z.object({
  key: z.string().min(1),
  title: z.string(),
  parent: z.string().nullable(),
  position: z.number().int().nonnegative(),
  level: z.number().int().min(0).max(6),
  anchor: z.string().nullable(),
  own_ranges: z.array(sectionRangeSchema),
  subtree_range: sectionRangeSchema,
  characters: z.number().int().nonnegative(),
  body_hash: z.string().min(1),
});
export type { SchemaStep as ExtractionSchemaStep };
