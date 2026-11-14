import { z } from "zod";
import { defineCommand } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { seqSchema } from "../base/values.ts";
import { agentAddressSchema } from "../lophn-agent/workspaces.ts";
import {
  participantKeySchema,
  participantSchema,
  sessionChoiceSchema,
  stepNameSchema,
  stepNextSchema,
  workflowNameSchema,
} from "./values.ts";
import {
  handResultSchema,
  instanceStepSchema,
  lineBySchema,
  notHandedReasonSchema,
  startedBySchema,
  workflowEditSchema,
  workflowInstanceSchema,
} from "./instances.ts";

// 받는 곳. CallAddressInput에 대입된다(맨 `{session}` 꼴은 plan이 만들지 않는다).
const deliveryToSchema = z.union([
  agentAddressSchema,
  agentAddressSchema.extend({
    session: idSchema("ses"),
    fallback: z.literal("new"),
  }),
]);

// step 메시지 본문은 blob이라 tx 안에서 만들 수 없다. 본문과 받는 곳은 command 앞(wf-service)이 정하고
// command는 그대로 Router에 넣는다. delivery와 unresolved는 정확히 하나가 있다.
export const handoffPlanSchema = z
  .strictObject({
    step: z.string(),
    participant: participantKeySchema.nullable(),
    human_turn: z.boolean(),
    cause: z.enum(["start", "report", "edit"]),
    session: sessionChoiceSchema.nullable(),
    delivery: z
      .strictObject({
        to: deliveryToSchema,
        body: z.string(),
      })
      .nullable(),
    unresolved: z
      .strictObject({
        reason: notHandedReasonSchema,
        message: z.string(),
      })
      .nullable(),
  })
  .refine((v) => (v.delivery === null) !== (v.unresolved === null), {
    message: "exactly one of delivery and unresolved",
  });
export type HandoffPlan = z.infer<typeof handoffPlanSchema>;

// 같은 tx에서 상태를 바꾸고, 줄을 남기고, delivery가 있으면 Router로 넣고, 결과를 handed나 not_handed 줄로 남긴다.
// Router가 err를 돌려주면 tx 전체가 되돌아가고 그 오류를 그대로 돌려준다.
export const workflowInstanceCreate = defineCommand({
  resource: "workflow_instances",
  method: "create",
  name: "CreateWorkflowInstance",
  changes: [{ name: "workflow_instances", id: (input) => input.id }],
  input: z.strictObject({
    id: idSchema("wfi"),
    project: idSchema("prj"),
    workflow: workflowNameSchema,
    input: z.string(),
    participants: z.record(participantKeySchema, participantSchema),
    steps: z.array(instanceStepSchema),
    started_by: startedBySchema,
    handoff: handoffPlanSchema.nullable(), // null이면 flow다. 넘기지 않는다
  }),
  output: z.object({
    instance: workflowInstanceSchema,
    handed: handResultSchema.nullable(),
  }),
  actors: ["machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

const changeSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("report"),
    step: stepNameSchema,
    text: z.string().min(1),
    next: stepNextSchema.nullable(),
    session: sessionChoiceSchema,
  }),
  z.strictObject({ kind: z.literal("edit"), edit: workflowEditSchema }),
  z.strictObject({ kind: z.literal("stop") }),
  // 켤 때 wf-service가 by lophn, handoff null로 부른다.
  z.strictObject({
    kind: z.literal("lophn_restarted"),
    step: z.string(),
    receiver: idSchema("ses"),
  }),
  // flow process가 끝나면 wf-service가 by lophn으로 부른다. 줄을 남기고 running이면 ended로 닫는다.
  z.strictObject({
    kind: z.literal("program_exited"),
    code: z.number().int().nullable(),
    stderr_tail: z.string(),
  }),
  // 켤 때 running인 flow instance마다 wf-service가 by lophn으로 부른다(process는 다시 띄우지 않는다).
  // lophn_restarted 줄(step null, receiver null)을 남기고 running이면 ended로 닫는다.
  z.strictObject({ kind: z.literal("flow_restarted") }),
]);

export const workflowInstanceApply = defineCommand({
  resource: "workflow_instances",
  method: "apply",
  name: "ApplyWorkflowChange",
  changes: [{ name: "workflow_instances", id: (input) => input.instance }],
  input: z.strictObject({
    instance: idSchema("wfi"),
    change: changeSchema,
    by: lineBySchema,
    handoff: handoffPlanSchema.nullable(),
  }),
  output: z.object({
    instance: workflowInstanceSchema,
    line: seqSchema,
    handed: handResultSchema.nullable(),
  }),
  compare: z.strictObject({ state_seq: seqSchema }),
  actors: ["machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

export const WORKFLOW_COMMAND_ROUTES = [
  workflowInstanceCreate,
  workflowInstanceApply,
] as const;
