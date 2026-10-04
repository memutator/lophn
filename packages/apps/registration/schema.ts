import type { SchemaStep } from "../../contracts/platform/mod.ts";

// domain-model apps/registration의 표. slug는 documents/addressing place와
// 같은 이름 공간이라 place_names 예약이 unique를 지키고, 표에는 한 번 더 unique를 둔다.
// planning_version·active_release는 아직 없는 versions·releases 표를 참조하므로
// 물리 FK를 두지 않는다. 보관은 삭제가 아니라 status다.
export const appsSchemaSteps: readonly SchemaStep[] = [{
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
}];
