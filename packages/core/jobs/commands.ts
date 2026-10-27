import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { type Id, parseActor } from "../../protocol/base/mod.ts";
import {
  type JobAction,
  type JobActionInput,
  jobCreate,
  jobDelete,
  type JobRecord,
  jobUpdate,
} from "../../protocol/jobs/mod.ts";
import type { AgentRef } from "../../protocol/lophn-agent/mod.ts";
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
import { deleteJob, insertJob, loadJob, replaceJob } from "./store.ts";

function fail(
  code: "invalid_input" | "not_found" | "forbidden",
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

// 이름은 만들 때 풀어 id로 저장한다. 앱의 tool 이름과 workflow file은 부를 때 본다.
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
        agent_place: resolved.value.place,
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

// agent는 자기와 같은 agent가 만든 job만 본다. 남의 job은 있는지도 알리지 않는다(not_found).
// user는 어느 job이든 한다.
function loadOwned(tx: Tx, ctx: RequestContext, id: string): Result<JobRecord> {
  const actor = parseActor(ctx.actor);
  let me: AgentRef | undefined;
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

const CREATOR_ROLES = ["lophn", "project_manager", "app_engineer"];

export function createJobCommands(): {
  create: CommandDefinition<typeof jobCreate>;
  update: CommandDefinition<typeof jobUpdate>;
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
        if (creator === undefined || !CREATOR_ROLES.includes(creator.role)) {
          return fail(
            "forbidden",
            "only lophn, a Project Manager or an App Engineer creates a job",
          );
        }
        const at = input.at ?? null;
        const checked = checkAt(input.every, at);
        if (!checked.ok) return checked;
        const action = resolveAction(tx, input.action);
        if (!action.ok) return action;
        const now = tx.now();
        const enabled = input.enabled ?? true;
        const id = tx.newId("job");
        insertJob(tx.sql, {
          id,
          title: input.title,
          creator,
          every: input.every,
          at,
          action: action.value,
          missed_policy: input.missed_policy,
          enabled,
          next_due_at: enabled
            ? firstDue(
                {
                  every: input.every,
                  at,
                  zone: tx.port(jobZonePort).zone(),
                },
                now,
              )
            : null,
          created_at: now,
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
        let action = job.action;
        if (input.action !== undefined) {
          const resolved = resolveAction(tx, input.action);
          if (!resolved.ok) return resolved;
          action = resolved.value;
        }
        const now = tx.now();
        // 켜지는 순간이거나 주기나 시각이 바뀌면 그 순간부터 새로 센다. 놓친 것으로 치지 않는다.
        const recount =
          every !== job.every || at !== job.at || (enabled && !job.enabled);
        replaceJob(tx.sql, job.id, {
          title: input.title ?? job.title,
          every,
          at,
          action,
          missed_policy: input.missed_policy ?? job.missed_policy,
          enabled,
          next_due_at: !enabled
            ? null
            : recount
              ? firstDue({ every, at, zone: tx.port(jobZonePort).zone() }, now)
              : job.next_due_at,
          updated_at: now,
        });
        changed(tx, job.id);
        const updated = loadJob(tx.sql, job.id);
        return updated.ok ? ok({ job: updated.value! }) : updated;
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
