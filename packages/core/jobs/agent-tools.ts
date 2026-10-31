import { z } from "zod";
import { ok } from "../../base/mod.ts";
import {
  jobActionInputSchema,
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
import {
  commandOf,
  countSummary,
  defineTool,
  fitted,
  readOf,
  type ToolDefinition,
} from "../lophn-agent/tools/spi.ts";

const SCHEDULE_NOTE =
  "every uses m/h/d (minutes/hours/days); at is this computer's local HH:MM, only for d. After downtime, missed_policy run runs once; hold asks the person.";
const ACTION_NOTE =
  "Runs unattended. agent_run opens a new session (agent/place use exact names; no place means home). tool_run calls one app tool. workflow_start names <project>/<workflow>; step is only for agent workflows, not flows.";
const APPROVAL_NOTE =
  "A new job waits until the person approves it in the waiting list (approved_at stays null until then); tell them. The action cannot be changed later: delete the job and create a new one.";
const OWN_NOTE =
  "You can change or delete only jobs you created in this place.";
const RESTART_NOTE =
  "Changing `every` or `at`, or turning a job back on, restarts the count from now.";

export const JOB_AGENT_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "job.create",
    input: z.strictObject({
      title: jobTitleSchema,
      every: jobEverySchema,
      at: jobAtSchema.optional(),
      action: jobActionInputSchema,
      missed_policy: missedPolicySchema,
      enabled: z.boolean().optional(),
    }),
    routes: [jobCreate],
    description: `Create a repeating job; enabled defaults to true. ${APPROVAL_NOTE} ${SCHEDULE_NOTE} ${ACTION_NOTE}`,
    effect: "write",
    handler: async (input, ctx) => {
      const made = await commandOf(
        ctx.core,
        jobCreate,
        input,
        {},
        ctx.tool_call,
      );
      if (!made.ok) return made;
      return ok(fitted(`created job ${input.title}`, made.value));
    },
  }),
  defineTool({
    name: "job.update",
    input: z.strictObject({
      job: jobIdSchema,
      title: jobTitleSchema.optional(),
      every: jobEverySchema.optional(),
      at: jobAtSchema.nullable().optional(),
      missed_policy: missedPolicySchema.optional(),
      enabled: z.boolean().optional(),
    }),
    routes: [jobUpdate],
    description: `Update a job's title, schedule, missed policy or on/off. Omitted fields stay; at:null clears the time. The action cannot be changed. ${RESTART_NOTE} ${SCHEDULE_NOTE} ${OWN_NOTE}`,
    effect: "write",
    handler: async (input, ctx) => {
      const body = Object.fromEntries(
        Object.entries(input).filter(([, v]) => v !== undefined),
      );
      const done = await commandOf(
        ctx.core,
        jobUpdate,
        body,
        {},
        ctx.tool_call,
      );
      if (!done.ok) return done;
      return ok(fitted(`updated job ${done.value.job.title}`, done.value));
    },
  }),
  defineTool({
    name: "job.delete",
    input: z.strictObject({ job: jobIdSchema }),
    routes: [jobDelete],
    description: `Delete a scheduled job and its history; a run or workflow instance already running goes on. ${OWN_NOTE}`,
    effect: "write",
    handler: async (input, ctx) => {
      const done = await commandOf(
        ctx.core,
        jobDelete,
        input,
        {},
        ctx.tool_call,
      );
      if (!done.ok) return done;
      return ok(fitted(`deleted job ${done.value.job}`, done.value));
    },
  }),
  defineTool({
    name: "job.list",
    input: z.strictObject({}),
    routes: [jobList],
    description:
      "List the scheduled jobs you created in this place: title, schedule, action, whether it is on, the next due time and the last run.",
    effect: "read",
    handler: async (_input, ctx) => {
      let cursor: string | undefined;
      let jobs: z.output<typeof jobList.output>["jobs"] = [];
      for (;;) {
        const read = await readOf(
          ctx.core,
          jobList,
          cursor === undefined ? {} : { cursor },
        );
        if (!read.ok) return read;
        jobs = [...jobs, ...read.value.jobs];
        if (read.value.next_cursor === null) break;
        cursor = read.value.next_cursor;
      }
      return ok(
        fitted(countSummary("jobs", jobs.length, false), { jobs }, ["jobs"]),
      );
    },
  }),
];
