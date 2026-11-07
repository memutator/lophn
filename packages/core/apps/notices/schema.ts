import type { SchemaStep } from "../../../protocol/server/mod.ts";

// 옛 앱 알림 표(이미 낸 step이라 고치지 않는다. 아래 `apps.notices.unified`가 합친다). 앱이 사람에게 알린 열린 notice. 사람이 지울 때까지 재시작을 넘어 남는다. 같은 (app, key)는 하나다(key가 있을 때).
// 앱은 보관(archive)만 되고 지워지지 않으므로 FK는 두지 않는다. 보관하면 command가 줄을 지운다.
export const noticeSchemaSteps: readonly SchemaStep[] = [
  {
    id: "apps.notices.tables",
    sql: `
    CREATE TABLE app_notices (
      id TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL,
      key TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE UNIQUE INDEX app_notices_app_key ON app_notices(app, key) WHERE key IS NOT NULL;
    CREATE INDEX app_notices_app_created ON app_notices(app, created_at, id);
  `,
  },
];

// 앱 알림 표를 사람에게 알리는 모든 것(앱 알림 + program 기록)의 표 하나로 합친다. 기존 줄은 앱이 쓴 휘발 알림 그대로 옮긴다.
// program 줄은 지우지 못하게 trigger로 막는다(기록이다). 앱 줄만 상한·보관 때 command가 지운다.
// 같은 (source, app, key)는 하나다(key가 있을 때). app이 null인 program 줄(lophn 전체)은 coalesce로 묶는다.
// kind의 목록은 protocol zod가 정한다. 종류를 더할 때 표를 다시 짜지 않으려고 CHECK를 걸지 않았다.
export const noticeUnifiedSchemaSteps: readonly SchemaStep[] = [
  {
    id: "apps.notices.unified",
    sql: `
    CREATE TABLE notices (
      id TEXT PRIMARY KEY NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('app', 'program')),
      app TEXT,
      project TEXT,
      kind TEXT NOT NULL,
      key TEXT,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      persistent INTEGER NOT NULL CHECK (persistent IN (0, 1)),
      action TEXT,
      created_at TEXT NOT NULL,
      read_at TEXT,
      CHECK (source = 'program' OR (app IS NOT NULL AND kind = 'app')),
      CHECK (source = 'app' OR (kind <> 'app' AND persistent = 1))
    ) STRICT;
    CREATE UNIQUE INDEX notices_source_app_key ON notices(source, coalesce(app, ''), key) WHERE key IS NOT NULL;
    CREATE INDEX notices_app_persistent_created ON notices(app, persistent, created_at, id);
    CREATE INDEX notices_created ON notices(created_at, id);
    CREATE TRIGGER notices_program_no_delete BEFORE DELETE ON notices
    WHEN OLD.source = 'program'
    BEGIN SELECT RAISE(ABORT, 'program notices are records and are not deleted'); END;
    INSERT INTO notices (id, source, app, project, kind, key, title, body, persistent, action, created_at, read_at)
    SELECT id, 'app', app, NULL, 'app', key, title, body, 0, NULL, created_at, NULL FROM app_notices;
    DROP TABLE app_notices;
  `,
  },
];
