import { ok, type Result } from "../../base/mod.ts";
import type { AgentRef } from "../../protocol/lophn-agent/mod.ts";
import type {
  JobAction,
  JobRecord,
  JobRunRecord,
  JobRunState,
  MissedPolicy,
} from "../../protocol/jobs/mod.ts";
import type { Sql } from "../../protocol/server/mod.ts";
import { creatorColumns, jobFromRow, jobRunFromRow } from "./rows.ts";

type Query = Pick<Sql, "get" | "all">;
type Write = Pick<Sql, "get" | "run">;

// id 정렬이 곧 시간 순이다. job 줄은 가장 큰 job run id를 last_run으로 싣는다.
function withLastRun(
  sql: Query,
  row: Record<string, unknown>,
): Result<JobRecord> {
  const last = sql.get(
    "SELECT * FROM job_runs WHERE job = ? ORDER BY id DESC LIMIT 1",
    [row.id as string],
  );
  if (last === undefined) return jobFromRow(row, null);
  const lastRun = jobRunFromRow(last);
  return lastRun.ok ? jobFromRow(row, lastRun.value) : lastRun;
}

export function loadJob(sql: Query, id: string): Result<JobRecord | null> {
  const row = sql.get("SELECT * FROM jobs WHERE id = ?", [id]);
  return row === undefined ? ok(null) : withLastRun(sql, row);
}

// id 오름차순이다. cursor는 page 마지막 job id다.
export function loadJobs(
  sql: Query,
  filter: { creator?: AgentRef; after?: string; limit: number },
): Result<JobRecord[]> {
  const where: string[] = [];
  const params: (string | number | null)[] = [];
  if (filter.creator !== undefined) {
    const { creator_role, creator_id } = creatorColumns(filter.creator);
    where.push("creator_role = ? AND creator_id IS ?");
    params.push(creator_role, creator_id);
  }
  if (filter.after !== undefined) {
    where.push("id > ?");
    params.push(filter.after);
  }
  const clause = where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`;
  params.push(filter.limit);
  const jobs: JobRecord[] = [];
  for (
    const row of sql.all(
      `SELECT * FROM jobs${clause} ORDER BY id LIMIT ?`,
      params,
    )
  ) {
    const job = withLastRun(sql, row);
    if (!job.ok) return job;
    jobs.push(job.value);
  }
  return ok(jobs);
}

export function insertJob(
  sql: Write,
  job: {
    id: string;
    title: string;
    creator: AgentRef;
    every: string;
    at: string | null;
    action: JobAction;
    missed_policy: MissedPolicy;
    enabled: boolean;
    next_due_at: string | null;
    created_at: string;
  },
): void {
  const { creator_role, creator_id } = creatorColumns(job.creator);
  sql.run(
    `INSERT INTO jobs
      (id, title, creator_role, creator_id, every, at, action, missed_policy,
       enabled, next_due_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      job.id,
      job.title,
      creator_role,
      creator_id,
      job.every,
      job.at,
      JSON.stringify(job.action),
      job.missed_policy,
      job.enabled ? 1 : 0,
      job.next_due_at,
      job.created_at,
      job.created_at,
    ],
  );
}

export function replaceJob(
  sql: Write,
  id: string,
  fields: {
    title: string;
    every: string;
    at: string | null;
    action: JobAction;
    missed_policy: MissedPolicy;
    enabled: boolean;
    next_due_at: string | null;
    updated_at: string;
  },
): void {
  sql.run(
    `UPDATE jobs SET title = ?, every = ?, at = ?, action = ?, missed_policy = ?,
       enabled = ?, next_due_at = ?, updated_at = ? WHERE id = ?`,
    [
      fields.title,
      fields.every,
      fields.at,
      JSON.stringify(fields.action),
      fields.missed_policy,
      fields.enabled ? 1 : 0,
      fields.next_due_at,
      fields.updated_at,
      id,
    ],
  );
}

// 차례를 가져가는 claim이 쓴다. 사람이 고친 것이 아니라 updated_at은 건드리지 않는다.
export function setNextDue(sql: Write, id: string, next: string | null): void {
  sql.run("UPDATE jobs SET next_due_at = ? WHERE id = ?", [next, id]);
}

// 도는 run이나 instance는 건드리지 않는다.
export function deleteJob(sql: Write, id: string): void {
  sql.run("DELETE FROM job_runs WHERE job = ?", [id]);
  sql.run("DELETE FROM jobs WHERE id = ?", [id]);
}

export function loadJobRun(
  sql: Query,
  id: string,
): Result<JobRunRecord | null> {
  const row = sql.get("SELECT * FROM job_runs WHERE id = ?", [id]);
  return row === undefined ? ok(null) : jobRunFromRow(row);
}

function jobRunsOf(rows: Record<string, unknown>[]): Result<JobRunRecord[]> {
  const runs: JobRunRecord[] = [];
  for (const row of rows) {
    const run = jobRunFromRow(row);
    if (!run.ok) return run;
    runs.push(run.value);
  }
  return ok(runs);
}

// 새것이 앞이다. cursor는 page 마지막 job run id다.
export function loadJobRuns(
  sql: Query,
  job: string,
  page: { after?: string; limit: number },
): Result<JobRunRecord[]> {
  return page.after === undefined
    ? jobRunsOf(sql.all(
      "SELECT * FROM job_runs WHERE job = ? ORDER BY id DESC LIMIT ?",
      [job, page.limit],
    ))
    : jobRunsOf(sql.all(
      "SELECT * FROM job_runs WHERE job = ? AND id < ? ORDER BY id DESC LIMIT ?",
      [job, page.after, page.limit],
    ));
}

export function loadHolds(sql: Query): Result<JobRunRecord[]> {
  return jobRunsOf(
    sql.all("SELECT * FROM job_runs WHERE state = 'held' ORDER BY id", []),
  );
}

export function loadOpenRuns(sql: Query): Result<JobRunRecord[]> {
  return jobRunsOf(sql.all(
    "SELECT * FROM job_runs WHERE state IN ('queued', 'running') ORDER BY id",
    [],
  ));
}

// claimed_at은 sj-jobs-due만 읽고 쓴다.
export function insertJobRun(
  sql: Write,
  run: {
    id: string;
    job: string;
    due_at: string;
    missed_count: number;
    state: JobRunState;
    reason: string | null;
    created_at: string;
  },
): void {
  sql.run(
    `INSERT INTO job_runs
      (id, job, due_at, missed_count, state, reason, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      run.id,
      run.job,
      run.due_at,
      run.missed_count,
      run.state,
      run.reason,
      run.created_at,
    ],
  );
}

const RUN_FIELDS = [
  "state",
  "due_at",
  "missed_count",
  "reason",
  "run",
  "instance",
  "session",
  "started_at",
  "ended_at",
] as const;

// 준 칸만 덮는다. null은 비운다. claimed_at은 건드리지 않는다.
export function replaceJobRun(
  sql: Write,
  id: string,
  fields: Partial<
    {
      state: JobRunState;
      due_at: string;
      missed_count: number;
      reason: string | null;
      run: string | null;
      instance: string | null;
      session: string | null;
      started_at: string | null;
      ended_at: string | null;
    }
  >,
): void {
  const given = RUN_FIELDS.filter((name) => fields[name] !== undefined);
  if (given.length === 0) return;
  sql.run(
    `UPDATE job_runs SET ${
      given.map((name) => `${name} = ?`).join(", ")
    } WHERE id = ?`,
    [...given.map((name) => fields[name]!), id],
  );
}
