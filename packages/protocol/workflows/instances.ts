import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { atSchema, seqSchema } from "../base/values.ts";
import {
  callFailReasonSchema,
  callStateSchema,
  mailDeliverySchema,
} from "../lophn-agent/calls.ts";
import { workspaceOutputSchema } from "../lophn-agent/workspaces.ts";
import {
  workflowInputsSchema,
  workflowInputValuesSchema,
  workflowOutputsSchema,
} from "./inputs.ts";
import {
  derivedStatusSchema,
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
  workflowStateSchema,
  workflowTextSchema,
} from "./values.ts";

export const lineBySchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("user") }),
  z.strictObject({ kind: z.literal("agent"), session: idSchema("ses") }),
  z.strictObject({ kind: z.literal("lophn") }),
  z.strictObject({ kind: z.literal("program") }),
  // 다른 컴퓨터의 참가자가 낸 report. computer는 받은 때 이 기계 명단의 이름, name은 그 참가자의 이름이다.
  z.strictObject({
    kind: z.literal("remote"),
    machine: idSchema("mch"),
    computer: z.string(),
    name: z.string(),
  }),
  // 다른 컴퓨터의 lophn이 쓴 진행 줄: 그 컴퓨터에서 step을 가져간 turn이 report 없이 끝났다(실패, 멈춤, 재시작).
  z.strictObject({
    kind: z.literal("remote_lophn"),
    machine: idSchema("mch"),
    computer: z.string(),
  }),
]);
export type LineBy = z.infer<typeof lineBySchema>;

const userBy = z.strictObject({ kind: z.literal("user") });
const lophnBy = z.strictObject({ kind: z.literal("lophn") });

// 시작한 쪽: 사람(StartWorkflow), 승인된 job, 또는 같은 project의 상위 workflow
export const startedBySchema = z.discriminatedUnion("kind", [
  userBy,
  z.strictObject({ kind: z.literal("job"), job: idSchema("job") }),
  z.strictObject({ kind: z.literal("workflow"), instance: idSchema("wfi") }),
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
    inputs: workflowInputValuesSchema.optional(),
    state: workflowStateSchema,
    participants: z.record(participantKeySchema, participantSchema), // 시작할 때 선언에서 옮긴 것
    steps: z.array(instanceStepSchema), // 순서 있음. agent가 고친다
    current: currentSchema,
    started_by: startedBySchema,
    code_snapshot: z.string().min(1).nullable().optional(),
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
  "no_with",
  "unresolved",
  // 참가자의 on이 명단의 다른 컴퓨터 하나로 풀리지 않는다.
  "unknown_computer",
  // 다른 컴퓨터로 넘긴 step이 거기서 돌지 못했다(건너뜀, 만료, 옛 판, 거절, 없는 받는 곳, 그 기계의 재시작).
  "remote_failed",
] as const;
export const notHandedReasonSchema = z.enum(NOT_HANDED_REASONS);
export type NotHandedReason = z.infer<typeof notHandedReasonSchema>;

export const handResultSchema = z.discriminatedUnion("outcome", [
  z.object({
    step: z.string(),
    outcome: z.literal("handed"),
    // 다른 컴퓨터로 넘겼으면 null이다(그 session은 받은 뒤에 안다).
    receiver: idSchema("ses").nullable(),
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

// 다른 컴퓨터로 넘긴 step: 그 컴퓨터(받은 때의 명단 이름)와 이 기계에 남은 call 행.
export const remoteHandSchema = z.strictObject({
  machine: idSchema("mch"),
  computer: z.string(),
  call: idSchema("cal"),
});

// 다른 컴퓨터로 넘긴 step call의 지금 상태. delivery는 끝나지 않은 동안만 있다(pending, unknown, held, running).
export const remoteStepSchema = z.object({
  call: idSchema("cal"),
  step: z.string(),
  machine: idSchema("mch"),
  computer: z.string(),
  state: callStateSchema,
  delivery: mailDeliverySchema.nullable(),
  fail_reason: callFailReasonSchema.nullable(),
  // 그 컴퓨터에서 step을 받은 session(알면). 이 기계의 session이 아니다.
  session: idSchema("ses").nullable(),
});
export type RemoteStep = z.infer<typeof remoteStepSchema>;

export const reportLineSchema = line("report", lineBySchema, {
  step: stepNameSchema,
  text: z.string(),
  next: stepNextSchema.nullable(),
  session: sessionChoiceSchema,
  // 옛 줄에는 없다.
  refs: workflowRefsSchema.optional(),
  data: workflowDataSchema.optional(),
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
    // 다른 컴퓨터로 넘겼으면 null이고 remote가 있다.
    receiver: idSchema("ses").nullable(),
    human_turn: z.boolean(),
    cause: z.enum(["start", "report", "edit", "retry"]),
    session: sessionChoiceSchema.nullable(),
    // 옛 줄에는 없다(이 컴퓨터로 넘긴 step과 같다).
    remote: remoteHandSchema.nullable().optional(),
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
  // 명시적 완료(report) 없이 turn이 끝났고 열린 call도 없다. 넘김(attempt)당 한 번, 사람 step은 제외한다.
  line("step_stalled", lophnBy, {
    step: z.string(),
    session: idSchema("ses").nullable(),
    reason: z.string().optional(),
    message: z.string().optional(),
  }),
  // 사람의 [Retry]: 기록된 같은 session에 이어서 하라는 입력을 넣었다(session이 열리기 전이면 넘기기를 다시 했다).
  line("retried", userBy, {
    step: z.string().nullable(),
    session: idSchema("ses").nullable(),
  }),
  // escalate: 사람의 판단을 기다린다.
  line("escalated", lineBySchema, {
    step: z.string().nullable(),
    text: z.string(),
  }),
  // 사람이 [Resume with updated code]로 최신 flow code를 snapshot에 적용했다.
  line("code_updated", userBy, {}),
]);
export type WorkflowLine = z.infer<typeof workflowLineSchema>;
export type HandedLine = Extract<WorkflowLine, { kind: "handed" }>;

// instance의 `workflow_origin`을 가진 session 한 줄이다. parent로 session tree를 이룬다(spawned_by).
export const workflowSessionNodeSchema = z.object({
  session: idSchema("ses"),
  parent: idSchema("ses").nullable(),
  agent: z.string(),
  workspace: workspaceOutputSchema.nullable(),
  state: z.enum(["running", "waiting", "idle", "unknown"]),
  waiting_for: z.enum(["approval", "question"]).nullable(),
  // 마지막 assistant 텍스트의 앞 160자(redaction 적용, LLM 요약 아님). 없으면 null.
  last_assistant_preview: z.string().nullable(),
  // 마지막 turn이 실패했으면 redaction된 이유. 아니면 null.
  last_error: z.string().nullable(),
  // GUI 터미널 팀원 session이면 Run 화면 [Open session]이 열린 터미널 탭과 대조할 때 쓴다.
  harness_gui: z.boolean().optional(),
  harness: z.string().nullable().optional(),
  cli_session: z.string().nullable().optional(),
});
export type WorkflowSessionNode = z.infer<typeof workflowSessionNodeSchema>;

export const workflowCheckpointSchema = z.object({
  instance: idSchema("wfi"),
  key: z.string().min(1),
  kind: workflowCheckpointKindSchema,
  state: workflowCheckpointStateSchema,
  handle_ref: z.string().nullable(),
  output: z.unknown().nullable(),
  error: workflowOutcomeErrorSchema.nullable(),
  started_at: atSchema,
  finished_at: atSchema.nullable(),
});
export type WorkflowCheckpoint = z.infer<typeof workflowCheckpointSchema>;

export const workflowChildSummarySchema = z.object({
  instance: idSchema("wfi"),
  workflow: workflowNameSchema,
  state: workflowStateSchema,
  derived_status: derivedStatusSchema,
  started_at: atSchema,
  ended_at: atSchema.nullable(),
});
export type WorkflowChildSummary = z.infer<typeof workflowChildSummarySchema>;

export const workflowEntrySchema = z
  .object({
    key: z.string(), // 그 순간 project 이름으로 만든 보이는 글
    project: idSchema("prj"),
    name: workflowNameSchema,
    state: z.enum(["ok", "invalid"]),
    kind: z.enum(["agent", "flow"]).nullable(),
    flow_sdk: z.string().nullable().optional(),
    flow_sdk_status: z
      .enum(["current", "available", "required"])
      .nullable()
      .optional(),
    startable: z.boolean(),
    problem: z
      .object({
        reason: z.enum([
          "no_declaration",
          "invalid_yaml",
          "invalid_declaration",
          "invalid_inputs",
          "no_flow_file",
          "broken_flow",
        ]),
        message: z.string(),
      })
      .nullable(),
    inputs: workflowInputsSchema.optional(),
    outputs: workflowOutputsSchema.optional(),
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

// StartBox의 agent 입력 필드 선택지용. ListWorkflows가 project에서 호출 가능한 agent 목록을 함께 돌려준다.
export const callableAgentOptionSchema = z.object({
  name: z.string().min(1),
  label: z.string().min(1).optional(),
  kind: z.string().min(1).optional(),
});
export type CallableAgentOption = z.infer<typeof callableAgentOptionSchema>;

export const listWorkflowsResponseSchema = z.object({
  workflows: z.array(workflowEntrySchema),
  callable_agents: z.array(callableAgentOptionSchema).optional(),
});
export type ListWorkflowsResponse = z.infer<typeof listWorkflowsResponseSchema>;

export const workflowInstanceSummarySchema = z.object({
  id: idSchema("wfi"),
  project: idSchema("prj"),
  workflow: workflowNameSchema,
  state: workflowStateSchema,
  current: currentSchema,
  input: z.string(),
  inputs: workflowInputValuesSchema.optional(),
  started_by: startedBySchema,
  created_at: atSchema,
  finished_at: atSchema.nullable(),
  last_line: workflowLineSchema.nullable(),
  // 읽을 때 계산한 상태. 2a 읽기가 채운다.
  derived_status: derivedStatusSchema.optional(),
});
export type WorkflowInstanceSummary = z.infer<
  typeof workflowInstanceSummarySchema
>;
