import { err, ok, type Result } from "../../base/mod.ts";
import type { AgentAtPlace } from "../../protocol/lophn-agent/mod.ts";
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
    last_run:
      lastRun === null
        ? null
        : {
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
  const place = row.creator_place;
  return {
    agent: row.creator_agent,
    place:
      place === null
        ? null
        : {
            kind: String(place).startsWith("prj_") ? "project" : "app",
            id: place,
          },
  };
}

// creatorFromRow와 짝이다.
export function creatorColumns(creator: AgentAtPlace): {
  creator_agent: string;
  creator_place: string | null;
} {
  return {
    creator_agent: creator.agent,
    creator_place: creator.place?.id ?? null,
  };
}
