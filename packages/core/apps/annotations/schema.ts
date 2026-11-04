import type { SchemaStep } from "../../../protocol/server/mod.ts";

// annotation 표. 묶음은 보낸 사실이고 annotation은 그 안의 한 칸이다. 묶음 하나는 target 하나다
// (app, artifact, file). cross-owner FK(apps, releases, projects)는 두지 않는다. 앱 존재와 보관은
// command가 같은 transaction에서 검사하고, artifact와 file의 project·앱은 전달 단계가 확인한다.
// artifact의 그릇은 app이나 project 칸 하나다(첫 step은 domain 칸이었고 두 번째 step이 그릇으로 바꿨다).
// annotation_refs는 이 annotation을 가리키는 session 기록(session_message)이다.
// 하나도 없어진 annotation은 sweep이 지운다.
export const annotationSchemaSteps: readonly SchemaStep[] = [
  {
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
  },
  // artifact의 신원이 `{domain, name}`에서 `{project | app, name}`이 됐다. CHECK를 바꾸려면 표를 다시 만들어야 하고
  // annotations·annotation_refs가 FK로 묶여 있어 자식부터 지우고 부모부터 만든다. domain 칸은 domains 표로
  // 그 domain의 그릇을 찾아 app이나 project 칸에 옮긴다(domains 표는 이 step이 도는 때 아직 있다).
  {
    id: "apps.annotations.artifact-container",
    sql: `
    CREATE TABLE annotation_refs_old AS SELECT * FROM annotation_refs;
    CREATE TABLE annotations_old AS SELECT * FROM annotations;
    CREATE TABLE annotation_batches_old AS SELECT * FROM annotation_batches;
    DROP TABLE annotation_refs;
    DROP TABLE annotations;
    DROP TABLE annotation_batches;

    CREATE TABLE annotation_batches (
      id TEXT PRIMARY KEY NOT NULL,
      target_kind TEXT NOT NULL CHECK (target_kind IN ('app', 'artifact', 'file')),
      app TEXT,
      project TEXT,
      artifact TEXT,
      sent_at TEXT NOT NULL,
      sent_by TEXT NOT NULL,
      CHECK (
        (target_kind = 'app' AND app IS NOT NULL AND project IS NULL AND artifact IS NULL) OR
        (target_kind = 'artifact' AND (app IS NULL) <> (project IS NULL) AND artifact IS NOT NULL) OR
        (target_kind = 'file' AND app IS NULL AND project IS NOT NULL AND artifact IS NULL)
      )
    ) STRICT;
    CREATE INDEX annotation_batches_app ON annotation_batches(app, id);
    CREATE INDEX annotation_batches_project ON annotation_batches(project, id);

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

    INSERT INTO annotation_batches (id, target_kind, app, project, artifact, sent_at, sent_by)
      SELECT b.id, b.target_kind,
             CASE WHEN b.target_kind = 'artifact'
                  THEN CASE WHEN d.owner_kind = 'app' THEN d.owner_id END
                  ELSE b.app END,
             CASE WHEN b.target_kind = 'artifact'
                  THEN CASE WHEN d.owner_kind = 'project' THEN d.owner_id END
                  ELSE b.project END,
             b.artifact, b.sent_at, b.sent_by
        FROM annotation_batches_old b LEFT JOIN domains d ON d.id = b.domain
       WHERE b.target_kind <> 'artifact' OR d.id IS NOT NULL;
    INSERT INTO annotations
      SELECT * FROM annotations_old WHERE batch IN (SELECT id FROM annotation_batches);
    INSERT INTO annotation_refs
      SELECT * FROM annotation_refs_old WHERE annotation IN (SELECT id FROM annotations);

    DROP TABLE annotation_refs_old;
    DROP TABLE annotations_old;
    DROP TABLE annotation_batches_old;
  `,
  },
];
