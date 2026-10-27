import type { SchemaStep } from "../../../protocol/server/mod.ts";

// 앱 data rewind 기록. 끝난 행은 바꾸지 못하고 지우지 않는다. 앱마다 applying은 하나뿐이다.
// invocations는 되돌린 invocation id의 JSON 배열이다.
export const rewindSchemaSteps: readonly SchemaStep[] = [
  {
    id: "apps.rewind.tables",
    sql: `
    CREATE TABLE app_rewinds (
      id TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL,
      release TEXT NOT NULL,
      from_invocation TEXT NOT NULL,
      requested_by TEXT NOT NULL CHECK (length(requested_by) > 0),
      status TEXT NOT NULL CHECK (status IN ('applying', 'applied', 'cancelled')),
      reason_code TEXT CHECK (
        reason_code IN ('conflict', 'app_unavailable', 'core_restarted')
      ),
      reason_message TEXT,
      invocations TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      CHECK ((status = 'applying') = (finished_at IS NULL)),
      CHECK ((status = 'cancelled') = (reason_code IS NOT NULL)),
      CHECK ((reason_code IS NULL) = (reason_message IS NULL))
    ) STRICT;
    CREATE INDEX app_rewinds_app_id ON app_rewinds (app, id);
    CREATE UNIQUE INDEX app_rewinds_one_applying ON app_rewinds (app)
      WHERE status = 'applying';
    CREATE TRIGGER app_rewinds_finished_no_update BEFORE UPDATE ON app_rewinds
    WHEN OLD.status <> 'applying'
    BEGIN SELECT RAISE(ABORT, 'finished rewind is immutable'); END;
    CREATE TRIGGER app_rewinds_no_delete BEFORE DELETE ON app_rewinds
    BEGIN SELECT RAISE(ABORT, 'rewinds are recorded, not deleted'); END;
  `,
  },
];
