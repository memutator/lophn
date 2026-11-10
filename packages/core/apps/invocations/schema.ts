import type { SchemaStep } from "../../../protocol/server/mod.ts";

// invocation 기록 표. app·release는 물리 FK를 두지 않는다(참조하는 releases 표는 다른 조립이다).
// JSON 값(operation·caller·summary)은 TEXT에 둔다. session·turn은 caller에서 뽑은 찾기용 칸이다.
// 종료한 행은 되돌림 표시(reverted_by)와 changeset 지우기(activation)만 바꿀 수 있다. 지우지는 못한다.
export const invocationsSchemaSteps: readonly SchemaStep[] = [
  {
    id: "apps.invocations.tables",
    sql: `
    CREATE TABLE invocations (
      id TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL,
      release TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('live', 'preview')),
      operation TEXT NOT NULL CHECK (json_valid(operation)),
      caller TEXT CHECK (caller IS NULL OR json_valid(caller)),
      caller_kind TEXT CHECK (caller_kind IN ('person', 'agent', 'app', 'program', 'flow')),
      session TEXT,
      turn TEXT,
      effect TEXT NOT NULL CHECK (effect IN ('read', 'write', 'external')),
      status TEXT NOT NULL CHECK (
        status IN ('running', 'succeeded', 'failed', 'denied', 'unknown')
      ),
      started_at TEXT,
      finished_at TEXT,
      input_hash TEXT,
      summary TEXT NOT NULL CHECK (length(summary) <= 16384),
      detail_hash TEXT,
      changeset_hash TEXT,
      changeset_size INTEGER,
      reverted_by TEXT,
      CHECK ((caller IS NULL) = (caller_kind IS NULL)),
      CHECK ((session IS NULL) = (turn IS NULL)),
      CHECK ((caller_kind IS 'agent') = (session IS NOT NULL)),
      CHECK ((finished_at IS NOT NULL) = (status <> 'running')),
      CHECK (started_at IS NULL OR finished_at IS NULL OR started_at <= finished_at),
      CHECK ((changeset_hash IS NULL) = (changeset_size IS NULL)),
      CHECK (changeset_hash IS NULL OR effect <> 'read'),
      CHECK (reverted_by IS NULL OR status IN ('succeeded', 'failed', 'unknown')),
      CHECK (input_hash IS NULL OR (length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-f]*')),
      CHECK (detail_hash IS NULL OR (length(detail_hash) = 64 AND detail_hash NOT GLOB '*[^0-9a-f]*')),
      CHECK (changeset_hash IS NULL OR (length(changeset_hash) = 64 AND changeset_hash NOT GLOB '*[^0-9a-f]*'))
    ) STRICT;
    CREATE INDEX invocations_app_release_mode_id ON invocations (app, release, mode, id);
    CREATE INDEX invocations_app_id ON invocations (app, id);
    CREATE INDEX invocations_session_turn_id ON invocations (session, turn, id);
    CREATE INDEX invocations_status_id ON invocations (status, id);
    CREATE TRIGGER invocations_terminal_no_update BEFORE UPDATE ON invocations
    WHEN OLD.status <> 'running' AND (
      NEW.id IS NOT OLD.id
      OR NEW.app IS NOT OLD.app
      OR NEW.release IS NOT OLD.release
      OR NEW.mode IS NOT OLD.mode
      OR NEW.operation IS NOT OLD.operation
      OR NEW.caller IS NOT OLD.caller
      OR NEW.caller_kind IS NOT OLD.caller_kind
      OR NEW.session IS NOT OLD.session
      OR NEW.turn IS NOT OLD.turn
      OR NEW.effect IS NOT OLD.effect
      OR NEW.status IS NOT OLD.status
      OR NEW.started_at IS NOT OLD.started_at
      OR NEW.finished_at IS NOT OLD.finished_at
      OR NEW.input_hash IS NOT OLD.input_hash
      OR NEW.summary IS NOT OLD.summary
      OR NEW.detail_hash IS NOT OLD.detail_hash
      OR (NEW.changeset_hash IS NOT NULL AND NEW.changeset_hash IS NOT OLD.changeset_hash)
      OR (NEW.changeset_size IS NOT NULL AND NEW.changeset_size IS NOT OLD.changeset_size)
      OR (OLD.reverted_by IS NOT NULL AND NEW.reverted_by IS NOT OLD.reverted_by)
    )
    BEGIN SELECT RAISE(ABORT, 'terminal invocation is immutable'); END;
    CREATE TRIGGER invocations_no_delete BEFORE DELETE ON invocations
    BEGIN SELECT RAISE(ABORT, 'invocations are recorded, not deleted'); END;
  `,
  },
  // 호출 대상이 operation과 command로 갈렸다. 옛 `{kind:"tool", tool}` 행은 모두 command다.
  {
    id: "apps.invocations.operation-kinds",
    sql: `
    DROP TRIGGER invocations_terminal_no_update;
    UPDATE invocations
       SET operation = json_object(
         'kind', 'command',
         'name', json_extract(operation, '$.tool')
       )
     WHERE json_extract(operation, '$.kind') = 'tool';
    CREATE TRIGGER invocations_terminal_no_update BEFORE UPDATE ON invocations
    WHEN OLD.status <> 'running' AND (
      NEW.id IS NOT OLD.id
      OR NEW.app IS NOT OLD.app
      OR NEW.release IS NOT OLD.release
      OR NEW.mode IS NOT OLD.mode
      OR NEW.operation IS NOT OLD.operation
      OR NEW.caller IS NOT OLD.caller
      OR NEW.caller_kind IS NOT OLD.caller_kind
      OR NEW.session IS NOT OLD.session
      OR NEW.turn IS NOT OLD.turn
      OR NEW.effect IS NOT OLD.effect
      OR NEW.status IS NOT OLD.status
      OR NEW.started_at IS NOT OLD.started_at
      OR NEW.finished_at IS NOT OLD.finished_at
      OR NEW.input_hash IS NOT OLD.input_hash
      OR NEW.summary IS NOT OLD.summary
      OR NEW.detail_hash IS NOT OLD.detail_hash
      OR (NEW.changeset_hash IS NOT NULL AND NEW.changeset_hash IS NOT OLD.changeset_hash)
      OR (NEW.changeset_size IS NOT NULL AND NEW.changeset_size IS NOT OLD.changeset_size)
      OR (OLD.reverted_by IS NOT NULL AND NEW.reverted_by IS NOT OLD.reverted_by)
    )
    BEGIN SELECT RAISE(ABORT, 'terminal invocation is immutable'); END;
  `,
  },
];

// SQLite는 CHECK를 고치지 못해 caller 종류에 `event`를 더하려면 표를 다시 짠다. 낸 step의 SQL은 고치지 않고 새 step으로 더한다.
// 새 표에 옛 행을 그대로 옮기고(열 순서가 같다), 표와 함께 사라지는 index 넷과 trigger 둘을 다시 만든다.
// trigger는 지금 모양이다: terminal 잠금은 `apps.invocations.operation-kinds`의 것이고, 지우기 막기는 앱을 영구히 지울 때 열리는
// erase window 조건부(`apps.delete.erase-windows`)다. 낸 때 step 목록의 끝에 붙어야 해서(schema-steps.lock.json) 위 목록이 아니라
// WIRINGS 맨 뒤 wiring(domains-retire)의 schemaStepsAfterTeams에서 잇는다.
export const invocationEventCallerSchemaSteps: readonly SchemaStep[] = [
  {
    id: "apps.invocations.event-caller",
    sql: `
    DROP TRIGGER invocations_terminal_no_update;
    DROP TRIGGER invocations_no_delete;
    DROP INDEX invocations_app_release_mode_id;
    DROP INDEX invocations_app_id;
    DROP INDEX invocations_session_turn_id;
    DROP INDEX invocations_status_id;
    ALTER TABLE invocations RENAME TO invocations_old;
    CREATE TABLE invocations (
      id TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL,
      release TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('live', 'preview')),
      operation TEXT NOT NULL CHECK (json_valid(operation)),
      caller TEXT CHECK (caller IS NULL OR json_valid(caller)),
      caller_kind TEXT CHECK (caller_kind IN ('person', 'agent', 'app', 'program', 'flow', 'event')),
      session TEXT,
      turn TEXT,
      effect TEXT NOT NULL CHECK (effect IN ('read', 'write', 'external')),
      status TEXT NOT NULL CHECK (
        status IN ('running', 'succeeded', 'failed', 'denied', 'unknown')
      ),
      started_at TEXT,
      finished_at TEXT,
      input_hash TEXT,
      summary TEXT NOT NULL CHECK (length(summary) <= 16384),
      detail_hash TEXT,
      changeset_hash TEXT,
      changeset_size INTEGER,
      reverted_by TEXT,
      CHECK ((caller IS NULL) = (caller_kind IS NULL)),
      CHECK ((session IS NULL) = (turn IS NULL)),
      CHECK ((caller_kind IS 'agent') = (session IS NOT NULL)),
      CHECK ((finished_at IS NOT NULL) = (status <> 'running')),
      CHECK (started_at IS NULL OR finished_at IS NULL OR started_at <= finished_at),
      CHECK ((changeset_hash IS NULL) = (changeset_size IS NULL)),
      CHECK (changeset_hash IS NULL OR effect <> 'read'),
      CHECK (reverted_by IS NULL OR status IN ('succeeded', 'failed', 'unknown')),
      CHECK (input_hash IS NULL OR (length(input_hash) = 64 AND input_hash NOT GLOB '*[^0-9a-f]*')),
      CHECK (detail_hash IS NULL OR (length(detail_hash) = 64 AND detail_hash NOT GLOB '*[^0-9a-f]*')),
      CHECK (changeset_hash IS NULL OR (length(changeset_hash) = 64 AND changeset_hash NOT GLOB '*[^0-9a-f]*'))
    ) STRICT;
    INSERT INTO invocations (
      id, app, release, mode, operation, caller, caller_kind, session, turn, effect, status,
      started_at, finished_at, input_hash, summary, detail_hash, changeset_hash, changeset_size, reverted_by
    )
    SELECT
      id, app, release, mode, operation, caller, caller_kind, session, turn, effect, status,
      started_at, finished_at, input_hash, summary, detail_hash, changeset_hash, changeset_size, reverted_by
    FROM invocations_old;
    DROP TABLE invocations_old;
    CREATE INDEX invocations_app_release_mode_id ON invocations (app, release, mode, id);
    CREATE INDEX invocations_app_id ON invocations (app, id);
    CREATE INDEX invocations_session_turn_id ON invocations (session, turn, id);
    CREATE INDEX invocations_status_id ON invocations (status, id);
    CREATE TRIGGER invocations_terminal_no_update BEFORE UPDATE ON invocations
    WHEN OLD.status <> 'running' AND (
      NEW.id IS NOT OLD.id
      OR NEW.app IS NOT OLD.app
      OR NEW.release IS NOT OLD.release
      OR NEW.mode IS NOT OLD.mode
      OR NEW.operation IS NOT OLD.operation
      OR NEW.caller IS NOT OLD.caller
      OR NEW.caller_kind IS NOT OLD.caller_kind
      OR NEW.session IS NOT OLD.session
      OR NEW.turn IS NOT OLD.turn
      OR NEW.effect IS NOT OLD.effect
      OR NEW.status IS NOT OLD.status
      OR NEW.started_at IS NOT OLD.started_at
      OR NEW.finished_at IS NOT OLD.finished_at
      OR NEW.input_hash IS NOT OLD.input_hash
      OR NEW.summary IS NOT OLD.summary
      OR NEW.detail_hash IS NOT OLD.detail_hash
      OR (NEW.changeset_hash IS NOT NULL AND NEW.changeset_hash IS NOT OLD.changeset_hash)
      OR (NEW.changeset_size IS NOT NULL AND NEW.changeset_size IS NOT OLD.changeset_size)
      OR (OLD.reverted_by IS NOT NULL AND NEW.reverted_by IS NOT OLD.reverted_by)
    )
    BEGIN SELECT RAISE(ABORT, 'terminal invocation is immutable'); END;
    CREATE TRIGGER invocations_no_delete BEFORE DELETE ON invocations
    WHEN NOT EXISTS (SELECT 1 FROM erase_windows WHERE table_name = 'invocations')
    BEGIN SELECT RAISE(ABORT, 'invocations are recorded, not deleted'); END;
  `,
  },
];
