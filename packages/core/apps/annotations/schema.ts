import type { SchemaStep } from "../../../protocol/server/mod.ts";

// annotation 표. 묶음은 보낸 사실이고 annotation은 그 안의 한 칸이다. cross-owner FK(apps, releases)는
// 두지 않는다. 앱 존재와 보관은 command가 같은 transaction에서 검사한다.
// annotation_refs는 이 annotation을 가리키는 session 기록(session_message)과 ticket이다.
// 하나도 없어진 annotation은 sweep이 지운다.
export const annotationSchemaSteps: readonly SchemaStep[] = [{
  id: "apps.annotations.tables",
  sql: `
    CREATE TABLE annotation_batches (
      id TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL,
      sent_at TEXT NOT NULL,
      sent_by TEXT NOT NULL
    ) STRICT;
    CREATE INDEX annotation_batches_app ON annotation_batches(app, id);

    CREATE TABLE annotations (
      id TEXT PRIMARY KEY NOT NULL,
      batch TEXT NOT NULL REFERENCES annotation_batches(id),
      app TEXT NOT NULL,
      n INTEGER NOT NULL CHECK (n >= 1),
      kind TEXT NOT NULL CHECK (kind IN ('element', 'region')),
      note TEXT NOT NULL,
      screenshot_hash TEXT,
      screenshot_size INTEGER,
      component TEXT,
      source_file TEXT,
      source_line INTEGER,
      element TEXT NOT NULL CHECK (json_valid(element)),
      rect TEXT NOT NULL CHECK (json_valid(rect)),
      view TEXT NOT NULL CHECK (json_valid(view)),
      release TEXT NOT NULL,
      bundle_position TEXT CHECK (bundle_position IS NULL OR json_valid(bundle_position)),
      UNIQUE (batch, n),
      CHECK ((screenshot_hash IS NULL) = (screenshot_size IS NULL)),
      CHECK ((source_file IS NULL) = (source_line IS NULL))
    ) STRICT;

    CREATE TABLE annotation_refs (
      annotation TEXT NOT NULL REFERENCES annotations(id),
      owner_kind TEXT NOT NULL CHECK (owner_kind IN ('session_message', 'ticket')),
      owner_id TEXT NOT NULL,
      PRIMARY KEY (annotation, owner_kind, owner_id)
    ) STRICT;
    CREATE INDEX annotation_refs_owner ON annotation_refs(owner_kind, owner_id);
  `,
}];
