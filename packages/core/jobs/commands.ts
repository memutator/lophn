import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { type Id, parseActor } from "../../protocol/base/mod.ts";
import {
  type JobAction,
  type JobActionInput,
  jobApprove,
  jobCreate,
  jobDelete,
  type JobRecord,
  jobUpdate,
} from "../../protocol/jobs/mod.ts";
import type { AgentAtWorkspace } from "../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../protocol/server/mod.ts";
import { afterCommit } from "../storage/ledger/after-commit.ts";
import {
  JOBS_CHANGED_TOPIC,
  type JobsChangedData,
  jobTargetsPort,
  jobZonePort,
} from "./ports.ts";
import { creatorColumns } from "./rows.ts";
import { firstDue } from "./schedule.ts";
import {
  approveJob,
  deleteJob,
  insertJob,
  loadJob,
  replaceJob,
} from "./store.ts";

function fail(
  code: "invalid_input" | "not_found" | "forbidden" | "conflict",
  message: string,
): Result<never> {
  return err({ code, message });
}

function changed(tx: Tx, job: string): void {
  const data: JobsChangedData = { job: job as Id<"job">, job_run: null };
  tx.port(afterCommit).push(JOBS_CHANGED_TOPIC, data);
}

// at은 d 단위 주기에만 둔다.
function checkAt(every: string, at: string | null): Result<void> {
  return at !== null && !every.endsWith("d")
    ? fail("invalid_input", "at needs an every in days")
    : ok(undefined);
}

// 이름은 만들 때 풀어 id로 저장한다. 앱의 command 이름과 workflow file은 부를 때 본다.
function resolveAction(tx: Tx, input: JobActionInput): Result<JobAction> {
  const targets = tx.port(jobTargetsPort);
  switch (input.kind) {
    case "agent_run": {
      if (input.schema !== undefined) {
        try {
          z.fromJSONSchema(input.schema);
        } catch {
          return fail("invalid_input", "schema is not a readable JSON Schema");
        }
      }
      const resolved = targets.resolveAgent(input.agent);
      if (!resolved.ok) return resolved;
      return ok({
        kind: "agent_run",
        agent: resolved.value.agent,
        agent_workspace: resolved.value.workspace,
        prompt: input.prompt,
        ...(input.input === undefined ? {} : { input: input.input }),
        ...(input.schema === undefined ? {} : { schema: input.schema }),
      });
    }
    case "tool_run": {
      const app = targets.resolveApp(input.app);
      if (!app.ok) return app;
      return ok({
        kind: "tool_run",
        app: app.value,
        tool: input.tool,
        ...(input.input === undefined ? {} : { input: input.input }),
      });
    }
    case "workflow_start": {
      const [projectName, workflow] = input.workflow.split("/") as [
        string,
        string,
      ];
      const project = targets.resolveProject(projectName);
      if (!project.ok) return project;
      return ok({
        kind: "workflow_start",
        project: project.value,
        workflow,
        text: input.text,
        ...(input.step === undefined ? {} : { step: input.step }),
      });
    }
  }
}

// agent는 같은 agent가 같은 workspace에서 만든 job만 본다. 남의 job은 있는지도 알리지 않는다(not_found).
// user는 어느 job이든 한다.
function loadOwned(tx: Tx, ctx: RequestContext, id: string): Result<JobRecord> {
  const actor = parseActor(ctx.actor);
  let me: AgentAtWorkspace | undefined;
  if (actor?.kind === "agent") {
    me = tx.port(jobTargetsPort).creatorOf(actor.id as Id<"ses">);
    if (me === undefined) return fail("forbidden", "the session is not known");
  }
  const loaded = loadJob(tx.sql, id);
  if (!loaded.ok) return loaded;
  const job = loaded.value;
  if (job === null) return fail("not_found", "job not found");
  if (
    me !== undefined &&
    JSON.stringify(creatorColumns(me)) !==
      JSON.stringify(creatorColumns(job.creator))
  ) {
    return fail("not_found", "job not found");
  }
  return ok(job);
}

// 앱을 지우면 그 앱을 부르는 job(앱 tool, 앱 workspace의 agent 호출)과 그 앱 workspace가 만든 job을 지운다.
// 도는 run은 끝까지 돈다(job 지우기와 같다).
export function eraseJobsOfApp(tx: Tx, app: string): void {
  const ids = tx.sql
    .all(
      `SELECT id FROM jobs
       WHERE creator_workspace = ?1
          OR (json_extract(action, '$.kind') = 'tool_run' AND json_extract(action, '$.app') = ?1)
          OR (json_extract(action, '$.kind') = 'agent_run'
              AND json_extract(action, '$.agent_workspace.kind') = 'app'
              AND json_extract(action, '$.agent_workspace.id') = ?1)`,
      [app],
    )
    .map((row) => String(row["id"]));
  for (const id of ids) {
    deleteJob(tx.sql, id);
    changed(tx, id);
  }
}

export function createJobCommands(): {
  create: CommandDefinition<typeof jobCreate>;
  update: CommandDefinition<typeof jobUpdate>;
  approve: CommandDefinition<typeof jobApprove>;
  remove: CommandDefinition<typeof jobDelete>;
} {
  return {
    create: {
      route: jobCreate,
      handle(tx, ctx, input) {
        const actor = parseActor(ctx.actor);
        if (actor?.kind !== "agent") {
          return fail("forbidden", "only an agent creates a job");
        }
        const creator = tx
          .port(jobTargetsPort)
          .creatorOf(actor.id as Id<"ses">);
        if (creator === undefined) {
          return fail("forbidden", "the session is not known");
        }
        const at = input.at ?? null;
        const checked = checkAt(input.every, at);
        if (!checked.ok) return checked;
        const action = resolveAction(tx, input.action);
        if (!action.ok) return action;
        const id = tx.newId("job");
        insertJob(tx.sql, {
          id,
          title: input.title,
          creator,
          every: input.every,
          at,
          action: action.value,
          missed_policy: input.missed_policy,
          enabled: input.enabled ?? true,
          created_at: tx.now(),
        });
        changed(tx, id);
        const job = loadJob(tx.sql, id);
        return job.ok ? ok({ job: job.value! }) : job;
      },
    },
    update: {
      route: jobUpdate,
      handle(tx, ctx, input) {
        const owned = loadOwned(tx, ctx, input.job);
        if (!owned.ok) return owned;
        const job = owned.value;
        const every = input.every ?? job.every;
        const at = input.at === undefined ? job.at : input.at;
        const enabled = input.enabled ?? job.enabled;
        const checked = checkAt(every, at);
        if (!checked.ok) return checked;
        const now = tx.now();
        // 켜지는 순간이거나 주기나 시각이 바뀌면 그 순간부터 새로 센다. 놓친 것으로 치지 않는다.
        const recount =
          every !== job.every || at !== job.at || (enabled && !job.enabled);
        replaceJob(tx.sql, job.id, {
          title: input.title ?? job.title,
          every,
          at,
          missed_policy: input.missed_policy ?? job.missed_policy,
          enabled,
          next_due_at:
            !enabled || job.approved_at === null
              ? null
              : recount
                ? firstDue(
                    { every, at, zone: tx.port(jobZonePort).zone() },
                    now,
                  )
                : job.next_due_at,
          updated_at: now,
        });
        changed(tx, job.id);
        const updated = loadJob(tx.sql, job.id);
        return updated.ok ? ok({ job: updated.value! }) : updated;
      },
    },
    approve: {
      route: jobApprove,
      handle(tx, _ctx, input) {
        const loaded = loadJob(tx.sql, input.job);
        if (!loaded.ok) return loaded;
        const job = loaded.value;
        if (job === null) return fail("not_found", "job not found");
        if (job.approved_at !== null) {
          return fail("conflict", "job is already approved");
        }
        changed(tx, job.id);
        if (input.choice === "reject") {
          deleteJob(tx.sql, job.id);
          return ok({ job: null });
        }
        // 승인한 순간부터 센다. 기다린 동안은 놓친 것으로 치지 않는다.
        const now = tx.now();
        approveJob(tx.sql, job.id, {
          approved_at: now,
          next_due_at: job.enabled
            ? firstDue(
                {
                  every: job.every,
                  at: job.at,
                  zone: tx.port(jobZonePort).zone(),
                },
                now,
              )
            : null,
        });
        const approved = loadJob(tx.sql, job.id);
        return approved.ok ? ok({ job: approved.value! }) : approved;
      },
    },
    remove: {
      route: jobDelete,
      handle(tx, ctx, input) {
        const owned = loadOwned(tx, ctx, input.job);
        if (!owned.ok) return owned;
        deleteJob(tx.sql, input.job);
        changed(tx, input.job);
        return ok({ job: input.job });
      },
    },
  };
}
