import { err, ok, type Result } from "../../base/mod.ts";
import type { AgentRef } from "../../protocol/lophn-agent/mod.ts";
import {
  type JobRecord,
  jobRecordSchema,
  type JobRunRecord,
  jobRunRecordSchema,
} from "../../protocol/jobs/mod.ts";

// createSql은 INTEGER를 bigint로 준다. 1n === 1은 늘 거짓이라 Number()로 읽는다.
export function jobRunFromRow(
  row: Record<string, unknown>,
): Result<JobRunRecord> {
  const parsed = jobRunRecordSchema.safeParse({
    id: row.id,
    job: row.job,
    due_at: row.due_at,
    missed_count: Number(row.missed_count),
    state: row.state,
    reason: row.reason,
    run: row.run,
    instance: row.instance,
    session: row.session,
    started_at: row.started_at,
    ended_at: row.ended_at,
    created_at: row.created_at,
  });
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "internal", message: "invalid stored job run" });
}

export function jobFromRow(
  row: Record<string, unknown>,
  lastRun: JobRunRecord | null,
): Result<JobRecord> {
  const parsed = jobRecordSchema.safeParse({
    id: row.id,
    title: row.title,
    creator: creatorFromRow(row),
    every: row.every,
    at: row.at,
    action: JSON.parse(String(row.action)),
    missed_policy: row.missed_policy,
    enabled: Number(row.enabled) === 1,
    next_due_at: row.next_due_at,
    last_run: lastRun === null ? null : {
      job_run: lastRun.id,
      state: lastRun.state,
      due_at: lastRun.due_at,
      started_at: lastRun.started_at,
      ended_at: lastRun.ended_at,
    },
    created_at: row.created_at,
    updated_at: row.updated_at,
  });
  return parsed.success
    ? ok(parsed.data)
    : err({ code: "internal", message: "invalid stored job" });
}

function creatorFromRow(row: Record<string, unknown>): unknown {
  switch (row.creator_role) {
    case "project_manager":
      return { role: "project_manager", project: row.creator_id };
    case "app_engineer":
      return { role: "app_engineer", app: row.creator_id };
    default:
      return { role: "lophn" };
  }
}

// creatorFromRow와 짝이다. Operator는 job을 만들지 못하므로 표에 넣으면 CHECK가 막는다.
export function creatorColumns(
  ref: AgentRef,
): { creator_role: string; creator_id: string | null } {
  switch (ref.role) {
    case "lophn":
      return { creator_role: "lophn", creator_id: null };
    case "project_manager":
      return { creator_role: ref.role, creator_id: ref.project };
    case "app_engineer":
      return { creator_role: ref.role, creator_id: ref.app };
    case "operator":
      return { creator_role: ref.role, creator_id: ref.agent };
  }
}
