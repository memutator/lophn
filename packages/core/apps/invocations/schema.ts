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
