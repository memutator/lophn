import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import {
  agentRefOutputSchema,
  placeOutputSchema,
} from "../lophn-agent/places.ts";
import { namedAgentSchema } from "../lophn-agent/calls.ts";
import { toolNameSchema } from "../apps/channel-values.ts";
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
    agent: namedAgentSchema,
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

// 저장하고 읽는 꼴. agent_place는 부를 agent의 place다(lophn은 null, Operator는 정의의 place).
// project 이름은 바뀌므로 workflow_start는 id로 저장한다.
export const jobActionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("agent_run"),
    agent: agentRefOutputSchema,
    agent_place: placeOutputSchema.nullable(),
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
