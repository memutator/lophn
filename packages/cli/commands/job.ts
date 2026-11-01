// `lophn job create|update|delete|list`: 반복 job을 만들고 고치고 지우고 읽는다.
// "내가 만든 job만" 같은 범위는 core route가 credential을 보고 정한다. 여기서는 route를 부르기만 한다.
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
import { PLACE_KINDS } from "../../protocol/lophn-agent/places.ts";
import { defineCommand } from "./types.ts";

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

const create = defineCommand({
  name: "job.create",
  summary: "Create a repeating job",
  description: `Create a repeating job; enabled defaults to true. ${APPROVAL_NOTE} ${SCHEDULE_NOTE} ${ACTION_NOTE}`,
  input: z.strictObject({
    title: jobTitleSchema,
    every: jobEverySchema,
    at: jobAtSchema.optional(),
    action: jobActionInputSchema,
    missed_policy: missedPolicySchema,
    enabled: z.boolean().optional(),
  }),
  positional: ["title"],
  effect: "write",
  routes: [jobCreate],
  places: PLACE_KINDS,
  run: async (input, ctx) => {
    const made = await ctx.core.command(jobCreate, input, { key: ctx.key });
    if (!made.ok) return made;
    return ok({ summary: `created job ${input.title}`, content: made.value });
  },
});

const update = defineCommand({
  name: "job.update",
  summary: "Change a job's title, schedule or on/off",
  description: `Update a job's title, schedule, missed policy or on/off. Omitted fields stay; at:null clears the time (--input '{"at":null}'). The action cannot be changed. ${RESTART_NOTE} ${SCHEDULE_NOTE} ${OWN_NOTE}`,
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
  places: PLACE_KINDS,
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
  places: PLACE_KINDS,
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
  summary: "List the jobs you created in this place",
  description:
    "List the scheduled jobs you created in this place: title, schedule, action, whether it is on, the next due time and the last run.",
  input: z.strictObject({}),
  effect: "read",
  routes: [jobList],
  places: PLACE_KINDS,
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
