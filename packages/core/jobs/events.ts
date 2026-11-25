import { ok, type Result } from "../../base/mod.ts";
import { type Id, parseActor } from "../../protocol/base/mod.ts";
import {
  type JobEvent,
  type JobRecord,
  jobEventTriggers,
  jobFireEvent,
} from "../../protocol/jobs/mod.ts";
import type {
  CommandDefinition,
  ReadDefinition,
  RequestContext,
  Tx,
} from "../../protocol/server/mod.ts";
import { allowAppEvent, allowSessionEvent } from "../events/mod.ts";
import {
  isJobModeEscalated,
  isJobTargetUnavailable,
  jobEventPolicyPort,
  jobMachinePort,
  jobsChanged,
  targetAvailabilityOf,
  workflowModesPortOf,
} from "./ports.ts";
import { insertJobRun, loadJob, noteFired, noteSkipped } from "./store.ts";

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

// jobs.creator_workspace 칸(`prj_`나 `app_` id, Home은 NULL)을 workspace로 읽는다.
function workspaceOfColumn(
  column: unknown,
): { kind: "project" | "app"; id: string } | null {
  return column === null || column === undefined
    ? null
    : {
        kind: String(column).startsWith("prj_") ? "project" : "app",
        id: String(column),
      };
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
): "fired" | "skipped" | "ignored" {
  const trigger = job.trigger!;
  const policy = tx.port(jobEventPolicyPort);
  if (trigger.app === null) {
    // lophn의 session event: 도달 범위와 비사람·자동화 session 제외 규칙을 flow onEvent와 함께 쓴다.
    const allowed = allowSessionEvent({
      subscriberWorkspace: workspaceOf(job),
      session: input.session,
      reaches: (from, to) => policy.reaches(from, to),
      isDrivenSession: (sessionId) =>
        tx.sql.get("SELECT 1 AS found FROM job_runs WHERE session = ?", [
          sessionId,
        ]) !== undefined || policy.drivenSession(sessionId),
    });
    if (!allowed) return "ignored";
  } else {
    // 앱 event: 도달 범위와 같은 앱 tool_run 고리 제외 규칙을 flow onEvent와 함께 쓴다.
    const allowed = allowAppEvent({
      subscriberWorkspace: workspaceOf(job),
      sourceApp: trigger.app,
      appChain: input.chain,
      excludedApp: job.action.kind === "tool_run" ? job.action.app : undefined,
      reaches: (from, to) => policy.reaches(from, to),
    });
    if (!allowed) return "ignored";
  }

  const open = tx.sql.get(
    "SELECT 1 AS found FROM job_runs WHERE job = ? AND state IN ('queued', 'running')",
    [job.id],
  );
  if (open !== undefined) {
    noteSkipped(tx.sql, job.id, now, "busy");
    return "skipped";
  }
  if (
    job.last_fired_at !== null &&
    Date.parse(now) - Date.parse(job.last_fired_at) <
      intervalMs(trigger.min_interval)
  ) {
    noteSkipped(tx.sql, job.id, now, "too_soon");
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
        const machine = tx.port(jobMachinePort).id();
        if (!machine.ok) return machine;
        const now = tx.now();
        const lophn = input.publisher === "lophn";
        // 이 기계의 job 가운데 이 event를 때로 가진 승인한 켜진 job. 앱 event는 앱 id로, core event는 source lophn으로 맞춘다.
        // 다른 컴퓨터에서 온 event는 그 기계를 때로 가진 job만, 이 기계의 event는 기계를 적지 않은 job만 연다.
        const rows = tx.sql.all(
          `SELECT id FROM jobs
            WHERE enabled = 1 AND approved_at IS NOT NULL AND trigger IS NOT NULL
              AND machine = ?
              AND json_extract(trigger, '$.event') = ?
              AND ${lophn ? "json_extract(trigger, '$.app') IS NULL" : "json_extract(trigger, '$.app') = ?"}
              AND json_extract(trigger, '$.source_machine') IS ?
            ORDER BY id`,
          lophn
            ? [machine.value, input.event, input.machine ?? null]
            : [
                machine.value,
                input.event,
                input.publisher,
                input.machine ?? null,
              ],
        );
        const availability = targetAvailabilityOf(tx);
        const modes = workflowModesPortOf(tx);
        let fired = 0;
        let skipped = 0;
        for (const row of rows) {
          const job = loadJob(tx.sql, String(row["id"]), machine.value);
          if (!job.ok) return job;
          if (job.value === null) continue;
          // 대상 앱·project가 보관됐거나 지워졌거나 승인 뒤 권한 단계가 full로 올라갔으면
          // enabled를 건드리지 않고 건너뛴다(job_runs 줄을 만들지 않는다).
          if (
            isJobTargetUnavailable(job.value, availability) ||
            isJobModeEscalated(job.value, modes)
          ) {
            continue;
          }
          const workspace = job.value.creator.workspace?.id;
          if (
            workspace !== undefined &&
            input.skip_workspaces?.includes(workspace) === true
          ) {
            continue;
          }
          // 이름(source)은 보여 주는 글이라 승인 때의 slug가 아니라 event를 낸 쪽의 이름을 싣는다.
          const remote = input.machine !== undefined || input.remote === true;
          const event: JobEvent = {
            source: job.value.trigger!.source,
            event: input.event,
            payload: input.payload,
            ...(input.machine === undefined ? {} : { machine: input.machine }),
            ...(remote ? { remote: true as const } : {}),
          };
          const outcome = consider(
            tx,
            job.value,
            event,
            { chain: input.chain, session: input.session },
            now,
          );
          if (outcome === "fired") fired += 1;
          else if (outcome === "skipped") skipped += 1;
        }
        if (fired + skipped > 0) jobsChanged(tx);
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
        const machine = snapshot.port(jobMachinePort).id();
        if (!machine.ok) return machine;
        const rows = snapshot.sql.all(
          `SELECT DISTINCT json_extract(trigger, '$.app') AS app, json_extract(trigger, '$.event') AS event,
                  json_extract(trigger, '$.source_machine') AS machine, creator_workspace
             FROM jobs
            WHERE enabled = 1 AND approved_at IS NOT NULL AND trigger IS NOT NULL
              AND machine = ?`,
          [machine.value],
        );
        return ok({
          triggers: rows.map((row) => ({
            app: (row["app"] ?? null) as Id<"app"> | null,
            event: String(row["event"]),
            machine: (row["machine"] ?? null) as Id<"mch"> | null,
            workspace: workspaceOfColumn(row["creator_workspace"]),
          })),
          as_of_seq: snapshot.as_of_seq,
          next_cursor: null,
        });
      },
    },
  };
}
