// 후보의 본문 출현 확인(질문 Q8). ledger command는 derived store를 읽을 수 없어
// 고정 판의 존재와 참조만 CAS한다. 그래서 route가 command 앞에서 고정 판의 section
// 또는 줄 범위를 읽어 이름이 실제로 나오는지 확인한다. 최신 판으로 바꿔치기하지
// 않는다: 읽을 수 없는 근거(추출 미완료·실패·없는 section·범위 밖)는 출현이 아니다.

import { err, ok, type Result } from "../../base/mod.ts";
import type { TermEvidence } from "../../contracts/documents/mod.ts";

// 고정 판 본문의 근원. 읽을 수 없으면 null이다(추정하지 않는다).
export type EvidenceSource = {
  // section의 own 범위 줄들.
  sectionLines(version: string, key: string): readonly string[] | null;
  // 대표 텍스트의 1-based 줄 범위. 범위가 본문 밖이면 null이다.
  rangeLines(
    version: string,
    start: number,
    end: number,
  ): readonly string[] | null;
};

// 이름은 정확한 문자열로 찾는다(대소문자·Unicode 정규화·번역을 넓히지 않는다).
export function checkTermOccurrence(
  source: EvidenceSource,
  name: string,
  evidence: readonly TermEvidence[],
): Result<void> {
  if (evidence.length === 0) {
    return err({
      code: "invalid_input",
      message: "a candidate needs occurrence evidence",
    });
  }
  for (const item of evidence) {
    if (item.section === null && item.start_line === null) {
      return err({
        code: "invalid_input",
        message: "evidence locates a section or line range",
      });
    }
    // section과 줄 범위가 같이 있으면 section이 있어야 하고 출현은 줄 범위에서 본다.
    const section = item.section === null
      ? undefined
      : source.sectionLines(item.version, item.section);
    if (section === null) {
      return err({
        code: "invalid_input",
        message: "evidence section cannot be read in the fixed version",
      });
    }
    const lines = item.start_line === null ? section : source.rangeLines(
      item.version,
      item.start_line,
      item.end_line as number,
    );
    if (lines === null || lines === undefined) {
      return err({
        code: "invalid_input",
        message: "evidence range cannot be read in the fixed version",
      });
    }
    if (!lines.some((line) => line.includes(name))) {
      return err({
        code: "invalid_input",
        message: "the term name does not occur in the evidence",
      });
    }
  }
  return ok(undefined);
}

type DerivedSql = {
  get(
    sql: string,
    params: readonly unknown[],
  ): Record<string, unknown> | undefined;
};

function ranges(value: unknown): { start: number; end: number }[] | null {
  if (typeof value !== "string") return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) return null;
    const out: { start: number; end: number }[] = [];
    for (const item of parsed) {
      const start = (item as { start_line?: unknown }).start_line;
      const end = (item as { end_line?: unknown }).end_line;
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
        return null;
      }
      out.push({ start: start as number, end: end as number });
    }
    return out;
  } catch {
    return null;
  }
}

// derived store의 추출 결과(derived_versions·derived_sections·derived_texts)를
// 읽는 근원. 추출이 ready가 아닌 판은 읽을 수 없는 판이다.
export function createDerivedEvidenceSource(sql: DerivedSql): EvidenceSource {
  function text(version: string): string[] | null {
    const ready = sql.get(
      `SELECT extraction_status FROM derived_versions WHERE version = ?`,
      [version],
    );
    if (ready === undefined || ready["extraction_status"] !== "ready") {
      return null;
    }
    const row = sql.get(`SELECT text FROM derived_texts WHERE version = ?`, [
      version,
    ]);
    return row === undefined || typeof row["text"] !== "string"
      ? null
      : (row["text"] as string).split("\n");
  }
  return {
    sectionLines(version, key) {
      const lines = text(version);
      if (lines === null) return null;
      const row = sql.get(
        `SELECT own_ranges FROM derived_sections WHERE version = ? AND key = ?`,
        [version, key],
      );
      if (row === undefined) return null;
      const own = ranges(row["own_ranges"]);
      if (own === null) return null;
      const picked: string[] = [];
      for (const range of own) {
        for (let line = range.start; line <= range.end; line += 1) {
          const value = lines[line - 1];
          if (value === undefined) return null;
          picked.push(value);
        }
      }
      return picked;
    },
    rangeLines(version, start, end) {
      const lines = text(version);
      if (lines === null || start < 1 || end < start || end > lines.length) {
        return null;
      }
      return lines.slice(start - 1, end);
    },
  };
}
