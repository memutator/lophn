// context 목차(`/v1/outline/context`)가 읽는 glossary 근원. 활성 정의와 후보를 나눠
// 이름 순으로 처음 limit개씩 준다. 근거에는 문서 위치(place)를 붙여 목차가 권한 밖
// 문서의 근거를 빼게 한다. outline-and-search는 이 모듈을 import하지 않고 같은
// 모양의 값만 주입받는다(context 목차 source와 같은 방식이다).

import { err, ok, type Result } from "../../base/mod.ts";
import type { Sql } from "../../contracts/platform/mod.ts";
import { loadDocument } from "../versions/mod.ts";
import { listActive } from "./store.ts";
import type { Term } from "../../contracts/documents/mod.ts";

export type GlossaryEvidenceRecord = {
  document: string;
  version: string;
  section: string | null;
  start_line: number | null;
  end_line: number | null;
  place: { kind: "project" | "app"; id: string } | null;
};

export type GlossaryTermRecord = {
  id: string;
  context: string;
  name: string;
  definition: string | null;
  revision: string;
  status: "active" | "archived";
  evidence: GlossaryEvidenceRecord[];
};

export type TermGlossaryRecord = {
  definitions: GlossaryTermRecord[];
  candidates: GlossaryTermRecord[];
};

export type TermGlossarySource = {
  get(contextId: string, limit: number): Result<TermGlossaryRecord>;
};

function recordOf(sql: Sql, term: Term): Result<GlossaryTermRecord> {
  const evidence: GlossaryEvidenceRecord[] = [];
  for (const item of term.evidence) {
    const document = loadDocument(sql, item.document);
    if (!document.ok) return document;
    // 문서 행이 없는 근거는 읽을 대상이 없다. 위치를 꾸미지 않고 뺀다.
    if (document.value === null) continue;
    evidence.push({
      document: item.document,
      version: item.version,
      section: item.section,
      start_line: item.start_line,
      end_line: item.end_line,
      place: document.value.place,
    });
  }
  return ok({
    id: term.id,
    context: term.context,
    name: term.name,
    definition: term.definition,
    revision: term.revision,
    status: term.status,
    evidence,
  });
}

export function createTermGlossarySource(sql: Sql): TermGlossarySource {
  return {
    get(contextId, limit) {
      if (!Number.isSafeInteger(limit) || limit < 1) {
        return err({ code: "invalid_input", message: "limit is invalid" });
      }
      const result: TermGlossaryRecord = { definitions: [], candidates: [] };
      for (const kind of ["definitions", "candidates"] as const) {
        const terms = listActive(sql, contextId, kind, { offset: 0, limit });
        if (!terms.ok) return terms;
        for (const term of terms.value) {
          const record = recordOf(sql, term);
          if (!record.ok) return record;
          result[kind].push(record.value);
        }
      }
      return ok(result);
    },
  };
}
