import { z } from "zod";
import { defineCommand } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { seqSchema } from "../base/values.ts";
import { agentAddressSchema } from "../lophn-agent/workspaces.ts";
import { remoteAddressSchema } from "../lophn-agent/calls.ts";
import { mailSchema } from "../lophn-agent/mail.ts";
import { workflowInputValuesSchema } from "./inputs.ts";
import {
  participantKeySchema,
  participantSchema,
  sessionChoiceSchema,
  stepNameSchema,
  stepNextSchema,
  workflowCheckpointKindSchema,
  workflowCheckpointStateSchema,
  workflowDataSchema,
  workflowNameSchema,
  workflowOutcomeErrorSchema,
  workflowRefsSchema,
} from "./values.ts";
import {
  handResultSchema,
  instanceStepSchema,
  lineBySchema,
  notHandedReasonSchema,
  startedBySchema,
  workflowCheckpointSchema,
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
    cause: z.enum(["start", "report", "edit", "retry"]),
    session: sessionChoiceSchema.nullable(),
    // 이 컴퓨터의 받는 곳(to)이거나, 다른 컴퓨터의 받는 곳(remote: 명단의 그 컴퓨터와 기계를 건너는 주소)이다.
    delivery: z
      .union([
        z.strictObject({ to: deliveryToSchema, body: z.string() }),
        z.strictObject({
          remote: z.strictObject({
            machine: idSchema("mch"),
            computer: z.string().min(1),
            address: remoteAddressSchema,
          }),
          body: z.string(),
        }),
      ])
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
    inputs: workflowInputValuesSchema.optional(),
    participants: z.record(participantKeySchema, participantSchema),
    steps: z.array(instanceStepSchema),
    started_by: startedBySchema,
    code_snapshot: z.string().min(1).nullable().optional(),
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
    refs: workflowRefsSchema.optional(),
    data: workflowDataSchema.optional(),
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
  // 명시적 완료(report) 없이 turn이 끝났고 열린 call도 없을 때 wf-service가 by lophn으로 부른다.
  z.strictObject({
    kind: z.literal("step_stalled"),
    step: z.string(),
    session: idSchema("ses").nullable(),
    reason: z.string().min(1).optional(),
    message: z.string().min(1).optional(),
  }),
  // 사람의 [Retry]: 기록된 같은 session에 이어서 하라는 입력(body)을 넣거나, session이 열리기 전(not_handed)이면 handoff로 다시 넘긴다.
  z.strictObject({
    kind: z.literal("retried"),
    step: z.string(),
    session: idSchema("ses").nullable(),
    body: z.string().min(1).optional(),
  }),
  // 사람의 [Resume with updated code]: 최신 flow code snapshot으로 갱신하고 code_updated 줄을 남긴다.
  z.strictObject({
    kind: z.literal("code_updated"),
    code_snapshot: z.string().min(1),
  }),
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
    // 다른 컴퓨터의 참가자가 낸 report가 실려 온 reply mail. 같은 tx에서 본 것으로 적는다(한 번만 적용한다).
    mail: z
      .strictObject({
        mail: mailSchema,
        origin: z.strictObject({
          machine: idSchema("mch"),
          computer: z.string().min(1),
        }),
      })
      .optional(),
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

// durable 실행의 2단계 checkpoint(started -> completed | failed | interrupted)를 쓴다.
export const workflowCheckpointUpsert = defineCommand({
  resource: "workflow_checkpoints",
  method: "upsert",
  name: "UpsertWorkflowCheckpoint",
  changes: [{ name: "workflow_instances", id: (input) => input.instance }],
  input: z.strictObject({
    instance: idSchema("wfi"),
    key: z.string().min(1),
    kind: workflowCheckpointKindSchema,
    state: workflowCheckpointStateSchema,
    handle_ref: z.string().nullable().optional(),
    output: z.unknown().nullable().optional(),
    error: workflowOutcomeErrorSchema.nullable().optional(),
  }),
  output: z.object({
    checkpoint: workflowCheckpointSchema,
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

export const WORKFLOW_COMMAND_ROUTES = [
  workflowInstanceCreate,
  workflowInstanceApply,
  workflowCheckpointUpsert,
] as const;
