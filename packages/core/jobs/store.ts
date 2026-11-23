import { ok, type Result } from "../../base/mod.ts";
import type {
  JobAction,
  JobEvent,
  JobRecord,
  JobRunRecord,
  JobRunState,
  JobSkipReason,
  JobTrigger,
  MissedPolicy,
} from "../../protocol/jobs/mod.ts";
import type { AgentAtWorkspace } from "../../protocol/lophn-agent/mod.ts";
import type { Sql } from "../../protocol/server/mod.ts";
import { isJobTargetUnavailable, type JobTargetAvailability } from "./ports.ts";
import { creatorColumns, jobFromRow, jobRunFromRow } from "./rows.ts";

type Query = Pick<Sql, "get" | "all">;
type Write = Pick<Sql, "get" | "run">;

// id 정렬이 곧 시간 순이다. job 줄은 가장 큰 job run id를 last_run으로 싣는다.
function withLastRun(
  sql: Query,
  row: Record<string, unknown>,
  me: string,
): Result<JobRecord> {
  const last = sql.get(
    "SELECT * FROM job_runs WHERE job = ? ORDER BY id DESC LIMIT 1",
    [row.id as string],
  );
  if (last === undefined) return jobFromRow(row, null, me);
  const lastRun = jobRunFromRow(last);
  return lastRun.ok ? jobFromRow(row, lastRun.value, me) : lastRun;
}

// me는 이 기계의 id다(job의 runs_here를 채운다).
export function loadJob(
  sql: Query,
  id: string,
  me: string,
): Result<JobRecord | null> {
  const row = sql.get("SELECT * FROM jobs WHERE id = ?", [id]);
  return row === undefined ? ok(null) : withLastRun(sql, row, me);
}

// id 오름차순이다. cursor는 page 마지막 job id다.
export function loadJobs(
  sql: Query,
  filter: { creator?: AgentAtWorkspace; after?: string; limit: number },
  me: string,
): Result<JobRecord[]> {
  const where: string[] = [];
  const params: (string | number | null)[] = [];
  if (filter.creator !== undefined) {
    const { creator_agent, creator_workspace } = creatorColumns(filter.creator);
    where.push("creator_agent = ? AND creator_workspace IS ?");
    params.push(creator_agent, creator_workspace);
  }
  if (filter.after !== undefined) {
    where.push("id > ?");
    params.push(filter.after);
  }
  const clause = where.length === 0 ? "" : ` WHERE ${where.join(" AND ")}`;
  params.push(filter.limit);
  const jobs: JobRecord[] = [];
  for (const row of sql.all(
    `SELECT * FROM jobs${clause} ORDER BY id LIMIT ?`,
    params,
  )) {
    const job = withLastRun(sql, row, me);
    if (!job.ok) return job;
    jobs.push(job.value);
  }
  return ok(jobs);
}

// 새 job은 승인 대기다(approved_at, next_due_at이 NULL).
export function insertJob(
  sql: Write,
  job: {
    id: string;
    title: string;
    creator: AgentAtWorkspace;
    every: string | null;
    at: string | null;
    trigger?: JobTrigger | null;
    action: JobAction;
    missed_policy: MissedPolicy;
    enabled: boolean;
    machine: string;
    created_at: string;
  },
): void {
  const { creator_agent, creator_workspace } = creatorColumns(job.creator);
  sql.run(
    `INSERT INTO jobs
      (id, title, creator_agent, creator_workspace, every, at, trigger, action, missed_policy,
       enabled, machine, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      job.id,
      job.title,
      creator_agent,
      creator_workspace,
      job.every,
      job.at,
      job.trigger === undefined || job.trigger === null
        ? null
        : JSON.stringify(job.trigger),
      JSON.stringify(job.action),
      job.missed_policy,
      job.enabled ? 1 : 0,
      job.machine,
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
    every: string | null;
    at: string | null;
    missed_policy: MissedPolicy;
    enabled: boolean;
    next_due_at: string | null;
    updated_at: string;
  },
): void {
  sql.run(
    `UPDATE jobs SET title = ?, every = ?, at = ?, missed_policy = ?,
       enabled = ?, next_due_at = ?, updated_at = ? WHERE id = ?`,
    [
      fields.title,
      fields.every,
      fields.at,
      fields.missed_policy,
      fields.enabled ? 1 : 0,
      fields.next_due_at,
      fields.updated_at,
      id,
    ],
  );
}

export function approveJob(
  sql: Write,
  id: string,
  fields: { approved_at: string; next_due_at: string | null },
): void {
  sql.run(
    "UPDATE jobs SET approved_at = ?, next_due_at = ?, updated_at = ? WHERE id = ?",
    [fields.approved_at, fields.next_due_at, fields.approved_at, id],
  );
}

// 이 기계에서 승인을 기다리는 job. id 순이 곧 만든 순이다.
export function loadPendingJobs(sql: Query, me: string): Result<JobRecord[]> {
  const jobs: JobRecord[] = [];
  for (const row of sql.all(
    "SELECT * FROM jobs WHERE approved_at IS NULL AND machine = ? ORDER BY id",
    [me],
  )) {
    const job = withLastRun(sql, row, me);
    if (!job.ok) return job;
    jobs.push(job.value);
  }
  return ok(jobs);
}

// 다른 기계로 가져온 job: 주인을 이 기계로 바꾸고 다음 차례를 지금부터 새로 센다. 사람이 고친 것이 아니라 updated_at은 건드리지 않는다.
export function takeJob(
  sql: Write,
  id: string,
  me: string,
  nextDue: string | null,
): void {
  sql.run("UPDATE jobs SET machine = ?, next_due_at = ? WHERE id = ?", [
    me,
    nextDue,
    id,
  ]);
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
    ? jobRunsOf(
        sql.all(
          "SELECT * FROM job_runs WHERE job = ? ORDER BY id DESC LIMIT ?",
          [job, page.limit],
        ),
      )
    : jobRunsOf(
        sql.all(
          "SELECT * FROM job_runs WHERE job = ? AND id < ? ORDER BY id DESC LIMIT ?",
          [job, page.after, page.limit],
        ),
      );
}

// 이 기계의 job의 줄만이다.
const OF_THIS_MACHINE = "job IN (SELECT id FROM jobs WHERE machine = ?)";

export function loadHolds(sql: Query, me: string): Result<JobRunRecord[]> {
  return jobRunsOf(
    sql.all(
      `SELECT * FROM job_runs WHERE state = 'held' AND ${OF_THIS_MACHINE} ORDER BY id`,
      [me],
    ),
  );
}

// 열린 job run의 상태. 겹침 판정(loadOpenRuns)과 idle 판정(hasActivity)이 같은 정의를 쓴다.
const OPEN_JOB_RUNS = "state IN ('queued', 'running')";

export function loadOpenRuns(sql: Query): Result<JobRunRecord[]> {
  return jobRunsOf(
    sql.all(`SELECT * FROM job_runs WHERE ${OPEN_JOB_RUNS} ORDER BY id`, []),
  );
}

// idle-exit가 보는 일. 켜진 job은 승인 여부로 다시 거르지 않는다. 주인이 이 기계가 아닌 job과
// 대상 앱·project가 보관(archived)됐거나 지워진 job은 돌지 않으니 세지 않는다.
export function hasActivity(
  sql: Query,
  me: string,
  availability?: JobTargetAvailability,
): Result<boolean> {
  if (availability === undefined) {
    const row = sql.get(
      `SELECT EXISTS (SELECT 1 FROM jobs WHERE enabled = 1 AND machine = ?)
         OR EXISTS (SELECT 1 FROM job_runs WHERE ${OPEN_JOB_RUNS} AND ${OF_THIS_MACHINE}) AS busy`,
      [me, me],
    );
    return ok(Number(row?.["busy"] ?? 0) === 1);
  }
  const openRun = sql.get(
    `SELECT EXISTS (SELECT 1 FROM job_runs WHERE ${OPEN_JOB_RUNS} AND ${OF_THIS_MACHINE}) AS busy`,
    [me],
  );
  if (Number(openRun?.["busy"] ?? 0) === 1) return ok(true);
  const rows = sql.all(
    "SELECT action, trigger FROM jobs WHERE enabled = 1 AND machine = ?",
    [me],
  );
  for (const row of rows) {
    const action = JSON.parse(String(row["action"])) as JobAction;
    const trigger =
      row["trigger"] === null || row["trigger"] === undefined
        ? null
        : (JSON.parse(String(row["trigger"])) as JobTrigger);
    if (!isJobTargetUnavailable({ action, trigger }, availability)) {
      return ok(true);
    }
  }
  return ok(false);
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
    event?: JobEvent | null;
  },
): void {
  sql.run(
    `INSERT INTO job_runs
      (id, job, due_at, missed_count, state, reason, created_at, event)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      run.id,
      run.job,
      run.due_at,
      run.missed_count,
      run.state,
      run.reason,
      run.created_at,
      run.event === undefined || run.event === null
        ? null
        : JSON.stringify(run.event),
    ],
  );
}

// event job이 차례를 열었다(queued 줄은 호출한 쪽이 만든다).
export function noteFired(sql: Write, id: string, at: string): void {
  sql.run(
    "UPDATE jobs SET fired_count = fired_count + 1, last_fired_at = ? WHERE id = ?",
    [at, id],
  );
}

// event를 건너뛰었다. 줄로 쌓지 않고 센다.
export function noteSkipped(
  sql: Write,
  id: string,
  at: string,
  reason: JobSkipReason,
): void {
  sql.run(
    `UPDATE jobs SET skipped_count = skipped_count + 1, last_skipped_at = ?,
       last_skip_reason = ? WHERE id = ?`,
    [at, reason, id],
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
  fields: Partial<{
    state: JobRunState;
    due_at: string;
    missed_count: number;
    reason: string | null;
    run: string | null;
    instance: string | null;
    session: string | null;
    started_at: string | null;
    ended_at: string | null;
  }>,
): void {
  const given = RUN_FIELDS.filter((name) => fields[name] !== undefined);
  if (given.length === 0) return;
  sql.run(
    `UPDATE job_runs SET ${given
      .map((name) => `${name} = ?`)
      .join(", ")} WHERE id = ?`,
    [...given.map((name) => fields[name]!), id],
  );
}
