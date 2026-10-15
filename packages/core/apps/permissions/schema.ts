import type { SchemaStep } from "../../../protocol/server/mod.ts";

// 앱 grant 표. scope는 정규 JSON 문자열이다. activation이 한 번에 만들고 사람이 거둔다.
// 같은 (app, kind, scope)의 active grant는 하나다(partial unique). 내용 열은 불변이고 active에서
// revoked로 한 번만 간다.
export const permissionsSchemaSteps: readonly SchemaStep[] = [{
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
}];
