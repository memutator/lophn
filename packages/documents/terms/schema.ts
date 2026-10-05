import type { SchemaStep } from "../../contracts/platform/mod.ts";

// GLOB은 문자 클래스 하나마다 패턴 길이를 세므로 긴 패턴은 거절된다(contexts 표와 같다).
// 접두사·정확한 길이를 여기서 고정하고 문자 집합은 schema에서 다시 검사한다.
const idCheck = (column: string, prefix: string) =>
  `${column} GLOB '${prefix}_*' AND length(${column}) = ${
    prefix.length + 1 + 26
  }`;
const SEQ =
  "length(revision) > 0 AND substr(revision, 1, 1) BETWEEN '1' AND '9'" +
  " AND revision NOT GLOB '*[^0-9]*'" +
  " AND (length(revision) < 19 OR" +
  " (length(revision) = 19 AND revision <= '9223372036854775807'))";

// terms·term_evidence 표(domain-model/documents/terms ledger 표).
// 용어는 보관만 하고 삭제하지 않는다. 정의를 지워 후보로 되돌리는 경로도 없다:
// definition이 null이 아닌 행을 null로 바꾸는 UPDATE는 trigger가 막는다.
// 같은 context의 active 이름은 정확한 문자열로 유일하다(partial unique index).
// term_evidence의 version은 versions 표를 참조한다. 그 version이 근거 document의
// 판인지는 command가 검사한다(versions 표의 document 열과 짝을 맞추는 일).
export const termsSchemaSteps: readonly SchemaStep[] = [{
  id: "documents.terms.tables",
  sql: `
    CREATE TABLE terms (
      id TEXT PRIMARY KEY NOT NULL CHECK (${idCheck("id", "trm")}),
      context TEXT NOT NULL REFERENCES contexts(id)
        CHECK (${idCheck("context", "ctx")}),
      name TEXT NOT NULL CHECK (length(trim(name)) > 0),
      definition TEXT CHECK (definition IS NULL OR length(trim(definition)) > 0),
      revision TEXT NOT NULL CHECK (${SEQ}),
      status TEXT NOT NULL CHECK (status IN ('active', 'archived'))
    ) STRICT;
    CREATE UNIQUE INDEX terms_active_name ON terms(context, name)
      WHERE status = 'active';
    CREATE INDEX terms_context_status_name ON terms(context, status, name);
    CREATE INDEX terms_context_definition ON terms(context, definition);
    CREATE TRIGGER terms_no_identity_change
      BEFORE UPDATE OF id, context ON terms
      WHEN NEW.id <> OLD.id OR NEW.context <> OLD.context
      BEGIN SELECT RAISE(ABORT, 'term identity and context are immutable'); END;
    CREATE TRIGGER terms_no_delete BEFORE DELETE ON terms
      BEGIN SELECT RAISE(ABORT, 'terms are archived, not deleted'); END;
    CREATE TRIGGER terms_no_undefine BEFORE UPDATE OF definition ON terms
      WHEN OLD.definition IS NOT NULL AND NEW.definition IS NULL
      BEGIN SELECT RAISE(ABORT, 'a defined term cannot return to a candidate'); END;

    CREATE TABLE term_evidence (
      term TEXT NOT NULL REFERENCES terms(id),
      position INTEGER NOT NULL CHECK (position >= 0),
      document TEXT NOT NULL CHECK (${idCheck("document", "doc")}),
      version TEXT NOT NULL REFERENCES versions(id),
      section TEXT CHECK (section IS NULL OR length(section) > 0),
      start_line INTEGER CHECK (start_line IS NULL OR start_line >= 1),
      end_line INTEGER CHECK (end_line IS NULL OR end_line >= 1),
      PRIMARY KEY (term, position),
      CHECK ((start_line IS NULL) = (end_line IS NULL)),
      CHECK (start_line IS NULL OR end_line >= start_line)
    ) STRICT;
    CREATE UNIQUE INDEX term_evidence_same ON term_evidence(
      term, document, version, COALESCE(section, ''),
      COALESCE(start_line, -1), COALESCE(end_line, -1)
    );
    CREATE INDEX term_evidence_version ON term_evidence(version);
  `,
}];
