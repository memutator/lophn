import type { SchemaStep } from "../../contracts/platform/mod.ts";

// GLOB은 문자 클래스 하나마다 패턴 길이를 세므로 긴 패턴은 거절된다(versions 표와 같다).
// 접두사·정확한 길이를 여기서 고정하고 문자 집합은 schema에서 다시 검사한다.
const idCheck = (prefix: string) =>
  `id GLOB '${prefix}_*' AND length(id) = ${prefix.length + 1 + 26}`;
const SEQ =
  "length(revision) > 0 AND substr(revision, 1, 1) BETWEEN '1' AND '9'" +
  " AND revision NOT GLOB '*[^0-9]*'" +
  " AND (length(revision) < 19 OR" +
  " (length(revision) = 19 AND revision <= '9223372036854775807'))";

// contexts·context_items 표(domain-model/documents/contexts ledger 표).
// Context는 Document·App을 소유하지 않는다. 보관만 하고 삭제도 없다.
// context_items는 documents·apps 표에 FK를 걸지 않는다. 항목 제거·보관이
// 대상을 바꾸지 않는다(R7)는 제약의 근거는 handler 검사다.
export const contextsSchemaSteps: readonly SchemaStep[] = [{
  id: "documents.contexts.tables",
  sql: `
    CREATE TABLE contexts (
      id TEXT PRIMARY KEY NOT NULL CHECK (${idCheck("ctx")}),
      title TEXT NOT NULL CHECK (length(title) > 0),
      purpose TEXT NOT NULL CHECK (length(purpose) > 0 AND length(trim(purpose)) > 0),
      revision TEXT NOT NULL CHECK (${SEQ}),
      status TEXT NOT NULL CHECK (status IN ('active', 'archived'))
    ) STRICT;
    CREATE INDEX contexts_status_id ON contexts(status, id);
    CREATE TRIGGER contexts_no_identity_change BEFORE UPDATE OF id ON contexts
      WHEN NEW.id <> OLD.id
      BEGIN SELECT RAISE(ABORT, 'context identity is immutable'); END;
    CREATE TRIGGER contexts_no_delete BEFORE DELETE ON contexts
      BEGIN SELECT RAISE(ABORT, 'contexts are archived, not deleted'); END;

    CREATE TABLE context_items (
      context TEXT NOT NULL REFERENCES contexts(id),
      target_key TEXT NOT NULL CHECK (length(target_key) > 0),
      position INTEGER NOT NULL CHECK (position >= 0),
      target_kind TEXT NOT NULL CHECK (target_kind IN ('document', 'app_command')),
      document TEXT,
      section TEXT,
      app TEXT,
      command TEXT,
      perspective TEXT NOT NULL CHECK (perspective IN ('basis', 'reference', 'watch')),
      reason TEXT NOT NULL CHECK (length(trim(reason)) > 0),
      PRIMARY KEY (context, target_key),
      UNIQUE (context, position),
      CHECK (
        (target_kind = 'document' AND document IS NOT NULL
          AND app IS NULL AND command IS NULL) OR
        (target_kind = 'app_command' AND document IS NULL AND section IS NULL
          AND app IS NOT NULL AND command IS NOT NULL AND length(command) > 0)
      ),
      CHECK (section IS NULL OR length(section) > 0)
    ) STRICT;
    CREATE INDEX context_items_document ON context_items(document, perspective);
    CREATE INDEX context_items_app ON context_items(app, command);
    CREATE INDEX context_items_context ON context_items(context, perspective);
  `,
}];
