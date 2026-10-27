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
  "`every` is `<number><m|h|d>` (minutes, hours, days; e.g. `30m`, `6h`, `1d`). `at` is a local `HH:MM` of this computer and is only for `d` units. `missed_policy` says what to do with a turn lophn missed while it was off: `run` runs it once when lophn is back on, `hold` leaves a card that asks the person.";
const ACTION_NOTE =
  "Each turn runs without a person, and `action` is one of: `agent_run` (a new session of the agent `{role, place?, name?}` with `prompt`), `tool_run` (one tool call of an app, which runs only within the allotment of the agent that created the job), `workflow_start` (starts an instance of an agent or flow workflow, named `<project name>/<name>`, with `text`; `step` picks where an agent workflow starts and is `invalid_input` for a flow).";
const OWN_NOTE = "You can change or delete only jobs you created.";
const RESTART_NOTE =
  "Changing `every` or `at`, or turning a job back on, restarts the count from now.";

export const JOB_AGENT_TOOLS: readonly ToolDefinition[] = [
  defineTool({
    name: "job.create",
    defer: true,
    input: z.strictObject({
      title: jobTitleSchema,
      every: jobEverySchema,
      at: jobAtSchema.optional(),
      action: jobActionInputSchema,
      missed_policy: missedPolicySchema,
      enabled: z.boolean().optional(),
    }),
    routes: [jobCreate],
    description: `Create a scheduled job that repeats on its own. ${SCHEDULE_NOTE} ${ACTION_NOTE} \`enabled\` defaults to true.`,
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
    defer: true,
    input: z.strictObject({
      job: jobIdSchema,
      title: jobTitleSchema.optional(),
      every: jobEverySchema.optional(),
      at: jobAtSchema.nullable().optional(),
      action: jobActionInputSchema.optional(),
      missed_policy: missedPolicySchema.optional(),
      enabled: z.boolean().optional(),
    }),
    routes: [jobUpdate],
    description: `Change a scheduled job. Omit a field to keep it; \`at: null\` clears the time of day; \`action\` replaces the whole action. ${RESTART_NOTE} ${SCHEDULE_NOTE} ${ACTION_NOTE} ${OWN_NOTE}`,
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
    defer: true,
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
    defer: true,
    input: z.strictObject({}),
    routes: [jobList],
    description:
      "List the scheduled jobs you created: title, schedule, action, whether it is on, the next due time and the last run.",
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
