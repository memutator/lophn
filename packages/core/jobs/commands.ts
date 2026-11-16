import { z } from "zod";
import { err, ok, type Result } from "../../base/mod.ts";
import { type Id, parseActor } from "../../protocol/base/mod.ts";
import {
  JOB_TRIGGER_DEFAULT_INTERVAL,
  type JobAction,
  type JobActionInput,
  jobApprove,
  jobCreate,
  jobDelete,
  type JobRecord,
  jobTakeOver,
  type JobTrigger,
  type JobTriggerInput,
  jobUpdate,
} from "../../protocol/jobs/mod.ts";
import { SESSION_EVENTS } from "../../protocol/lophn-agent/session-lifecycle.ts";
import type { AgentAtWorkspace } from "../../protocol/lophn-agent/mod.ts";
import type {
  CommandDefinition,
  RequestContext,
  Tx,
} from "../../protocol/server/mod.ts";
import {
  jobsChanged,
  jobEventPolicyPort,
  jobMachinePort,
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
  takeJob,
} from "./store.ts";

function fail(
  code: "invalid_input" | "not_found" | "forbidden" | "conflict",
  message: string,
): Result<never> {
  return err({ code, message });
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

// event 때를 푼다: 앱은 id로 풀고 그 active release가 선언한 event여야 하며, `lophn`은 core의 session event만이다(`call.settled`는 한 앱에게만
// 가는 event라 job의 때가 아니다). 앱 event의 선언이 나중 release에서 빠지면 job은 그냥 돌지 않는다.
function resolveTrigger(
  tx: Tx,
  input: JobTriggerInput,
  action: JobAction,
  creator: AgentAtWorkspace,
): Result<JobTrigger> {
  const passEvent = input.pass_event ?? false;
  if (passEvent) {
    if (action.kind !== "tool_run") {
      return fail("invalid_input", "pass_event is only for a tool_run action");
    }
    const given = action.input;
    if (
      given !== undefined &&
      (typeof given !== "object" || given === null || Array.isArray(given))
    ) {
      return fail(
        "invalid_input",
        "pass_event needs the tool input to be an object or absent",
      );
    }
  }
  const base = {
    event: input.event,
    min_interval: input.min_interval ?? JOB_TRIGGER_DEFAULT_INTERVAL,
    pass_event: passEvent,
  };
  if (input.source === "lophn") {
    if (!(SESSION_EVENTS as readonly string[]).includes(input.event)) {
      return fail(
        "invalid_input",
        `lophn events a job can use: ${SESSION_EVENTS.join(", ")}`,
      );
    }
    return ok({ ...base, source: "lophn", app: null });
  }
  const policy = tx.port(jobEventPolicyPort);
  const app = policy.resolveSource(input.source);
  if (!app.ok) return app;
  // 앱의 event에 같은 앱의 tool로 답하면 그 호출이 낸 event의 사슬에 그 앱이 늘 있어 job이 영영 돌지 않는다.
  if (action.kind === "tool_run" && action.app === app.value.app) {
    return fail(
      "invalid_input",
      `a job cannot call ${app.value.slug} when ${app.value.slug} publishes the event: events caused by a call to the same app never start the job (use an agent_run or a workflow that calls the app instead)`,
    );
  }
  // 앱 event는 그 앱 workspace가 job의 workspace에서 call 정책으로 닿을 수 있어야 한다(private 앱의 event를 다른 workspace의 job이 듣지 못한다).
  if (
    !policy.reaches(
      creator.workspace === null
        ? null
        : { kind: creator.workspace.kind, id: creator.workspace.id },
      { kind: "app", id: app.value.app },
    )
  ) {
    return fail(
      "forbidden",
      `the call policy does not let this workspace reach ${app.value.slug}`,
    );
  }
  if (!policy.declares(app.value.app, input.event)) {
    return fail(
      "invalid_input",
      `${app.value.slug} does not declare the event ${input.event} in its active release`,
    );
  }
  return ok({ ...base, source: app.value.slug, app: app.value.app });
}

// agent는 같은 agent가 같은 workspace에서 만든 job만 본다. 남의 job은 있는지도 알리지 않는다(not_found).
// user는 어느 job이든 한다.
function loadOwned(
  tx: Tx,
  ctx: RequestContext,
  id: string,
  machine: string,
): Result<JobRecord> {
  const actor = parseActor(ctx.actor);
  let me: AgentAtWorkspace | undefined;
  if (actor?.kind === "agent") {
    me = tx.port(jobTargetsPort).creatorOf(actor.id as Id<"ses">);
    if (me === undefined) return fail("forbidden", "the session is not known");
  }
  const loaded = loadJob(tx.sql, id, machine);
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
          OR json_extract(trigger, '$.app') = ?1
          OR (json_extract(action, '$.kind') = 'tool_run' AND json_extract(action, '$.app') = ?1)
          OR (json_extract(action, '$.kind') = 'agent_run'
              AND json_extract(action, '$.agent_workspace.kind') = 'app'
              AND json_extract(action, '$.agent_workspace.id') = ?1)`,
      [app],
    )
    .map((row) => String(row["id"]));
  for (const id of ids) {
    deleteJob(tx.sql, id);
    jobsChanged(tx);
  }
}

export function createJobCommands(): {
  create: CommandDefinition<typeof jobCreate>;
  update: CommandDefinition<typeof jobUpdate>;
  approve: CommandDefinition<typeof jobApprove>;
  remove: CommandDefinition<typeof jobDelete>;
  takeOver: CommandDefinition<typeof jobTakeOver>;
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
        const machine = tx.port(jobMachinePort).id();
        if (!machine.ok) return machine;
        const at = input.at ?? null;
        // 때는 주기와 event 가운데 정확히 하나다.
        if ((input.every === undefined) === (input.trigger === undefined)) {
          return fail(
            "invalid_input",
            "give either every (a schedule) or trigger (an event), not both",
          );
        }
        let every: string | null = null;
        if (input.every !== undefined) {
          if (input.missed_policy === undefined) {
            return fail("invalid_input", "a scheduled job needs missed_policy");
          }
          const checked = checkAt(input.every, at);
          if (!checked.ok) return checked;
          every = input.every;
        } else if (at !== null) {
          return fail("invalid_input", "at is only for a scheduled job");
        }
        const action = resolveAction(tx, input.action);
        if (!action.ok) return action;
        let trigger: JobTrigger | null = null;
        if (input.trigger !== undefined) {
          const resolved = resolveTrigger(
            tx,
            input.trigger,
            action.value,
            creator,
          );
          if (!resolved.ok) return resolved;
          trigger = resolved.value;
        }
        const id = tx.newId("job");
        insertJob(tx.sql, {
          id,
          title: input.title,
          creator,
          every,
          at,
          trigger,
          action: action.value,
          // event job은 놓친 차례가 없다(저장값은 뜻이 없다).
          missed_policy: input.missed_policy ?? "run",
          enabled: input.enabled ?? true,
          machine: machine.value,
          created_at: tx.now(),
        });
        jobsChanged(tx);
        const job = loadJob(tx.sql, id, machine.value);
        return job.ok ? ok({ job: job.value! }) : job;
      },
    },
    update: {
      route: jobUpdate,
      handle(tx, ctx, input) {
        const machine = tx.port(jobMachinePort).id();
        if (!machine.ok) return machine;
        const owned = loadOwned(tx, ctx, input.job, machine.value);
        if (!owned.ok) return owned;
        const job = owned.value;
        // event job의 때(trigger)는 승인한 값이라 고치지 못한다. 주기와 시각은 주기 job의 것이다.
        if (
          job.trigger !== null &&
          (input.every !== undefined || input.at !== undefined)
        ) {
          return fail(
            "invalid_input",
            "an event job has no schedule; delete it and create a new one to change its event",
          );
        }
        const every = input.every ?? job.every;
        const at = input.at === undefined ? job.at : input.at;
        const enabled = input.enabled ?? job.enabled;
        const checked = every === null ? ok(undefined) : checkAt(every, at);
        if (!checked.ok) return checked;
        const now = tx.now();
        // 켜지는 순간이거나 주기나 시각이 바뀌면 그 순간부터 새로 센다. 놓친 것으로 치지 않는다.
        const recount =
          every !== job.every || at !== job.at || (enabled && !job.enabled);
        const scheduled = every !== null;
        replaceJob(tx.sql, job.id, {
          title: input.title ?? job.title,
          every,
          at,
          missed_policy: input.missed_policy ?? job.missed_policy,
          enabled,
          next_due_at:
            !scheduled || !enabled || job.approved_at === null
              ? null
              : recount
                ? firstDue(
                    { every, at, zone: tx.port(jobZonePort).zone() },
                    now,
                  )
                : job.next_due_at,
          updated_at: now,
        });
        jobsChanged(tx);
        const updated = loadJob(tx.sql, job.id, machine.value);
        return updated.ok ? ok({ job: updated.value! }) : updated;
      },
    },
    approve: {
      route: jobApprove,
      handle(tx, _ctx, input) {
        const machine = tx.port(jobMachinePort).id();
        if (!machine.ok) return machine;
        const loaded = loadJob(tx.sql, input.job, machine.value);
        if (!loaded.ok) return loaded;
        const job = loaded.value;
        if (job === null) return fail("not_found", "job not found");
        if (job.approved_at !== null) {
          return fail("conflict", "job is already approved");
        }
        jobsChanged(tx);
        if (input.choice === "reject") {
          deleteJob(tx.sql, job.id);
          return ok({ job: null });
        }
        // 승인한 순간부터 센다. 기다린 동안은 놓친 것으로 치지 않는다.
        const now = tx.now();
        approveJob(tx.sql, job.id, {
          approved_at: now,
          // event job은 때가 없다(next_due_at은 늘 null이고 event가 차례를 연다).
          next_due_at:
            job.enabled && job.every !== null
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
        const approved = loadJob(tx.sql, job.id, machine.value);
        return approved.ok ? ok({ job: approved.value! }) : approved;
      },
    },
    remove: {
      route: jobDelete,
      handle(tx, ctx, input) {
        const machine = tx.port(jobMachinePort).id();
        if (!machine.ok) return machine;
        const owned = loadOwned(tx, ctx, input.job, machine.value);
        if (!owned.ok) return owned;
        deleteJob(tx.sql, input.job);
        jobsChanged(tx);
        return ok({ job: input.job });
      },
    },
    // 다른 기계에서 온 job을 이 기계로 가져온다. 사람만 한다(agent가 일을 이 기계로 끌어오는 길을 열지 않는다).
    takeOver: {
      route: jobTakeOver,
      handle(tx, ctx, input) {
        if (parseActor(ctx.actor)?.kind !== "user") {
          return fail(
            "forbidden",
            "only the person moves a job to this computer",
          );
        }
        const machine = tx.port(jobMachinePort).id();
        if (!machine.ok) return machine;
        const loaded = loadJob(tx.sql, input.job, machine.value);
        if (!loaded.ok) return loaded;
        const job = loaded.value;
        if (job === null) return fail("not_found", "job not found");
        if (job.runs_here) {
          return fail("conflict", "the job already runs on this computer");
        }
        // 다른 기계에 있던 동안은 놓친 것으로 치지 않는다. approve와 같이 지금부터 센다.
        const next =
          job.enabled && job.every !== null && job.approved_at !== null
            ? firstDue(
                {
                  every: job.every,
                  at: job.at,
                  zone: tx.port(jobZonePort).zone(),
                },
                tx.now(),
              )
            : null;
        takeJob(tx.sql, job.id, machine.value, next);
        jobsChanged(tx);
        const taken = loadJob(tx.sql, job.id, machine.value);
        return taken.ok ? ok({ job: taken.value! }) : taken;
      },
    },
  };
}
