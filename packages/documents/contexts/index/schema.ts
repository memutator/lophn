import type { SchemaStep } from "../../../protocol/platform/mod.ts";

// derived/contexts.sqlite의 표(docs/architecture/documents.md 3.2). 정본이 아니고 지우면 다시 만든다.
// 개체·위반의 순서(ord)는 추출·검사가 낸 canonical 순서다. 같은 key의 개체가 둘일 수 있어
// (unique 규칙이 그것을 위반으로 센다) key는 기본키가 아니다.
export const indexSchemaSteps: readonly SchemaStep[] = [{
  id: "documents.contexts.index.tables",
  sql: `
    CREATE TABLE index_state (
      context TEXT PRIMARY KEY NOT NULL,
      bundle_hash TEXT NOT NULL,
      scanned_at TEXT NOT NULL,
      result TEXT NOT NULL CHECK (result IN ('complete', 'partial', 'failed'))
    ) STRICT;

    CREATE TABLE index_files (
      context TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      bundle_hash TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('ok', 'failed')),
      reason TEXT,
      PRIMARY KEY (context, path)
    ) STRICT;

    CREATE TABLE index_entities (
      context TEXT NOT NULL,
      ord INTEGER NOT NULL,
      type TEXT NOT NULL,
      id TEXT NOT NULL,
      path TEXT NOT NULL,
      section TEXT,
      fields TEXT NOT NULL,
      links TEXT NOT NULL,
      source_kind TEXT NOT NULL,
      PRIMARY KEY (context, ord)
    ) STRICT;
    CREATE INDEX index_entities_type_id ON index_entities(context, type, id);
    CREATE INDEX index_entities_path ON index_entities(context, path);

    CREATE TABLE index_violations (
      context TEXT NOT NULL,
      ord INTEGER NOT NULL,
      kind TEXT NOT NULL,
      rule TEXT,
      type TEXT NOT NULL,
      path TEXT NOT NULL,
      section TEXT,
      target TEXT,
      PRIMARY KEY (context, ord)
    ) STRICT;
  `,
}];
