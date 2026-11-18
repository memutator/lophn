import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import {
  agentAddressSchema,
  agentIdSchema,
  workspaceOutputSchema,
} from "../lophn-agent/workspaces.ts";
import { toolNameSchema } from "../apps/channel-values.ts";
import { machineRefSchema } from "../machine/requester.ts";
import {
  stepNameSchema,
  workflowKeySchema,
  workflowNameSchema,
} from "../workflows/values.ts";

export const jobIdSchema = idSchema("job");
export const jobRunIdSchema = idSchema("jbr");

export const jobTitleSchema = z.string().min(1).max(80);

// 분(m), 시간(h), 일(d) 단위 주기다. cron 문법은 받지 않는다.
export const jobEverySchema = z.string().regex(/^[1-9][0-9]{0,4}[mhd]$/);

// every가 d 단위일 때만 쓴다. 이 컴퓨터의 local 시간대의 시각이다.
// 그 판정은 core의 command가 본다. 같은 판정을 두 곳에 두지 않으려고 schema에 refine을 두지 않는다.
export const jobAtSchema = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);

// job의 때는 주기(`every`) 아니면 event(`trigger`)다. event는 앱이 낸 것(source는 앱)이거나 core가 내는 `lophn`의 session.* event다.
// 같은 source의 같은 event를 사이를 두고 한 번만 받는다: `min_interval`(기본 5분)보다 가까운 event는 건너뛴다.
export const JOB_TRIGGER_DEFAULT_INTERVAL = "5m";
export const JOB_SKIP_REASONS = ["busy", "too_soon"] as const;
export const jobSkipReasonSchema = z.enum(JOB_SKIP_REASONS);
export type JobSkipReason = z.infer<typeof jobSkipReasonSchema>;

// route와 tool이 받는 꼴. source는 앱(id, slug, 이름 가운데 하나) 또는 `lophn`이다. 이름은 만들 때 core가 풀어 저장한다.
export const jobTriggerInputSchema = z.strictObject({
  source: z.string().min(1),
  event: z.string().min(1),
  // 다른 컴퓨터의 앱 event로 돌 때 그 컴퓨터(이름, `mch_`, `dev_`). 그때 source는 그 컴퓨터의 앱 id(`app_`)다: slug는 컴퓨터마다 달라 풀려면
  // 그 컴퓨터를 읽어야 하고 닿지 않을 수 있다. 없으면 이 컴퓨터의 앱이거나 `lophn`이다. 만들 때 core가 `mch_`로 풀어 저장한다.
  machine: machineRefSchema.optional(),
  min_interval: jobEverySchema.optional(),
  // tool_run만: 도는 tool의 입력에 `event`({source, event, payload})를 합쳐 넣는다. 사람이 승인하는 값이다.
  pass_event: z.boolean().optional(),
});
export type JobTriggerInput = z.infer<typeof jobTriggerInputSchema>;

// 저장하고 읽는 꼴. source는 `lophn`이거나 승인한 때의 앱 slug이고 app은 그 앱 id다(앱의 event는 id로 맞춘다).
export const jobTriggerSchema = z.object({
  source: z.string().min(1),
  app: idSchema("app").nullable(),
  event: z.string().min(1),
  // 다른 컴퓨터의 앱 event로 도는 job이면 그 기계. 없으면 이 기계의 앱이거나 `lophn`이다(옛 job도 이 기계의 것이다).
  source_machine: idSchema("mch").optional(),
  min_interval: jobEverySchema,
  pass_event: z.boolean(),
});
export type JobTrigger = z.infer<typeof jobTriggerSchema>;

// 차례를 연 event다. job run과 함께 남아 action에 data로 들어간다.
export const jobEventSchema = z.object({
  source: z.string().min(1),
  event: z.string().min(1),
  payload: z.json(),
  // 다른 기계에서 온 event면 그 난 기계.
  machine: idSchema("mch").optional(),
});
export type JobEvent = z.infer<typeof jobEventSchema>;

export const MISSED_POLICIES = ["run", "hold"] as const;
export const missedPolicySchema = z.enum(MISSED_POLICIES);
export type MissedPolicy = z.infer<typeof missedPolicySchema>;

export const JOB_RUN_STATES = [
  "queued",
  "running",
  "done",
  "failed",
  "cancelled",
  "held",
  "skipped",
  "interrupted",
] as const;
export const jobRunStateSchema = z.enum(JOB_RUN_STATES);
export type JobRunState = z.infer<typeof jobRunStateSchema>;

export const JOB_ACTION_KINDS = [
  "agent_run",
  "tool_run",
  "workflow_start",
] as const;
export type JobActionKind = (typeof JOB_ACTION_KINDS)[number];

// 자유 JSON 칸은 z.json()이다. jsonValueSchema는 z.custom이라 z.toJSONSchema가 던지는데,
// job tool 입력이 이 schema를 그대로 쓴다.
const outputSchemaSchema = z.record(z.string(), z.json());

// route와 tool이 받는 꼴. 이름은 만들 때 core가 풀어 저장한다.
export const jobActionInputSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("agent_run"),
    agent: agentAddressSchema,
    prompt: z.string().min(1),
    input: z.json().optional(),
    schema: outputSchemaSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("tool_run"),
    app: z.string().min(1), // app id, slug, 이름 가운데 하나
    tool: toolNameSchema,
    input: z.json().optional(),
  }),
  z.strictObject({
    kind: z.literal("workflow_start"),
    workflow: workflowKeySchema, // <project 이름>/<name>
    text: z.string().min(1),
    step: stepNameSchema.optional(),
  }),
]);
export type JobActionInput = z.infer<typeof jobActionInputSchema>;

// 저장하고 읽는 꼴. `agent`·`agent_workspace`는 만들 때 푼 부를 agent와 그 workspace다(home이면 null).
// project 이름은 바뀌므로 workflow_start는 id로 저장한다.
export const jobActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agent_run"),
    agent: agentIdSchema,
    agent_workspace: workspaceOutputSchema.nullable(),
    prompt: z.string().min(1),
    input: z.json().optional(),
    schema: outputSchemaSchema.optional(),
  }),
  z.object({
    kind: z.literal("tool_run"),
    app: idSchema("app"),
    tool: toolNameSchema,
    input: z.json().optional(),
  }),
  z.object({
    kind: z.literal("workflow_start"),
    project: idSchema("prj"),
    workflow: workflowNameSchema,
    text: z.string().min(1),
    step: stepNameSchema.optional(),
  }),
]);
export type JobAction = z.infer<typeof jobActionSchema>;
