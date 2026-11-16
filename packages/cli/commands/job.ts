// `lophn job create|update|delete|list`: 반복 job을 만들고 고치고 지우고 읽는다.
// "내가 만든 job만" 같은 범위는 core route가 credential을 보고 정한다. 여기서는 route를 부르기만 한다.
import { z } from "zod";
import { ok } from "../../base/mod.ts";
import {
  jobActionInputSchema,
  jobTriggerInputSchema,
  jobAtSchema,
  jobCreate,
  jobDelete,
  jobEverySchema,
  jobIdSchema,
  jobList,
  jobTitleSchema,
  jobUpdate,
  missedPolicySchema,
} from "../../protocol/jobs/mod.ts";
import { WORKSPACE_KINDS } from "../../protocol/lophn-agent/workspaces.ts";
import { defineCommand } from "./types.ts";

const SCHEDULE_NOTE =
  "every uses m/h/d (minutes/hours/days); at is this computer's local HH:MM, only for d. After downtime, missed_policy run runs once; hold asks the person.";
const TRIGGER_NOTE =
  "Instead of every, trigger {source, event} runs the job when an event happens: source is an app (its slug, and the active release must declare the event) or lophn (session.started, session.running, session.waiting, session.idle, session.ended; session events are only for sessions this workspace may call). At most one run starts per min_interval (default 5m); an event that arrives while the previous run is still going, or too soon, is skipped and counted (see skipped_count in job list). The event is handed to the action as data: for agent_run it is attached to your prompt as a data block, for workflow_start the start text becomes JSON {text, event}, for tool_run it is added to the tool input as `event` only if you set trigger.pass_event. Events are not stored: nothing fires while lophn is off. A job started by an event does not fire again for the sessions it opens itself.";
const ACTION_NOTE =
  "Runs unattended. agent_run opens a new session (agent/workspace use exact names; no workspace means home). tool_run calls one app tool. workflow_start names <project>/<workflow>; step is only for agent workflows, not flows.";
const APPROVAL_NOTE =
  "A new job waits until the person approves it in the waiting list (approved_at stays null until then); tell them. The action cannot be changed later: delete the job and create a new one.";
const OWN_NOTE =
  "You can change or delete only jobs you created in this workspace.";
const RESTART_NOTE =
  "Changing `every` or `at`, or turning a job back on, restarts the count from now.";

const create = defineCommand({
  name: "job.create",
  summary: "Create a repeating job, or one that runs when an event happens",
  description: `Create a job that runs on a schedule (every) or when an event happens (trigger); give exactly one of them. enabled defaults to true. ${APPROVAL_NOTE} ${SCHEDULE_NOTE} ${TRIGGER_NOTE} ${ACTION_NOTE}`,
  input: z.strictObject({
    title: jobTitleSchema,
    every: jobEverySchema.optional(),
    at: jobAtSchema.optional(),
    trigger: jobTriggerInputSchema.optional(),
    action: jobActionInputSchema,
    missed_policy: missedPolicySchema.optional(),
    enabled: z.boolean().optional(),
  }),
  positional: ["title"],
  effect: "write",
  routes: [jobCreate],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const made = await ctx.core.command(jobCreate, input, { key: ctx.key });
    if (!made.ok) return made;
    return ok({ summary: `created job ${input.title}`, content: made.value });
  },
});

const update = defineCommand({
  name: "job.update",
  summary: "Change a job's title, schedule or on/off",
  description: `Update a job's title, schedule, missed policy or on/off. Omitted fields stay; at:null clears the time (--input '{"at":null}'). The action cannot be changed, and neither can the event of an event job (delete it and create a new one). ${RESTART_NOTE} ${SCHEDULE_NOTE} ${OWN_NOTE}`,
  input: z.strictObject({
    job: jobIdSchema,
    title: jobTitleSchema.optional(),
    every: jobEverySchema.optional(),
    at: jobAtSchema.nullable().optional(),
    missed_policy: missedPolicySchema.optional(),
    enabled: z.boolean().optional(),
  }),
  positional: ["job"],
  effect: "write",
  routes: [jobUpdate],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const done = await ctx.core.command(jobUpdate, input, { key: ctx.key });
    if (!done.ok) return done;
    return ok({
      summary: `updated job ${done.value.job.title}`,
      content: done.value,
    });
  },
});

const remove = defineCommand({
  name: "job.delete",
  summary: "Delete a job and its history",
  description: `Delete a scheduled job and its history; a run or workflow instance already running goes on. ${OWN_NOTE}`,
  input: z.strictObject({ job: jobIdSchema }),
  positional: ["job"],
  effect: "write",
  routes: [jobDelete],
  workspaces: WORKSPACE_KINDS,
  run: async (input, ctx) => {
    const done = await ctx.core.command(jobDelete, input, { key: ctx.key });
    if (!done.ok) return done;
    return ok({
      summary: `deleted job ${done.value.job}`,
      content: done.value,
    });
  },
});

const list = defineCommand({
  name: "job.list",
  summary: "List the jobs you created in this workspace",
  description:
    "List the jobs you created in this workspace: title, schedule or event trigger, action, whether it is on, the next due time (scheduled jobs), fired_count and skipped_count (event jobs) and the last run. runs_here false means the job was created on another computer and does not run here; only the person can move it to this computer.",
  input: z.strictObject({}),
  effect: "read",
  routes: [jobList],
  workspaces: WORKSPACE_KINDS,
  run: async (_input, ctx) => {
    let cursor: string | undefined;
    let jobs: z.output<typeof jobList.output>["jobs"] = [];
    for (;;) {
      const read = await ctx.core.read(
        jobList,
        cursor === undefined ? {} : { cursor },
      );
      if (!read.ok) return read;
      jobs = [...jobs, ...read.value.jobs];
      if (read.value.next_cursor === null) break;
      cursor = read.value.next_cursor;
    }
    return ok({
      summary: `${jobs.length} jobs`,
      content: { jobs },
      arrayKeys: ["jobs"],
    });
  },
});

export const JOB_COMMANDS = [create, update, remove, list];
