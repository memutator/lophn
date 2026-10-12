import type { SchemaStep } from "../../../protocol/platform/mod.ts";

// domain-model apps/invocations의 표. app·release는 아직 물리 FK를 두지 않는다
// (releases 표의 위치가 다른 조립이며 참조 삭제 거절은 그쪽 몫이다).
// approval은 confirm 접수에 필수이고 unique WHERE NOT NULL이다.
// JSON 값(operation·trigger·caller)은 TEXT에 저장한다.
export const invocationsSchemaSteps: readonly SchemaStep[] = [{
  id: "apps.invocations.tables",
  sql: `
    CREATE TABLE invocations (
      id TEXT PRIMARY KEY NOT NULL,
      app TEXT NOT NULL,
      release TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('live', 'preview', 'test')),
      actor TEXT NOT NULL CHECK (length(actor) > 0),
      caller TEXT NOT NULL CHECK (length(caller) > 0),
      operation TEXT NOT NULL CHECK (length(operation) > 0),
      trigger TEXT NOT NULL CHECK (length(trigger) > 0),
      approval TEXT,
      input_hash TEXT,
      status TEXT NOT NULL CHECK (
        status IN ('accepted', 'running', 'succeeded', 'failed', 'denied', 'unknown')
      ),
      started_at TEXT,
      finished_at TEXT,
      summary TEXT NOT NULL,
      detail_hash TEXT,
      CHECK (approval IS NULL OR length(approval) > 0),
      CHECK (input_hash IS NULL OR (length(input_hash) = 64 AND input_hash GLOB '*[0-9a-f]*' AND input_hash NOT GLOB '*[^0-9a-f]*')),
      CHECK (
        (status != 'accepted' AND status != 'denied') OR started_at IS NULL
      ),
      CHECK (
        (status = 'accepted' OR status = 'running') OR finished_at IS NOT NULL
      ),
      CHECK (
        started_at IS NULL OR finished_at IS NULL OR started_at <= finished_at
      ),
      CHECK (length(summary) <= 16384)
    ) STRICT;
    CREATE UNIQUE INDEX invocations_approval ON invocations (approval)
      WHERE approval IS NOT NULL;
    CREATE INDEX invocations_app_release_mode_id ON invocations (app, release, mode, id);
    CREATE INDEX invocations_app_started_at_id ON invocations (app, started_at, id);
    CREATE INDEX invocations_status_id ON invocations (status, id);
    CREATE TRIGGER invocations_terminal_no_update BEFORE UPDATE ON invocations
    WHEN OLD.status IN ('succeeded', 'failed', 'denied', 'unknown')
      AND (
        NEW.status <> OLD.status OR NEW.finished_at <> OLD.finished_at
        OR NEW.summary <> OLD.summary OR NEW.detail_hash <> OLD.detail_hash
      )
    BEGIN SELECT RAISE(ABORT, 'terminal invocation is immutable'); END;
    CREATE TRIGGER invocations_no_delete BEFORE DELETE ON invocations
    BEGIN SELECT RAISE(ABORT, 'invocations are recorded, not deleted'); END;
  `,
}];
