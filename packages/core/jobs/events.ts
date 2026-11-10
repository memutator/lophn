import { ok, type Result } from "../../base/mod.ts";
import { type Id, parseActor } from "../../protocol/base/mod.ts";
import {
  jobEventTriggers,
  jobFireEvent,
  type JobEvent,
  type JobRecord,
} from "../../protocol/jobs/mod.ts";
import type {
  CommandDefinition,
  ReadDefinition,
  RequestContext,
  Tx,
} from "../../protocol/server/mod.ts";
import { afterCommit } from "../storage/ledger/after-commit.ts";
import {
  JOBS_CHANGED_TOPIC,
  type JobsChangedData,
  jobEventPolicyPort,
} from "./ports.ts";
import { loadJob, insertJobRun, noteFired, noteSkipped } from "./store.ts";

const UNIT_MS = { m: 60_000, h: 3_600_000, d: 86_400_000 } as const;

// `<수><m|h|d>`를 ms로. 최소 간격이다.
function intervalMs(value: string): number {
  return (
    Number(value.slice(0, -1)) * UNIT_MS[value.slice(-1) as "m" | "h" | "d"]
  );
}

function workspaceOf(
  job: JobRecord,
): { kind: "project" | "app"; id: string } | null {
  return job.creator.workspace === null
    ? null
    : { kind: job.creator.workspace.kind, id: job.creator.workspace.id };
}

// event가 한 job을 연다: 건너뛰거나(busy, too_soon) 차례를 queued로 만든다. 걸러 내는 것(session 범위, 자기 run, 앱 사슬)은 조용히 넘긴다.
function consider(
  tx: Tx,
  job: JobRecord,
  event: JobEvent,
  input: {
    chain: readonly string[];
    session: {
      id: string;
      workspace: { kind: "project" | "app"; id: string } | null;
    } | null;
  },
  now: string,
  touched: Map<string, string | null>,
): "fired" | "skipped" | "ignored" {
  const trigger = job.trigger!;
  if (trigger.app === null) {
    // lophn의 session event. job의 workspace가 call 정책으로 닿을 수 있는 session만 본다.
    if (input.session === null) return "ignored";
    const policy = tx.port(jobEventPolicyPort);
    if (!policy.reaches(workspaceOf(job), input.session.workspace)) {
      return "ignored";
    }
    // 사람이 연 session의 event만 job을 깨운다. 어느 job(이 job이든 다른 job이든)의 run이 연 session, run·workflow step·팀·call로 열린
    // session은 건너뛰지도 세지도 않는다(job이 job을 깨우는 고리). 앱 화면이 연 session은 사람이 보는 중이라 깨운다.
    const driven = tx.sql.get(
      "SELECT 1 AS found FROM job_runs WHERE session = ?",
      [input.session.id],
    );
    if (driven !== undefined || policy.drivenSession(input.session.id)) {
      return "ignored";
    }
  } else {
    // 앱 event: job의 workspace가 그 앱 workspace에 call 정책으로 닿을 수 있어야 본다(private 앱의 event가 다른 workspace의 job을 깨우지 않는다).
    if (
      !tx
        .port(jobEventPolicyPort)
        .reaches(workspaceOf(job), { kind: "app", id: trigger.app })
    ) {
      return "ignored";
    }
    if (
      job.action.kind === "tool_run" &&
      input.chain.includes(job.action.app)
    ) {
      // 이 job이 부르는 앱이 이 event의 인과에 이미 있다: 그 앱의 호출이 낸 event가 이 job으로 돌아오는 고리다.
      return "ignored";
    }
  }

  const open = tx.sql.get(
    "SELECT 1 AS found FROM job_runs WHERE job = ? AND state IN ('queued', 'running')",
    [job.id],
  );
  if (open !== undefined) {
    noteSkipped(tx.sql, job.id, now, "busy");
    touched.set(job.id, null);
    return "skipped";
  }
  if (
    job.last_fired_at !== null &&
    Date.parse(now) - Date.parse(job.last_fired_at) <
      intervalMs(trigger.min_interval)
  ) {
    noteSkipped(tx.sql, job.id, now, "too_soon");
    touched.set(job.id, null);
    return "skipped";
  }
  const id = tx.newId("jbr");
  insertJobRun(tx.sql, {
    id,
    job: job.id,
    due_at: now,
    missed_count: 0,
    state: "queued",
    reason: null,
    created_at: now,
    event,
  });
  noteFired(tx.sql, job.id, now);
  touched.set(job.id, id);
  return "fired";
}

export function createEventCommands(): {
  fire: CommandDefinition<typeof jobFireEvent>;
  triggers: ReadDefinition<typeof jobEventTriggers>;
} {
  const notMachine = (ctx: RequestContext) =>
    parseActor(ctx.actor)?.kind !== "machine";
  return {
    fire: {
      route: jobFireEvent,
      handle(tx, ctx, input): Result<{ fired: number; skipped: number }> {
        if (notMachine(ctx)) {
          return {
            ok: false,
            error: { code: "forbidden", message: "only core fires event jobs" },
          };
        }
        const now = tx.now();
        const lophn = input.publisher === "lophn";
        // 이 event를 때로 가진 승인한 켜진 job. 앱 event는 앱 id로, core event는 source lophn으로 맞춘다.
        const rows = tx.sql.all(
          `SELECT id FROM jobs
            WHERE enabled = 1 AND approved_at IS NOT NULL AND trigger IS NOT NULL
              AND json_extract(trigger, '$.event') = ?
              AND ${lophn ? "json_extract(trigger, '$.app') IS NULL" : "json_extract(trigger, '$.app') = ?"}
            ORDER BY id`,
          lophn ? [input.event] : [input.event, input.publisher],
        );
        let fired = 0;
        let skipped = 0;
        const touched = new Map<string, string | null>();
        for (const row of rows) {
          const job = loadJob(tx.sql, String(row["id"]));
          if (!job.ok) return job;
          if (job.value === null) continue;
          // 이름(source)은 보여 주는 글이라 승인 때의 slug가 아니라 event를 낸 쪽의 이름을 싣는다.
          const event: JobEvent = {
            source: job.value.trigger!.source,
            event: input.event,
            payload: input.payload,
          };
          const outcome = consider(
            tx,
            job.value,
            event,
            { chain: input.chain, session: input.session },
            now,
            touched,
          );
          if (outcome === "fired") fired += 1;
          else if (outcome === "skipped") skipped += 1;
        }
        for (const [job, jobRun] of touched) {
          const data: JobsChangedData = {
            job: job as Id<"job">,
            job_run: jobRun as Id<"jbr"> | null,
          };
          tx.port(afterCommit).push(JOBS_CHANGED_TOPIC, data);
        }
        return ok({ fired, skipped });
      },
    },
    triggers: {
      route: jobEventTriggers,
      handle(snapshot, ctx) {
        if (notMachine(ctx)) {
          return {
            ok: false,
            error: {
              code: "forbidden",
              message: "only core reads event triggers",
            },
          };
        }
        const rows = snapshot.sql.all(
          `SELECT DISTINCT json_extract(trigger, '$.app') AS app, json_extract(trigger, '$.event') AS event
             FROM jobs
            WHERE enabled = 1 AND approved_at IS NOT NULL AND trigger IS NOT NULL`,
          [],
        );
        return ok({
          triggers: rows.map((row) => ({
            app: (row["app"] ?? null) as Id<"app"> | null,
            event: String(row["event"]),
          })),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
