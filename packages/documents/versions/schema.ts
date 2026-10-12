import type { SchemaStep } from "../../protocol/platform/mod.ts";

// GLOB은 문자 클래스 하나마다 패턴 길이를 세므로 긴 패턴은 거절된다.
// 접두사·정확한 길이를 여기서 고정하고 문자 집합은 행을 읽는 쪽에서 schema로 다시 검사한다.
const idCheck = (prefix: string) =>
  `id GLOB '${prefix}_*' AND length(id) = ${prefix.length + 1 + 26}`;
const hashCheck = (column: string) =>
  `${column} GLOB '[0-9a-f]*' AND length(${column}) = 64`;
const SEQ =
  "length(revision) > 0 AND substr(revision, 1, 1) BETWEEN '1' AND '9'" +
  " AND revision NOT GLOB '*[^0-9]*'" +
  " AND (length(revision) < 19 OR" +
  " (length(revision) = 19 AND revision <= '9223372036854775807'))";

// documents·versions 표(domain-model/documents/versions ledger 표).
// 확정 판은 바꾸는 경로가 없다. 영구 삭제도 없다. 보관만 한다.
export const versionsSchemaSteps: readonly SchemaStep[] = [{
  id: "documents.versions.tables",
  sql: `
    CREATE TABLE documents (
      id TEXT PRIMARY KEY NOT NULL CHECK (${idCheck("doc")}),
      place_kind TEXT CHECK (place_kind IN ('project', 'app')),
      place_id TEXT,
      name TEXT,
      title TEXT NOT NULL CHECK (length(title) > 0),
      source_kind TEXT CHECK (source_kind IN ('project_file', 'instruction_file')),
      source_instruction_target TEXT,
      source_project TEXT,
      source_path TEXT,
      latest_version TEXT NOT NULL,
      revision TEXT NOT NULL CHECK (${SEQ}),
      status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
      CHECK (
        (place_kind IS NULL AND place_id IS NULL AND name IS NULL) OR
        (place_kind IS NOT NULL AND place_id IS NOT NULL AND name IS NOT NULL)
      ),
      CHECK (
        (source_kind IS NULL AND source_instruction_target IS NULL
          AND source_project IS NULL AND source_path IS NULL) OR
        (source_kind = 'project_file' AND source_instruction_target IS NULL
          AND source_project IS NOT NULL AND source_path IS NOT NULL) OR
        (source_kind = 'instruction_file' AND source_instruction_target IS NOT NULL
          AND source_path IS NOT NULL)
      )
    ) STRICT;
    CREATE UNIQUE INDEX documents_place_name
      ON documents(place_kind, place_id, name) WHERE place_kind IS NOT NULL;
    CREATE UNIQUE INDEX documents_source_path
      ON documents(source_path) WHERE source_path IS NOT NULL;
    CREATE INDEX documents_status_place
      ON documents(status, place_kind, place_id, id);
    CREATE INDEX documents_latest_version ON documents(latest_version);
    CREATE TRIGGER documents_no_identity_change
      BEFORE UPDATE OF id ON documents
      WHEN NEW.id <> OLD.id
      BEGIN SELECT RAISE(ABORT, 'document identity is immutable'); END;
    CREATE TRIGGER documents_no_delete BEFORE DELETE ON documents
      BEGIN SELECT RAISE(ABORT, 'documents are archived, not deleted'); END;

    CREATE TABLE versions (
      id TEXT PRIMARY KEY NOT NULL CHECK (${idCheck("ver")}),
      document TEXT NOT NULL REFERENCES documents(id),
      number INTEGER NOT NULL CHECK (number >= 1),
      files_hash TEXT NOT NULL CHECK (${hashCheck("files_hash")}),
      primary_path TEXT NOT NULL CHECK (length(primary_path) > 0),
      file_count INTEGER NOT NULL CHECK (file_count >= 1),
      content_hash TEXT NOT NULL CHECK (${hashCheck("content_hash")}),
      format_name TEXT NOT NULL CHECK (length(format_name) > 0),
      module_hash TEXT NOT NULL CHECK (${hashCheck("module_hash")}),
      format_explicit INTEGER NOT NULL CHECK (format_explicit IN (0, 1)),
      saved_by TEXT NOT NULL CHECK (length(saved_by) > 0),
      saved_at TEXT NOT NULL CHECK (length(saved_at) > 0),
      run TEXT,
      source TEXT,
      CHECK (saved_by NOT GLOB 'agent:*' OR run IS NOT NULL),
      UNIQUE (document, number),
      UNIQUE (document, id)
    ) STRICT;
    CREATE INDEX versions_document_number ON versions(document, number DESC);
    CREATE INDEX versions_run_document ON versions(run, document);
    CREATE TRIGGER versions_no_update BEFORE UPDATE ON versions
      BEGIN SELECT RAISE(ABORT, 'versions are immutable'); END;
    CREATE TRIGGER versions_no_delete BEFORE DELETE ON versions
      BEGIN SELECT RAISE(ABORT, 'versions are never deleted'); END;

    CREATE TABLE version_files (
      version TEXT NOT NULL REFERENCES versions(id),
      path TEXT NOT NULL,
      blob_hash TEXT NOT NULL CHECK (${hashCheck("blob_hash")}),
      bytes INTEGER NOT NULL CHECK (bytes >= 0),
      media_type TEXT NOT NULL,
      primary_file INTEGER NOT NULL CHECK (primary_file IN (0, 1)),
      PRIMARY KEY (version, path)
    ) STRICT;

  `,
}];
