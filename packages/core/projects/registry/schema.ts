import type { SchemaStep } from "../../../protocol/server/mod.ts";

// position은 0부터 연속이다. 행 교체는 Project 구성 변경 transaction 안에서만 한다.
export const projectsSchemaSteps: readonly SchemaStep[] = [
  {
    id: "projects.registry.tables",
    sql: `
    CREATE TABLE projects (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL CHECK (length(title) > 0),
      purpose TEXT NOT NULL,
      revision TEXT NOT NULL CHECK (
        length(revision) > 0 AND substr(revision, 1, 1) BETWEEN '1' AND '9'
        AND revision NOT GLOB '*[^0-9]*'
        AND (length(revision) < 19 OR
          (length(revision) = 19 AND revision <= '9223372036854775807'))
      ),
      status TEXT NOT NULL CHECK (status IN ('active', 'archived'))
    ) STRICT;
    CREATE INDEX projects_status_id ON projects(status, id);
    CREATE TRIGGER projects_no_identity_change BEFORE UPDATE OF id ON projects
    WHEN NEW.id <> OLD.id
    BEGIN SELECT RAISE(ABORT, 'project identity is immutable'); END;
    CREATE TRIGGER projects_no_name_collision BEFORE UPDATE OF name ON projects
    WHEN EXISTS (SELECT 1 FROM projects WHERE name = NEW.name AND id <> OLD.id)
    BEGIN SELECT RAISE(ABORT, 'project name already exists'); END;
    CREATE TRIGGER projects_no_delete BEFORE DELETE ON projects
    BEGIN SELECT RAISE(ABORT, 'projects are archived, not deleted'); END;
    CREATE TRIGGER projects_no_replace BEFORE INSERT ON projects
    WHEN EXISTS (SELECT 1 FROM projects WHERE id = NEW.id OR name = NEW.name)
    BEGIN SELECT RAISE(ABORT, 'project identity already exists'); END;

    CREATE TABLE project_folders (
      project TEXT NOT NULL REFERENCES projects(id),
      position INTEGER NOT NULL CHECK (position >= 0),
      path TEXT NOT NULL,
      description TEXT NOT NULL,
      PRIMARY KEY (project, position),
      UNIQUE (project, path)
    ) STRICT;
    CREATE INDEX project_folders_path ON project_folders(path);

    CREATE TABLE project_subfolders (
      project TEXT NOT NULL,
      folder_path TEXT NOT NULL,
      position INTEGER NOT NULL CHECK (position >= 0),
      path TEXT NOT NULL,
      description TEXT NOT NULL,
      PRIMARY KEY (project, folder_path, path),
      FOREIGN KEY (project, folder_path) REFERENCES project_folders(project, path)
    ) STRICT;
  `,
  },
  {
    id: "projects.registry.drop-subfolders",
    sql: `DROP TABLE project_subfolders;`,
  },
  // 사람이 올린 icon. 64 KiB 이하 base64 글이라 blob 저장소를 거치지 않고 그 자리에서 읽는다. project당 하나다.
  {
    id: "projects.registry.icons",
    sql: `
    CREATE TABLE project_icons (
      project TEXT PRIMARY KEY NOT NULL REFERENCES projects(id),
      content_type TEXT NOT NULL CHECK (
        content_type IN ('image/svg+xml', 'image/png', 'image/webp')
      ),
      data TEXT NOT NULL CHECK (length(data) > 0)
    ) STRICT;
  `,
  },
];

// 기계를 넘는 id(identity)와 폴더의 git 여부, 대표 remote. id는 등록할 때 ledger에서 난다.
// 기존 project는 null로 이어지고 data step이 id를 준다. 한 기계에서 한 id는 project 하나만 갖는다.
// 낸 step 목록의 끝에 붙어야 해서(schema-steps.lock.json) WIRINGS 맨 뒤 wiring(remote)의 schemaStepsAfterTeams에서 잇는다.
export const PROJECTS_IDENTITY_STEPS: readonly SchemaStep[] = [
  {
    id: "projects.registry.identity",
    sql: `
    ALTER TABLE projects ADD COLUMN identity TEXT;
    ALTER TABLE projects ADD COLUMN repo TEXT CHECK (repo IS NULL OR repo IN ('git', 'none'));
    ALTER TABLE projects ADD COLUMN remote_key TEXT;
    ALTER TABLE projects ADD COLUMN remote_url TEXT;
    CREATE UNIQUE INDEX projects_identity ON projects(identity) WHERE identity IS NOT NULL;
  `,
  },
];

// project가 전에 가졌던 identity의 JSON 배열(오래된 것이 앞, 최대 16개). 기존 줄은 옛 기록이 없어 빈 목록에서 시작한다.
// 남기는 곳은 storeIdentity 하나다. PROJECTS_IDENTITY_STEPS처럼 remote wiring의 schemaStepsAfterTeams 끝에서 잇는다.
export const PROJECTS_FORMER_IDENTITY_STEPS: readonly SchemaStep[] = [
  {
    id: "projects.registry.former-identities",
    sql: `ALTER TABLE projects ADD COLUMN former_identities TEXT NOT NULL DEFAULT '[]';`,
  },
];
