import type { SchemaStep } from "../../../protocol/server/mod.ts";

// derived store 8개 표(docs/domain-model/documents/outline-and-search.md).
// ledger 밖 derived data다. ledger의 ver·doc·event는 논리 참조고 물리 FK는 없다.
// coordinator가 유일한 writer이고 read는 별도 연결이다(query_only).
//
// STRICT 표의 복합 PRIMARY KEY는 모든 열에 NOT NULL을 요구한다. 그래서 null-safe
// key(PK (version, key)의 key null, PK (version, section_key)의 section_key null)는
// non-STRICT 복합 PK 또는 rowid PK + COALESCE unique expression index로 둔다.
export const outlineAndSearchSchemaSteps: readonly SchemaStep[] = [
  {
    id: "documents.outline-and-search.tables",
    sql: `
    CREATE TABLE derived_versions (
      version TEXT PRIMARY KEY NOT NULL,
      document TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      module_hash TEXT NOT NULL,
      extraction_status TEXT NOT NULL CHECK (extraction_status IN ('ready', 'unsupported', 'unverified', 'failed')),
      text_hash TEXT,
      line_count INTEGER,
      section_count INTEGER NOT NULL CHECK (section_count >= 0),
      failure_reason TEXT,
      CHECK ((extraction_status = 'failed') = (failure_reason IS NOT NULL)),
      CHECK (extraction_status <> 'ready' OR line_count IS NOT NULL)
    ) STRICT;
    CREATE INDEX derived_versions_document ON derived_versions(document);

    CREATE TABLE derived_sections (
      version TEXT NOT NULL,
      key TEXT NOT NULL,
      title TEXT NOT NULL,
      parent TEXT,
      position INTEGER NOT NULL CHECK (position >= 0),
      level INTEGER NOT NULL CHECK (level BETWEEN 0 AND 6),
      anchor TEXT,
      own_ranges TEXT NOT NULL,
      subtree_range TEXT NOT NULL,
      characters INTEGER NOT NULL CHECK (characters >= 0),
      estimated_tokens INTEGER NOT NULL CHECK (estimated_tokens = (characters + 2) / 3),
      body_hash TEXT NOT NULL,
      children_count INTEGER NOT NULL CHECK (children_count >= 0),
      PRIMARY KEY (version, key)
    );
    CREATE UNIQUE INDEX derived_sections_position ON derived_sections(version, position);
    CREATE INDEX derived_sections_parent ON derived_sections(version, parent, position);

    CREATE TABLE derived_texts (
      version TEXT PRIMARY KEY NOT NULL,
      text_hash TEXT NOT NULL,
      text TEXT NOT NULL,
      line_offsets TEXT NOT NULL
    );

    CREATE TABLE search_documents (
      document TEXT PRIMARY KEY NOT NULL,
      indexed_version TEXT NOT NULL,
      title TEXT NOT NULL,
      name TEXT,
      place_kind TEXT,
      place_id TEXT,
      status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
      saved_seq TEXT NOT NULL,
      UNIQUE (document, indexed_version)
    );
    CREATE INDEX search_documents_place ON search_documents(status, place_kind, place_id);

    CREATE TABLE search_rows (
      rowid INTEGER PRIMARY KEY,
      document TEXT NOT NULL,
      version TEXT NOT NULL,
      section_key TEXT,
      ranges TEXT NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      FOREIGN KEY (document) REFERENCES search_documents(document)
    );
    CREATE UNIQUE INDEX search_rows_section
      ON search_rows(document, COALESCE(section_key, ''));
    CREATE INDEX search_rows_version ON search_rows(version);

    CREATE VIRTUAL TABLE search_fts USING fts5(
      title,
      body,
      content='search_rows',
      content_rowid='rowid',
      tokenize='trigram'
    );
    CREATE TRIGGER search_rows_fts_insert AFTER INSERT ON search_rows BEGIN
      INSERT INTO search_fts(rowid, title, body) VALUES (new.rowid, new.title, new.body);
    END;
    CREATE TRIGGER search_rows_fts_delete AFTER DELETE ON search_rows BEGIN
      INSERT INTO search_fts(search_fts, rowid, title, body) VALUES ('delete', old.rowid, old.title, old.body);
    END;

    CREATE TABLE summary_cache (
      version TEXT NOT NULL,
      section_key TEXT,
      input_hash TEXT NOT NULL,
      text TEXT,
      PRIMARY KEY (version, section_key)
    );

    CREATE TABLE derived_cursors (
      consumer TEXT PRIMARY KEY NOT NULL CHECK (consumer IN ('search')),
      processed_seq TEXT NOT NULL,
      rebuilding INTEGER NOT NULL CHECK (rebuilding IN (0, 1)),
      rebuild_basis_seq TEXT
    );
  `,
  },
  {
    // 확인하지 못한 판(unverified)이 이유를 남긴다(대표 파일이 추출 한도를 넘음 같은 것).
    // failed의 failure_reason과 CHECK가 묶여 있어 따로 둔다.
    id: "documents.outline-and-search.unverified-reason",
    sql: `ALTER TABLE derived_versions ADD COLUMN unverified_reason TEXT;`,
  },
];
