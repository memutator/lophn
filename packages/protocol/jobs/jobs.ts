import { z } from "zod";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { atSchema, readCursorSchema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import {
  agentAtWorkspaceOutputSchema,
  workspaceSchema,
} from "../lophn-agent/workspaces.ts";
import {
  jobActionInputSchema,
  jobActionSchema,
  jobAtSchema,
  jobEverySchema,
  jobIdSchema,
  jobRunIdSchema,
  jobEventSchema,
  jobRunStateSchema,
  jobSkipReasonSchema,
  jobTitleSchema,
  jobTriggerInputSchema,
  jobTriggerSchema,
  missedPolicySchema,
} from "./values.ts";

// last_run은 저장하지 않고 읽을 때 그 job의 가장 새 job run으로 채운다.
// creator는 job을 만든 session의 (agent, workspace)다.
// approved_at이 null이면 사람의 등록 승인을 기다린다. 승인 전에는 돌지 않는다(next_due_at도 null).
export const jobRecordSchema = z.object({
  id: jobIdSchema,
  title: jobTitleSchema,
  creator: agentAtWorkspaceOutputSchema,
  // 때는 주기(every, at)나 event(trigger) 하나다. event job은 every가 null이고 next_due_at도 늘 null이다.
  every: jobEverySchema.nullable(),
  at: jobAtSchema.nullable(),
  trigger: jobTriggerSchema.nullable(),
  // event job의 기록: 차례를 연 수와 건너뛴 수(이유 busy | too_soon), 마지막 시각. 건너뜀은 job run 줄로 쌓지 않고 센다(event는 흔하다).
  fired_count: z.number().int().min(0),
  skipped_count: z.number().int().min(0),
  last_fired_at: atSchema.nullable(),
  last_skipped_at: atSchema.nullable(),
  last_skip_reason: jobSkipReasonSchema.nullable(),
  // event job의 앱이 지금 그 event를 내지 않는다(보관·지움, active release가 선언을 뺌). job은 켜져 있어도 돌지 않는다. `job.list`만 채운다.
  source_gone: z.boolean(),
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
  event: jobEventSchema.nullable(), // event job의 차례를 연 event
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
  changes: [{ name: "jobs", id: (_input, output) => output.job.id }],
  // 때는 `every`(주기)와 `trigger`(event) 가운데 정확히 하나다. 칸 사이 검사는 core가 본다(`at`은 주기만, event job은 missed_policy가 뜻이 없다).
  input: z.strictObject({
    title: jobTitleSchema,
    every: jobEverySchema.optional(),
    at: jobAtSchema.optional(),
    trigger: jobTriggerInputSchema.optional(),
    action: jobActionInputSchema,
    missed_policy: missedPolicySchema.optional(), // 주기 job은 필수, event job은 쓰지 않는다
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
  changes: [{ name: "jobs", id: (input) => input.job }],
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
  changes: [{ name: "jobs", id: (input) => input.job }],
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
  changes: [{ name: "jobs", id: (input) => input.job }],
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

// agent에게는 같은 agent가 같은 workspace에서 만든 job만, user에게는 모든 job을 준다. id 순 50개씩.
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
  changes: [{ name: "jobs", id: (_input, output) => output.job_run.job }],
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
  changes: ["jobs"],
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

// idle-exit가 보는 일이다. 켜진 job(승인 여부는 보지 않는다)이나 열린 job run(queued·running)이 있으면 true다.
// 첫 page나 승인 대기 여부로 판정하지 않으려고 표 전체를 EXISTS로 본다.
export const jobActivity = defineRead({
  resource: "jobs",
  method: "activity",
  name: "job.activity",
  input: z.strictObject({}),
  output: withReadCommon(z.object({ busy: z.boolean() })),
  actors: ["machine"],
  errors: [...readErrors],
});

export const jobRunStarted = defineCommand({
  resource: "job_runs",
  method: "started",
  name: "job_run.started",
  changes: [{ name: "jobs", id: (_input, output) => output.job_run.job }],
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
  changes: [{ name: "jobs", id: (_input, output) => output.job_run.job }],
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

// event가 왔다. 그 event를 때로 가진 승인한 켜진 job마다 차례를 열거나(queued) 건너뛰고 센다(busy | too_soon). 같은 tx에서 한다.
// payload는 data다. session event면 session id와 그 workspace를 싣는다(보이는 범위와 job 자신의 run 걸러내기). chain은 앱 event의 인과다.
export const jobFireEvent = defineCommand({
  resource: "jobs",
  method: "fire_event",
  name: "job.fire_event",
  changes: ["jobs"],
  input: z.strictObject({
    // 앱이 낸 event면 그 앱 id, core가 낸 event면 `lophn`.
    publisher: z.string().min(1),
    event: z.string().min(1),
    payload: z.json(),
    chain: z.array(idSchema("app")),
    // lophn의 session event만. 그 session과 그 workspace(home이면 null).
    session: z
      .strictObject({
        id: z.string().min(1),
        workspace: workspaceSchema.nullable(),
      })
      .nullable(),
  }),
  output: z.object({ fired: z.number().int(), skipped: z.number().int() }),
  compare: z.strictObject({}),
  actors: ["machine"],
  errors: ["invalid_input", "unauthorized", "forbidden"],
});

// event를 때로 가진 승인한 켜진 job의 (앱 id 또는 null=lophn, event) 목록이다. event 전달이 관심 있는지 거르는 데 쓴다.
export const jobEventTriggers = defineRead({
  resource: "jobs",
  method: "event_triggers",
  name: "job.event_triggers",
  input: z.strictObject({}),
  output: withReadCommon(
    z.object({
      triggers: z.array(
        z.object({ app: idSchema("app").nullable(), event: z.string() }),
      ),
    }),
  ),
  actors: ["machine"],
  errors: [...readErrors],
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
  jobActivity,
  jobFireEvent,
  jobEventTriggers,
] as const;
