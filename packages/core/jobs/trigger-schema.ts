import type { SchemaStep } from "../../protocol/server/mod.ts";

// job의 때에 event가 더해진다(앱 event나 core의 session event로 도는 job). 낸 step의 SQL은 고치지 않고 새 step으로 더한다.
// `every`가 NOT NULL이던 것을 event job은 비워야 해서 jobs 표를 다시 짠다(job 표는 FK 자식이 없고 지금 모양의 index·trigger가 pk뿐이라 옮기기만 한다).
// - trigger: `{source, app, event, min_interval, pass_event}` JSON. every와 trigger는 정확히 하나다.
// - fired_count·skipped_count·last_*: event job의 기록. 건너뜀은 job run 줄로 쌓지 않고 센다(event는 흔하다).
// - job_runs.event: 차례를 연 event(`{source, event, payload}`)다. 시작하는 action이 data로 읽는다.
// 낸 때 step 목록의 끝에 붙어야 해서(schema-steps.lock.json) WIRINGS 맨 뒤 wiring(domains-retire)의 schemaStepsAfterTeams에서 잇는다.
export const jobTriggerSchemaSteps: readonly SchemaStep[] = [
  {
    id: "jobs.trigger",
    sql: `
    CREATE TABLE jobs_new (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      creator_agent TEXT NOT NULL,
      creator_workspace TEXT,
      every TEXT,
      at TEXT,
      action TEXT NOT NULL CHECK (json_valid(action)),
      missed_policy TEXT NOT NULL CHECK (missed_policy IN ('run', 'hold')),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      next_due_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      approved_at TEXT,
      trigger TEXT CHECK (trigger IS NULL OR json_valid(trigger)),
      fired_count INTEGER NOT NULL DEFAULT 0 CHECK (fired_count >= 0),
      skipped_count INTEGER NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
      last_fired_at TEXT,
      last_skipped_at TEXT,
      last_skip_reason TEXT CHECK (last_skip_reason IS NULL OR last_skip_reason IN ('busy', 'too_soon')),
      CHECK ((every IS NULL) <> (trigger IS NULL)),
      CHECK (trigger IS NULL OR (at IS NULL AND next_due_at IS NULL))
    ) STRICT;
    INSERT INTO jobs_new (id, title, creator_agent, creator_workspace, every, at, action, missed_policy,
      enabled, next_due_at, created_at, updated_at, approved_at)
    SELECT id, title, creator_agent, creator_workspace, every, at, action, missed_policy,
      enabled, next_due_at, created_at, updated_at, approved_at FROM jobs;
    DROP TABLE jobs;
    ALTER TABLE jobs_new RENAME TO jobs;
    ALTER TABLE job_runs ADD COLUMN event TEXT CHECK (event IS NULL OR json_valid(event));
  `,
  },
];
