import type { SchemaStep } from "../../../protocol/server/mod.ts";

// registration 표. slug는 표에서 unique다.
// planning_version·active_release는 아직 없는 versions·releases 표를 참조하므로
// 물리 FK를 두지 않는다. 보관은 삭제가 아니라 status다.
export const appsSchemaSteps: readonly SchemaStep[] = [
  {
    id: "apps.registration.tables",
    sql: `
    CREATE TABLE apps (
      id TEXT PRIMARY KEY NOT NULL,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL CHECK (length(name) > 0),
      description TEXT NOT NULL CHECK (
        length(description) > 0 AND instr(description, char(10)) = 0
        AND instr(description, char(13)) = 0
      ),
      planning_version TEXT,
      source_path TEXT,
      active_release TEXT,
      run_enabled INTEGER NOT NULL CHECK (run_enabled IN (0, 1)),
      revision TEXT NOT NULL CHECK (
        length(revision) > 0 AND substr(revision, 1, 1) BETWEEN '1' AND '9'
        AND revision NOT GLOB '*[^0-9]*'
        AND (length(revision) < 19 OR
          (length(revision) = 19 AND revision <= '9223372036854775807'))
      ),
      status TEXT NOT NULL CHECK (status IN ('active', 'archived')),
      CHECK (status != 'archived' OR run_enabled = 0)
    ) STRICT;
    CREATE INDEX apps_status_id ON apps(status, id);
    CREATE TRIGGER apps_no_identity_change BEFORE UPDATE OF id, slug ON apps
    WHEN NEW.id <> OLD.id OR NEW.slug <> OLD.slug
    BEGIN SELECT RAISE(ABORT, 'app identity is immutable'); END;
    CREATE TRIGGER apps_no_delete BEFORE DELETE ON apps
    BEGIN SELECT RAISE(ABORT, 'apps are archived, not deleted'); END;
    CREATE TRIGGER apps_no_replace BEFORE INSERT ON apps
    WHEN EXISTS (SELECT 1 FROM apps WHERE id = NEW.id OR slug = NEW.slug)
    BEGIN SELECT RAISE(ABORT, 'app identity already exists'); END;
  `,
  },
  // source 밖에 사람이 이은 폴더. project_folders와 같은 모양이다. position은 0부터 연속이다.
  {
    id: "apps.registration.folders",
    sql: `
    CREATE TABLE app_folders (
      app TEXT NOT NULL REFERENCES apps(id),
      position INTEGER NOT NULL CHECK (position >= 0),
      path TEXT NOT NULL,
      description TEXT NOT NULL,
      PRIMARY KEY (app, position),
      UNIQUE (app, path)
    ) STRICT;
  `,
  },
  // 사람이 올린 icon. 64 KiB 이하 base64 글이라 blob 저장소를 거치지 않고 그 자리에서 읽는다. 앱당 하나다.
  {
    id: "apps.registration.icons",
    sql: `
    CREATE TABLE app_icons (
      app TEXT PRIMARY KEY NOT NULL REFERENCES apps(id),
      content_type TEXT NOT NULL CHECK (
        content_type IN ('image/svg+xml', 'image/png', 'image/webp')
      ),
      data TEXT NOT NULL CHECK (length(data) > 0)
    ) STRICT;
  `,
  },
];
