import { z } from "zod";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema, readCursorSchema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import { agentAtPlaceOutputSchema } from "../lophn-agent/places.ts";
import {
  jobActionInputSchema,
  jobActionSchema,
  jobAtSchema,
  jobEverySchema,
  jobIdSchema,
  jobRunIdSchema,
  jobRunStateSchema,
  jobTitleSchema,
  missedPolicySchema,
} from "./values.ts";

// last_run은 저장하지 않고 읽을 때 그 job의 가장 새 job run으로 채운다.
// creator는 job을 만든 session의 (agent, place)다.
// approved_at이 null이면 사람의 등록 승인을 기다린다. 승인 전에는 돌지 않는다(next_due_at도 null).
export const jobRecordSchema = z.object({
  id: jobIdSchema,
  title: jobTitleSchema,
  creator: agentAtPlaceOutputSchema,
  every: jobEverySchema,
  at: jobAtSchema.nullable(),
  action: jobActionSchema,
  missed_policy: missedPolicySchema,
  enabled: z.boolean(),
  approved_at: atSchema.nullable(),
  next_due_at: atSchema.nullable(), // 꺼져 있거나 승인 전이면 null
  last_run: z
    .object({
      job_run: jobRunIdSchema,
      state: jobRunStateSchema,
      due_at: atSchema,
      started_at: atSchema.nullable(),
      ended_at: atSchema.nullable(),
    })
    .nullable(),
  created_at: atSchema,
  updated_at: atSchema,
});
export type JobRecord = z.infer<typeof jobRecordSchema>;

// due_at은 이 줄이 답하는 차례(놓친 것이 여럿이면 마지막 차례), missed_count는 이 줄이 대신해 접은
// 놓친 차례 수다(제때 온 차례는 0).
// reason: skipped는 person | overlap | superseded, 시작하지 못한 failed는 `<code>: <message>`, 그 밖은 null.
export const jobRunRecordSchema = z.object({
  id: jobRunIdSchema,
  job: jobIdSchema,
  due_at: atSchema,
  missed_count: z.number().int().min(0),
  state: jobRunStateSchema,
  reason: z.string().nullable(),
  run: idSchema("run").nullable(), // agent_run·tool_run이 연 run
  instance: idSchema("wfi").nullable(), // workflow_start가 시작한 instance
  session: idSchema("ses").nullable(), // agent_run이 연 session
  started_at: atSchema.nullable(),
  ended_at: atSchema.nullable(),
  created_at: atSchema,
});
export type JobRunRecord = z.infer<typeof jobRunRecordSchema>;

// hold card 한 장, scheduler가 받는 시작할 줄, 도는 줄이 모두 이 꼴이다.
export const jobTurnSchema = z.object({
  job: jobRecordSchema,
  job_run: jobRunRecordSchema,
});
export type JobTurn = z.infer<typeof jobTurnSchema>;
export type JobHold = JobTurn;
export type QueuedJobRun = JobTurn;
export type OpenJobRun = JobTurn;

const jobRef = { job: jobIdSchema };
const jobRunRef = { job_run: jobRunIdSchema };

// revision과 compare를 두지 않는다. 동시에 고치는 쪽이 사람 화면과 agent 정도라 마지막 쓰기가 이긴다.
// 칸 사이 검사(at은 every가 d 단위일 때만)와 이름 풀기는 core가 본다.
// 사람은 job을 만들지 못한다. 만든 job은 사람이 승인(job.approve)해야 돈다.
export const jobCreate = defineCommand({
  resource: "jobs",
  method: "create",
  name: "job.create",
  input: z.strictObject({
    title: jobTitleSchema,
    every: jobEverySchema,
    at: jobAtSchema.optional(),
    action: jobActionInputSchema,
    missed_policy: missedPolicySchema,
    enabled: z.boolean().optional(), // 기본 true
  }),
  output: z.object({ job: jobRecordSchema }),
  compare: z.strictObject({}),
  actors: ["agent"],
  errors: [
    "invalid_input",
    "not_found",
    "forbidden",
    "unauthorized",
    "conflict",
  ],
});

export const jobUpdate = defineCommand({
  resource: "jobs",
  method: "update",
  name: "job.update",
  input: z.strictObject({
    ...jobRef,
    title: jobTitleSchema.optional(),
    every: jobEverySchema.optional(),
    at: jobAtSchema.nullable().optional(),
    missed_policy: missedPolicySchema.optional(),
    enabled: z.boolean().optional(),
  }),
  output: z.object({ job: jobRecordSchema }),
  compare: z.strictObject({}),
  actors: ["agent", "user"],
  errors: [
    "invalid_input",
    "not_found",
    "forbidden",
    "unauthorized",
    "conflict",
  ],
});

// 할 일(action)은 고치지 못한다. 사람이 승인한 할 일이 그대로 돌게 하려는 것이다. 다른 일은 새 job으로 만든다.

// 사람이 job 등록을 한 번 승인한다. reject는 job을 지운다(output job은 null).
export const jobApprove = defineCommand({
  resource: "jobs",
  method: "approve",
  name: "job.approve",
  input: z.strictObject({ ...jobRef, choice: z.enum(["approve", "reject"]) }),
  output: z.object({ job: jobRecordSchema.nullable() }),
  compare: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "not_found", "unauthorized", "conflict"],
});

export const jobDelete = defineCommand({
  resource: "jobs",
  method: "delete",
  name: "job.delete",
  input: z.strictObject(jobRef),
  output: z.object({ job: jobIdSchema }),
  compare: z.strictObject({}),
  actors: ["agent", "user"],
  errors: ["invalid_input", "not_found", "forbidden", "unauthorized"],
});

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// agent에게는 같은 agent가 같은 place에서 만든 job만, user에게는 모든 job을 준다. id 순 50개씩.
export const jobList = defineRead({
  resource: "jobs",
  method: "list",
  name: "job.list",
  input: z.strictObject({ cursor: readCursorSchema.optional() }),
  output: withReadCommon(z.object({ jobs: z.array(jobRecordSchema) })),
  actors: ["agent", "user"],
  errors: [...readErrors],
});

// 새것이 앞이고 50개씩이다.
export const jobRunList = defineRead({
  resource: "job_runs",
  method: "list",
  name: "job_run.list",
  input: z.strictObject({ ...jobRef, cursor: readCursorSchema.optional() }),
  output: withReadCommon(z.object({ job_runs: z.array(jobRunRecordSchema) })),
  actors: ["user"],
  errors: [...readErrors],
});

export const jobHolds = defineRead({
  resource: "jobs",
  method: "holds",
  name: "job.holds",
  input: z.strictObject({}),
  output: withReadCommon(z.object({ holds: z.array(jobTurnSchema) })),
  actors: ["user"],
  errors: [...readErrors],
});

// 승인을 기다리는 job. 오래된 것이 앞이고 쪽을 나누지 않는다.
export const jobPending = defineRead({
  resource: "jobs",
  method: "pending",
  name: "job.pending",
  input: z.strictObject({}),
  output: withReadCommon(z.object({ jobs: z.array(jobRecordSchema) })),
  actors: ["user"],
  errors: [...readErrors],
});

export const jobDecideHold = defineCommand({
  resource: "jobs",
  method: "decide_hold",
  name: "job.decide_hold",
  input: z.strictObject({
    ...jobRunRef,
    choice: z.enum(["run_now", "skip"]),
  }),
  output: z.object({ job_run: jobRunRecordSchema }),
  compare: z.strictObject({}),
  actors: ["user"],
  errors: ["invalid_input", "not_found", "unauthorized", "conflict"],
});

// scheduler가 지난 차례를 job run 줄로 만들고 시작할 줄을 가져간다. startup이면 꺼져 있던 동안의 차례도 접는다.
export const jobClaimDue = defineCommand({
  resource: "jobs",
  method: "claim_due",
  name: "job.claim_due",
  input: z.strictObject({ startup: z.boolean() }),
  output: z.object({
    start: z.array(jobTurnSchema),
    next_due_at: atSchema.nullable(),
  }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["invalid_input", "unauthorized", "forbidden"],
});

export const jobRunOpen = defineRead({
  resource: "job_runs",
  method: "open",
  name: "job_run.open",
  input: z.strictObject({}),
  output: withReadCommon(z.object({ open: z.array(jobTurnSchema) })),
  actors: ["machine"],
  errors: [...readErrors],
});

export const jobRunStarted = defineCommand({
  resource: "job_runs",
  method: "started",
  name: "job_run.started",
  input: z.strictObject({
    ...jobRunRef,
    run: idSchema("run").nullable(),
    instance: idSchema("wfi").nullable(),
    session: idSchema("ses").nullable(),
  }),
  output: z.object({ job_run: jobRunRecordSchema }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
  ],
});

export const jobRunEnded = defineCommand({
  resource: "job_runs",
  method: "ended",
  name: "job_run.ended",
  input: z.strictObject({
    ...jobRunRef,
    state: z.enum(["done", "failed", "cancelled"]),
    reason: z.string().optional(),
  }),
  output: z.object({ job_run: jobRunRecordSchema }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
  ],
});

export const JOB_ROUTES = [
  jobCreate,
  jobUpdate,
  jobApprove,
  jobDelete,
  jobList,
  jobRunList,
  jobPending,
  jobHolds,
  jobDecideHold,
  jobClaimDue,
  jobRunOpen,
  jobRunStarted,
  jobRunEnded,
] as const;
