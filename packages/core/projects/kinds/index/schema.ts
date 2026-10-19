import type { SchemaStep } from "../../../../protocol/server/mod.ts";

// derived/kinds.sqlite의 표. 정본이 아니고 지우면 다시 만든다. 잃는 것은 kinds_applied(앞에 맞던 kinds 파일)
// 하나뿐이다. item과 위반의 순서(ord)는 추출·검사가 낸 canonical 순서다. 같은 key의 item이 둘일 수 있어
// (unique 규칙이 위반으로 센다) key는 기본키가 아니다.
export const indexSchemaSteps: readonly SchemaStep[] = [{
  id: "documents.kinds.index.tables",
  sql: `
    CREATE TABLE kinds_applied (
      domain TEXT PRIMARY KEY NOT NULL,
      hash TEXT NOT NULL,
      text TEXT NOT NULL
    ) STRICT;

    CREATE TABLE kinds_state (
      domain TEXT PRIMARY KEY NOT NULL,
      kinds_hash TEXT NOT NULL,
      scanned_ms INTEGER NOT NULL,
      status_json TEXT NOT NULL
    ) STRICT;

    CREATE TABLE kinds_files (
      domain TEXT NOT NULL,
      path TEXT NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      kind TEXT,
      status TEXT NOT NULL CHECK (status IN ('ok', 'skipped')),
      PRIMARY KEY (domain, path)
    ) STRICT;

    CREATE TABLE kinds_items (
      domain TEXT NOT NULL,
      ord INTEGER NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      path TEXT NOT NULL,
      file TEXT NOT NULL,
      fields TEXT NOT NULL,
      PRIMARY KEY (domain, ord)
    ) STRICT;
    CREATE INDEX kinds_items_kind ON kinds_items(domain, kind);

    CREATE TABLE kinds_violations (
      domain TEXT NOT NULL,
      ord INTEGER NOT NULL,
      source TEXT NOT NULL,
      kind TEXT,
      path TEXT,
      field TEXT,
      rule TEXT NOT NULL,
      message TEXT NOT NULL,
      PRIMARY KEY (domain, ord)
    ) STRICT;
  `,
}];
