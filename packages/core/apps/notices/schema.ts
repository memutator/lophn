import type { SchemaStep } from "../../../protocol/server/mod.ts";

// 앱이 사람에게 알린 열린 notice. 사람이 지울 때까지 재시작을 넘어 남는다. 같은 (app, key)는 하나다(key가 있을 때).
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
