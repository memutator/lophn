import type { SchemaStep } from "../../../protocol/server/mod.ts";

// annotation 표. 묶음은 보낸 사실이고 annotation은 그 안의 한 칸이다. 묶음 하나는 target 하나다
// (app, artifact, file). cross-owner FK(apps, releases, projects, domains)는 두지 않는다. 앱 존재와 보관은
// command가 같은 transaction에서 검사하고, artifact의 domain과 file의 project는 전달 단계가 확인한다.
// annotation_refs는 이 annotation을 가리키는 session 기록(session_message)이다.
// 하나도 없어진 annotation은 sweep이 지운다.
export const annotationSchemaSteps: readonly SchemaStep[] = [{
  id: "apps.annotations.tables",
  sql: `
    CREATE TABLE annotation_batches (
      id TEXT PRIMARY KEY NOT NULL,
      target_kind TEXT NOT NULL CHECK (target_kind IN ('app', 'artifact', 'file')),
      app TEXT,
      project TEXT,
      domain TEXT,
      artifact TEXT,
      sent_at TEXT NOT NULL,
      sent_by TEXT NOT NULL,
      CHECK (
        (target_kind = 'app' AND app IS NOT NULL AND project IS NULL AND domain IS NULL AND artifact IS NULL) OR
        (target_kind = 'artifact' AND app IS NULL AND project IS NULL AND domain IS NOT NULL AND artifact IS NOT NULL) OR
        (target_kind = 'file' AND app IS NULL AND project IS NOT NULL AND domain IS NULL AND artifact IS NULL)
      )
    ) STRICT;
    CREATE INDEX annotation_batches_app ON annotation_batches(app, id);
    CREATE INDEX annotation_batches_project ON annotation_batches(project, id);
    CREATE INDEX annotation_batches_domain ON annotation_batches(domain, id);

    CREATE TABLE annotations (
      id TEXT PRIMARY KEY NOT NULL,
      batch TEXT NOT NULL REFERENCES annotation_batches(id),
      n INTEGER NOT NULL CHECK (n >= 1),
      kind TEXT NOT NULL CHECK (kind IN ('element', 'region')),
      note TEXT NOT NULL,
      screenshot_hash TEXT,
      screenshot_size INTEGER,
      component TEXT,
      element TEXT NOT NULL CHECK (json_valid(element)),
      rect TEXT NOT NULL CHECK (json_valid(rect)),
      view TEXT NOT NULL CHECK (json_valid(view)),
      release TEXT,
      UNIQUE (batch, n),
      CHECK ((screenshot_hash IS NULL) = (screenshot_size IS NULL))
    ) STRICT;

    CREATE TABLE annotation_refs (
      annotation TEXT NOT NULL REFERENCES annotations(id),
      owner_kind TEXT NOT NULL CHECK (owner_kind IN ('session_message')),
      owner_id TEXT NOT NULL,
      PRIMARY KEY (annotation, owner_kind, owner_id)
    ) STRICT;
    CREATE INDEX annotation_refs_owner ON annotation_refs(owner_kind, owner_id);
  `,
}];
