import { JOB_RUN_STATES, MISSED_POLICIES } from "../../protocol/jobs/mod.ts";
import type { SchemaStep } from "../../protocol/server/mod.ts";

const list = (values: readonly string[]) =>
  values.map((value) => `'${value}'`).join(", ");

// job 한 행과 차례마다 남는 job run 한 행. FK는 두지 않는다(다른 module의 id는 id만 적고,
// job 지우기는 command가 두 표를 같이 지운다).
// - creator_workspace는 home이면 NULL, 아니면 `prj_…`·`app_…` id다.
// - job_runs.claimed_at은 scheduler에 넘긴 때다. record에 없는 안쪽 칸이다.
// - unique index 둘은 겹침 규칙을 코드가 틀려도 표가 한 겹 더 막는다: 도는 줄(queued, running)과 기다리는 줄(held)은 job마다 하나다.
export const jobsSchemaSteps: readonly SchemaStep[] = [
  {
    id: "jobs.tables",
    sql: `
    CREATE TABLE jobs (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      creator_agent TEXT NOT NULL,
      creator_place TEXT,
      every TEXT NOT NULL,
      at TEXT,
      action TEXT NOT NULL CHECK (json_valid(action)),
      missed_policy TEXT NOT NULL CHECK (missed_policy IN (${list(
        MISSED_POLICIES,
      )})),
      enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
      next_due_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE job_runs (
      id TEXT PRIMARY KEY NOT NULL,
      job TEXT NOT NULL,
      due_at TEXT NOT NULL,
      missed_count INTEGER NOT NULL,
      state TEXT NOT NULL CHECK (state IN (${list(JOB_RUN_STATES)})),
      reason TEXT,
      run TEXT,
      instance TEXT,
      session TEXT,
      claimed_at TEXT,
      started_at TEXT,
      ended_at TEXT,
      created_at TEXT NOT NULL
    ) STRICT;
    CREATE INDEX job_runs_job ON job_runs(job, id);
    CREATE UNIQUE INDEX job_runs_open ON job_runs(job)
      WHERE state IN ('queued', 'running');
    CREATE UNIQUE INDEX job_runs_held ON job_runs(job) WHERE state = 'held';
  `,
  },
  // job 등록은 사람이 한 번 승인해야 돈다. 승인 칸이 없던 job은 승인 대기로 옮기고 다음 차례를 지운다.
  {
    id: "jobs.approval",
    sql: `
    ALTER TABLE jobs ADD COLUMN approved_at TEXT;
    UPDATE jobs SET next_due_at = NULL;
  `,
  },
  // place를 workspace로 부르게 됐다. agent_run action의 `agent_place`도 `agent_workspace`로 옮긴다.
  {
    id: "jobs.workspace",
    sql: `
    ALTER TABLE jobs RENAME COLUMN creator_place TO creator_workspace;
    UPDATE jobs SET action = json_set(
      json_remove(action, '$.agent_place'),
      '$.agent_workspace',
      json(action -> '$.agent_place')
    ) WHERE json_type(action, '$.agent_place') IS NOT NULL;
  `,
  },
];
