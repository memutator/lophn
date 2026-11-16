import type { SchemaStep } from "../../../protocol/server/mod.ts";

// 앱 grant 표. scope는 정규 JSON 문자열이다. activation이 한 번에 만들고 사람이 거둔다.
// 같은 (app, kind, scope)의 active grant는 하나다(partial unique). 내용 열은 불변이고 active에서
// revoked로 한 번만 간다.
export const permissionsSchemaSteps: readonly SchemaStep[] = [
  {
    id: "apps.permissions.tables",
    sql: `
    CREATE TABLE grants (
      id TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL REFERENCES apps(id),
      kind TEXT NOT NULL CHECK (kind IN (
        'fs.read', 'fs.write', 'net.fetch', 'net.listen', 'secret.use', 'app.call'
      )),
      scope TEXT NOT NULL CHECK (length(scope) > 0),
      status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
      created_at TEXT NOT NULL CHECK (length(created_at) > 0),
      revoked_at TEXT,
      CHECK (
        (status = 'active' AND revoked_at IS NULL) OR
        (status = 'revoked' AND revoked_at IS NOT NULL)
      )
    ) STRICT;
    CREATE UNIQUE INDEX grants_active_scope ON grants(app, kind, scope)
      WHERE status = 'active';
    CREATE INDEX grants_app_status_kind ON grants(app, status, kind);
    CREATE TRIGGER grants_immutable BEFORE UPDATE ON grants
    WHEN NEW.id <> OLD.id OR NEW.app <> OLD.app OR NEW.kind <> OLD.kind
      OR NEW.scope <> OLD.scope OR NEW.created_at <> OLD.created_at
      OR OLD.status <> 'active' OR NEW.status <> 'revoked'
    BEGIN SELECT RAISE(ABORT, 'grant content is immutable; revoked is final'); END;
    CREATE TRIGGER grants_no_delete BEFORE DELETE ON grants
    BEGIN SELECT RAISE(ABORT, 'grants are revoked, not deleted'); END;
  `,
  },
  // notify.send를 kind에 더한다. CHECK는 바꿀 수 없어 표를 다시 만든다. 이 표를 가리키는 FK는 없다.
  {
    id: "apps.permissions.notify_kind",
    sql: `
    CREATE TABLE grants_next (
      id TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL REFERENCES apps(id),
      kind TEXT NOT NULL CHECK (kind IN (
        'fs.read', 'fs.write', 'net.fetch', 'net.listen', 'secret.use', 'notify.send', 'app.call'
      )),
      scope TEXT NOT NULL CHECK (length(scope) > 0),
      status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
      created_at TEXT NOT NULL CHECK (length(created_at) > 0),
      revoked_at TEXT,
      CHECK (
        (status = 'active' AND revoked_at IS NULL) OR
        (status = 'revoked' AND revoked_at IS NOT NULL)
      )
    ) STRICT;
    INSERT INTO grants_next SELECT id, app, kind, scope, status, created_at, revoked_at FROM grants;
    DROP TABLE grants;
    ALTER TABLE grants_next RENAME TO grants;
    CREATE UNIQUE INDEX grants_active_scope ON grants(app, kind, scope)
      WHERE status = 'active';
    CREATE INDEX grants_app_status_kind ON grants(app, status, kind);
    CREATE TRIGGER grants_immutable BEFORE UPDATE ON grants
    WHEN NEW.id <> OLD.id OR NEW.app <> OLD.app OR NEW.kind <> OLD.kind
      OR NEW.scope <> OLD.scope OR NEW.created_at <> OLD.created_at
      OR OLD.status <> 'active' OR NEW.status <> 'revoked'
    BEGIN SELECT RAISE(ABORT, 'grant content is immutable; revoked is final'); END;
    CREATE TRIGGER grants_no_delete BEFORE DELETE ON grants
    BEGIN SELECT RAISE(ABORT, 'grants are revoked, not deleted'); END;
  `,
  },
];

// phone.use를 kind에 더한다(notify_kind와 같은 다시 만들기). 낸 step 목록의 끝에 붙어야 해서 permissionsSchemaSteps가 아니라
// WIRINGS 맨 뒤 wiring의 schemaStepsAfterTeams에 둔다.
export const PERMISSIONS_PHONE_KIND_STEPS: readonly SchemaStep[] = [
  {
    id: "apps.permissions.phone_kind",
    sql: `
    CREATE TABLE grants_next (
      id TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL REFERENCES apps(id),
      kind TEXT NOT NULL CHECK (kind IN (
        'fs.read', 'fs.write', 'net.fetch', 'net.listen', 'secret.use', 'notify.send', 'phone.use', 'app.call'
      )),
      scope TEXT NOT NULL CHECK (length(scope) > 0),
      status TEXT NOT NULL CHECK (status IN ('active', 'revoked')),
      created_at TEXT NOT NULL CHECK (length(created_at) > 0),
      revoked_at TEXT,
      CHECK (
        (status = 'active' AND revoked_at IS NULL) OR
        (status = 'revoked' AND revoked_at IS NOT NULL)
      )
    ) STRICT;
    INSERT INTO grants_next SELECT id, app, kind, scope, status, created_at, revoked_at FROM grants;
    DROP TABLE grants;
    ALTER TABLE grants_next RENAME TO grants;
    CREATE UNIQUE INDEX grants_active_scope ON grants(app, kind, scope)
      WHERE status = 'active';
    CREATE INDEX grants_app_status_kind ON grants(app, status, kind);
    CREATE TRIGGER grants_immutable BEFORE UPDATE ON grants
    WHEN NEW.id <> OLD.id OR NEW.app <> OLD.app OR NEW.kind <> OLD.kind
      OR NEW.scope <> OLD.scope OR NEW.created_at <> OLD.created_at
      OR OLD.status <> 'active' OR NEW.status <> 'revoked'
    BEGIN SELECT RAISE(ABORT, 'grant content is immutable; revoked is final'); END;
    CREATE TRIGGER grants_no_delete BEFORE DELETE ON grants
    BEGIN SELECT RAISE(ABORT, 'grants are revoked, not deleted'); END;
  `,
  },
];
