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

// 보낸 뒤 앱 process의 답을 잃은 rewind는 앱 DB가 되돌려졌는지 모른다. 취소가 아니라 `unknown`으로 끝내고 보낸 목록과
// 이유를 남긴다. SQLite는 CHECK를 고치지 못해 표를 다시 짠다(열 순서가 같다). 표와 함께 사라지는 index 둘과 trigger 둘을
// 다시 만든다. 지우기 막기는 지금 모양(`apps.delete.erase-windows`의 erase window 조건부)이다. 낸 때 step 목록의 끝에
// 붙어야 해서(schema-steps.lock.json) 위 목록이 아니라 WIRINGS 맨 뒤 wiring의 schemaStepsAfterTeams에서 잇는다.
export const rewindUnknownSchemaSteps: readonly SchemaStep[] = [
  {
    id: "apps.rewind.unknown",
    sql: `
    DROP TRIGGER app_rewinds_finished_no_update;
    DROP TRIGGER app_rewinds_no_delete;
    DROP INDEX app_rewinds_app_id;
    DROP INDEX app_rewinds_one_applying;
    ALTER TABLE app_rewinds RENAME TO app_rewinds_old;
    CREATE TABLE app_rewinds (
      id TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL,
      release TEXT NOT NULL,
      from_invocation TEXT NOT NULL,
      requested_by TEXT NOT NULL CHECK (length(requested_by) > 0),
      status TEXT NOT NULL CHECK (
        status IN ('applying', 'applied', 'cancelled', 'unknown')
      ),
      reason_code TEXT CHECK (
        reason_code IN ('conflict', 'app_unavailable', 'core_restarted')
      ),
      reason_message TEXT,
      invocations TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      CHECK ((status = 'applying') = (finished_at IS NULL)),
      CHECK ((status IN ('cancelled', 'unknown')) = (reason_code IS NOT NULL)),
      CHECK ((reason_code IS NULL) = (reason_message IS NULL))
    ) STRICT;
    INSERT INTO app_rewinds (
      id, app, release, from_invocation, requested_by, status, reason_code, reason_message,
      invocations, started_at, finished_at
    )
    SELECT
      id, app, release, from_invocation, requested_by, status, reason_code, reason_message,
      invocations, started_at, finished_at
    FROM app_rewinds_old;
    DROP TABLE app_rewinds_old;
    CREATE INDEX app_rewinds_app_id ON app_rewinds (app, id);
    CREATE UNIQUE INDEX app_rewinds_one_applying ON app_rewinds (app)
      WHERE status = 'applying';
    CREATE TRIGGER app_rewinds_finished_no_update BEFORE UPDATE ON app_rewinds
    WHEN OLD.status <> 'applying'
    BEGIN SELECT RAISE(ABORT, 'finished rewind is immutable'); END;
    CREATE TRIGGER app_rewinds_no_delete BEFORE DELETE ON app_rewinds
    WHEN NOT EXISTS (SELECT 1 FROM erase_windows WHERE table_name = 'app_rewinds')
    BEGIN SELECT RAISE(ABORT, 'rewinds are recorded, not deleted'); END;
  `,
  },
];
