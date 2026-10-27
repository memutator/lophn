import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { atSchema, seqSchema } from "../base/values.ts";
import {
  participantKeySchema,
  participantSchema,
  sessionChoiceSchema,
  stepNameSchema,
  stepNextSchema,
  workflowNameSchema,
  workflowStateSchema,
  workflowTextSchema,
} from "./values.ts";

export const lineBySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("user") }),
  z.strictObject({ kind: z.literal("agent"), session: idSchema("ses") }),
  z.strictObject({ kind: z.literal("lophn") }),
  z.strictObject({ kind: z.literal("program") }),
]);
export type LineBy = z.infer<typeof lineBySchema>;

const userBy = z.strictObject({ kind: z.literal("user") });
const lophnBy = z.strictObject({ kind: z.literal("lophn") });

// 시작한 쪽: 사람(StartWorkflow) 또는 job
export const startedBySchema = z.discriminatedUnion("kind", [
  userBy,
  z.strictObject({ kind: z.literal("job"), job: idSchema("job") }),
]);
export type StartedBy = z.infer<typeof startedBySchema>;

// in·out은 없으면 "", next 안은 stepName 또는 "end"다.
export const instanceStepSchema = z.strictObject({
  name: stepNameSchema,
  by: participantKeySchema,
  with: participantKeySchema.nullable(),
  prompt: z.string(),
  in: z.string(),
  out: z.string(),
  next: z.array(stepNextSchema),
});
export type InstanceStep = z.infer<typeof instanceStepSchema>;

const currentSchema = z
  .object({
    step: stepNameSchema,
    human_turn: z.boolean(),
  })
  .nullable();

export const workflowInstanceSchema = z
  .object({
    id: idSchema("wfi"),
    project: idSchema("prj"),
    workflow: workflowNameSchema,
    input: z.string(),
    state: workflowStateSchema,
    participants: z.record(participantKeySchema, participantSchema), // 시작할 때 선언에서 옮긴 것
    steps: z.array(instanceStepSchema), // 순서 있음. agent가 고친다
    current: currentSchema,
    started_by: startedBySchema,
    created_at: atSchema,
    finished_at: atSchema.nullable(),
    state_seq: seqSchema,
  })
  .refine((v) => (v.finished_at !== null) === (v.state !== "running"), {
    message: "only finished instances have finished_at",
  });
export type WorkflowInstance = z.infer<typeof workflowInstanceSchema>;

export const NOT_HANDED_REASONS = [
  "unknown_step",
  "unknown_participant",
  "harness",
  "no_with",
  "unresolved",
] as const;
export const notHandedReasonSchema = z.enum(NOT_HANDED_REASONS);
export type NotHandedReason = z.infer<typeof notHandedReasonSchema>;

export const handResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    step: z.string(),
    outcome: z.literal("handed"),
    receiver: idSchema("ses"),
    human_turn: z.boolean(),
  }),
  z.object({
    step: z.string(),
    outcome: z.literal("not_handed"),
    reason: notHandedReasonSchema,
    message: z.string(),
  }),
]);
export type HandResult = z.infer<typeof handResultSchema>;

// step 더하기와 고치기 입력의 step. 없는 칸은 service가 채운다.
const newStepSchema = z.strictObject({
  name: stepNameSchema,
  by: participantKeySchema,
  with: participantKeySchema.optional(),
  prompt: z.string(),
  in: z.string().optional(),
  out: z.string().optional(),
  next: z.array(stepNextSchema).optional(),
});

const stepPatchSchema = z.strictObject({
  by: participantKeySchema.optional(),
  with: participantKeySchema.nullable().optional(),
  prompt: z.string().optional(),
  in: z.string().optional(),
  out: z.string().optional(),
  next: z.array(stepNextSchema).optional(),
});

// 이름이 겹치는 add는 conflict, 없는 name의 update·remove는 not_found다. 가리키는 이름이 있는지는 보지 않는다.
// edit 줄의 detail, EditWorkflow 입력, ApplyWorkflowChange가 이 모양을 같이 쓴다.
const addStep = z.strictObject({
  op: z.literal("add_step"),
  step: newStepSchema,
  after: stepNameSchema.optional(),
});
const updateStep = z.strictObject({
  op: z.literal("update_step"),
  name: stepNameSchema,
  patch: stepPatchSchema,
});
const removeStep = z.strictObject({
  op: z.literal("remove_step"),
  name: stepNameSchema,
});
const endEdit = z.strictObject({ op: z.literal("end") });
const handNow = z.strictObject({
  op: z.literal("hand_now"),
  step: stepNameSchema,
  text: workflowTextSchema.optional(),
  session: sessionChoiceSchema.optional(),
});

export const workflowEditSchema = z.discriminatedUnion("op", [
  addStep,
  updateStep,
  removeStep,
  endEdit,
  handNow,
]);
export type WorkflowEdit = z.infer<typeof workflowEditSchema>;

// EditWorkflow 입력: 위 합의 variant마다 instance를 더했다.
const instanceRef = { instance: idSchema("wfi") };
export const workflowEditInputSchema = z.discriminatedUnion("op", [
  addStep.extend(instanceRef),
  updateStep.extend(instanceRef),
  removeStep.extend(instanceRef),
  endEdit.extend(instanceRef),
  handNow.extend(instanceRef),
]);

function line<K extends string, S extends z.ZodRawShape, B extends z.ZodType>(
  kind: K,
  by: B,
  shape: S,
) {
  return z.object({
    instance: idSchema("wfi"),
    seq: seqSchema, // instance 안에서 1부터 이어 센다
    at: atSchema,
    by,
    kind: z.literal(kind),
    ...shape,
  });
}

export const reportLineSchema = line("report", lineBySchema, {
  step: stepNameSchema,
  text: z.string(),
  next: stepNextSchema.nullable(),
  session: sessionChoiceSchema,
});
export type ReportLine = z.infer<typeof reportLineSchema>;

export const workflowLineSchema = z.discriminatedUnion("kind", [
  line("started", startedBySchema, {
    step: stepNameSchema.nullable(), // flow는 step이 없다
    text: z.string(),
  }),
  reportLineSchema,
  line("edit", lineBySchema, {
    op: z.enum(["add_step", "update_step", "remove_step", "end", "hand_now"]),
    step: z.string().nullable(),
    detail: z.json(), // 고친 입력 그대로
  }),
  line("handed", lophnBy, {
    step: z.string(),
    // 메시지를 받은 agent의 참가자 key. 사람 step이면 with의 key
    participant: participantKeySchema,
    receiver: idSchema("ses"),
    human_turn: z.boolean(),
    cause: z.enum(["start", "report", "edit"]),
    session: sessionChoiceSchema.nullable(),
  }),
  line("not_handed", lophnBy, {
    step: z.string(),
    reason: notHandedReasonSchema,
    message: z.string(),
  }),
  line("ended", lophnBy, {}),
  line("stopped", userBy, {}),
  // 켤 때 넘긴 step 메시지가 turn에 가져가지 않았거나 restart로 끊긴 것을 남긴다. 상태와 current는 바꾸지 않는다.
  // flow instance는 넘긴 곳이 없어 step과 receiver가 null이다.
  line("lophn_restarted", lophnBy, {
    step: z.string().nullable(),
    receiver: idSchema("ses").nullable(),
  }),
  // flow process가 끝났다. 신호로 죽으면 code가 null이다.
  line("program_exited", lophnBy, {
    code: z.number().int().nullable(),
    stderr_tail: z.string(),
  }),
]);
export type WorkflowLine = z.infer<typeof workflowLineSchema>;

export const workflowEntrySchema = z
  .object({
    key: z.string(), // 그 순간 project 이름으로 만든 보이는 글
    project: idSchema("prj"),
    name: workflowNameSchema,
    state: z.enum(["ok", "invalid"]),
    kind: z.enum(["agent", "flow"]).nullable(),
    startable: z.boolean(),
    problem: z
      .object({
        reason: z.enum([
          "no_declaration",
          "invalid_yaml",
          "invalid_declaration",
          "no_flow_file",
        ]),
        message: z.string(),
      })
      .nullable(),
    participants: z.record(participantKeySchema, participantSchema).nullable(),
    steps: z
      .array(
        z.object({
          name: stepNameSchema,
          by: participantKeySchema,
          with: z.string().nullable(),
          next: z.array(stepNextSchema),
        }),
      )
      .nullable(),
    artifacts: z.object({ static: z.boolean(), instance: z.boolean() }),
  })
  .refine((v) => (v.problem !== null) === !v.startable, {
    message: "only unstartable workflows have a problem",
  });
export type WorkflowEntry = z.infer<typeof workflowEntrySchema>;

export const workflowInstanceSummarySchema = z.object({
  id: idSchema("wfi"),
  project: idSchema("prj"),
  workflow: workflowNameSchema,
  state: workflowStateSchema,
  current: currentSchema,
  input: z.string(),
  started_by: startedBySchema,
  created_at: atSchema,
  finished_at: atSchema.nullable(),
  last_line: workflowLineSchema.nullable(),
});
export type WorkflowInstanceSummary = z.infer<
  typeof workflowInstanceSummarySchema
>;
