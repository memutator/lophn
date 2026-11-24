import { z } from "zod";
import { jsonValueSchema, toolNameSchema } from "../apps/channel-values.ts";
import { idSchema } from "../base/ids.ts";
import { agentAddressSchema } from "../lophn-agent/workspaces.ts";
import { workflowInputValuesSchema } from "./inputs.ts";
import { workflowCheckpointSchema } from "./instances.ts";
import {
  sessionChoiceSchema,
  sessionOpenModeSchema,
  stepNameSchema,
  stepNextSchema,
  workflowDataSchema,
  workflowOutcomeReasonSchema,
  workflowRefsSchema,
  workflowTextSchema,
} from "./values.ts";

// flow process와 core가 stdin·stdout에 줄마다 JSON 하나씩 주고받는 약속이다.
// 요청에는 instance가 없다. core가 그 process의 instance로 채운다.

export const FLOW_SDK_NAME = "@lophn/flow";
// packages/sdk/flow/package.json의 version·supported_from과 같아야 한다.
export const FLOW_SDK_VERSION = "2.1.0";
export const FLOW_SDK_SUPPORTED_FROM = "2.0.0";
// SDK 설치 사본 안 lophn 진입 file.
export const FLOW_ENTRY_FILE = "entry.ts";

// core -> process: 첫 줄
export const flowStartMessageSchema = z.strictObject({
  type: z.literal("start"),
  instance: idSchema("wfi"),
  input: z.string(),
  inputs: workflowInputValuesSchema.optional(),
  checkpoints: z.array(workflowCheckpointSchema).optional(),
});
export type FlowStartMessage = z.infer<typeof flowStartMessageSchema>;

// 실패도 값이다. reason은 경계 오류 코드 일곱 또는 실행 사유(cancelled, interrupted, stalled, model_error)다.
export const flowOutcomeSchema = z.union([
  z.strictObject({ ok: z.literal(true), result: z.json() }),
  z.strictObject({
    ok: z.literal(false),
    reason: workflowOutcomeReasonSchema,
    message: z.string(),
    session: idSchema("ses").optional(),
  }),
]);
export type FlowOutcome = z.infer<typeof flowOutcomeSchema>;

// core -> process: 요청 응답
export const flowResponseSchema = z.strictObject({
  type: z.literal("response"),
  id: z.string().min(1),
  outcome: flowOutcomeSchema,
});
export type FlowResponse = z.infer<typeof flowResponseSchema>;

// core -> process: 구독 중인 앱/session event 전달(비영속)
export const flowEventMessageSchema = z.strictObject({
  type: z.literal("event"),
  subscription_id: z.string().min(1),
  source: z.string().min(1),
  event: z.string().min(1),
  payload: z.json(),
});
export type FlowEventMessage = z.infer<typeof flowEventMessageSchema>;

export const flowHostMessageSchema = z.discriminatedUnion("type", [
  flowStartMessageSchema,
  flowResponseSchema,
  flowEventMessageSchema,
]);
export type FlowHostMessage = z.infer<typeof flowHostMessageSchema>;

export const FLOW_AGENT_MODES = ["turn", "report"] as const;
export const flowAgentModeSchema = z.enum(FLOW_AGENT_MODES);
export type FlowAgentMode = z.infer<typeof flowAgentModeSchema>;

// "new", "same", 또는 명시적 session id.
export const flowSessionChoiceSchema = z.union([
  sessionChoiceSchema,
  idSchema("ses"),
]);
export type FlowSessionChoice = z.infer<typeof flowSessionChoiceSchema>;

export const flowEventWorkspaceFilterSchema = z.union([
  z.string().min(1),
  z.strictObject({
    kind: z.enum(["project", "app"]),
    id: z.string().min(1),
  }),
]);
export type FlowEventWorkspaceFilter = z.infer<
  typeof flowEventWorkspaceFilterSchema
>;

// process -> core: 개별 요청 frame
export const flowStepBeginRequestSchema = z.strictObject({
  type: z.literal("step_begin"),
  id: z.string().min(1),
  key: z.string().min(1),
});
export type FlowStepBeginRequest = z.infer<typeof flowStepBeginRequestSchema>;

export const flowStepEndRequestSchema = z.strictObject({
  type: z.literal("step_end"),
  id: z.string().min(1),
  key: z.string().min(1),
  outcome: flowOutcomeSchema,
});
export type FlowStepEndRequest = z.infer<typeof flowStepEndRequestSchema>;

export const flowAgentRequestSchema = z.strictObject({
  type: z.literal("agent"),
  id: z.string().min(1),
  key: z.string().min(1),
  agent: agentAddressSchema,
  prompt: z.string().min(1),
  input: jsonValueSchema.optional(),
  schema: z.record(z.string(), z.json()).optional(),
  mode: flowAgentModeSchema.optional(),
  session: flowSessionChoiceSchema.optional(),
  open: sessionOpenModeSchema.optional(),
  step: z.string().min(1).optional(),
  on: z.string().min(1).optional(),
  cancel_id: z.string().min(1).optional(),
});
export type FlowAgentRequest = z.infer<typeof flowAgentRequestSchema>;

export const flowHumanRequestSchema = z.strictObject({
  type: z.literal("human"),
  id: z.string().min(1),
  key: z.string().min(1),
  with: agentAddressSchema,
  prompt: z.string().min(1),
  input: jsonValueSchema.optional(),
  step: z.string().min(1).optional(),
  session: flowSessionChoiceSchema.optional(),
  open: sessionOpenModeSchema.optional(),
  cancel_id: z.string().min(1).optional(),
});
export type FlowHumanRequest = z.infer<typeof flowHumanRequestSchema>;

export const flowWorkflowRequestSchema = z.strictObject({
  type: z.literal("workflow"),
  id: z.string().min(1),
  key: z.string().min(1),
  workflow: z.string().min(1),
  input: z.string().optional(),
  inputs: workflowInputValuesSchema.optional(),
  cancel_id: z.string().min(1).optional(),
});
export type FlowWorkflowRequest = z.infer<typeof flowWorkflowRequestSchema>;

export const flowToolRequestSchema = z.strictObject({
  type: z.literal("tool"),
  id: z.string().min(1),
  key: z.string().min(1),
  app: z.string().min(1),
  tool: toolNameSchema,
  input: jsonValueSchema.optional(),
  cancel_id: z.string().min(1).optional(),
});
export type FlowToolRequest = z.infer<typeof flowToolRequestSchema>;

export const flowCancelRequestSchema = z.strictObject({
  type: z.literal("cancel"),
  id: z.string().min(1),
  cancel_id: z.string().min(1),
});
export type FlowCancelRequest = z.infer<typeof flowCancelRequestSchema>;

export const flowSubscribeRequestSchema = z.strictObject({
  type: z.literal("subscribe"),
  id: z.string().min(1),
  subscription_id: z.string().min(1),
  source: z.string().min(1),
  event: z.string().min(1),
  workspace: flowEventWorkspaceFilterSchema.optional(),
});
export type FlowSubscribeRequest = z.infer<typeof flowSubscribeRequestSchema>;

export const flowUnsubscribeRequestSchema = z.strictObject({
  type: z.literal("unsubscribe"),
  id: z.string().min(1),
  subscription_id: z.string().min(1),
});
export type FlowUnsubscribeRequest = z.infer<
  typeof flowUnsubscribeRequestSchema
>;

export const flowReportRequestSchema = z.strictObject({
  type: z.literal("report"),
  id: z.string().min(1),
  step: stepNameSchema,
  text: workflowTextSchema,
  refs: workflowRefsSchema.optional(),
  data: workflowDataSchema.optional(),
  next: stepNextSchema.optional(),
});
export type FlowReportRequest = z.infer<typeof flowReportRequestSchema>;

export const flowEscalateRequestSchema = z.strictObject({
  type: z.literal("escalate"),
  id: z.string().min(1),
  step: z.string().min(1).optional(),
  reason: workflowTextSchema,
});
export type FlowEscalateRequest = z.infer<typeof flowEscalateRequestSchema>;

// durable v2 flow-host와 @lophn/flow가 주고받는 단일 요청 union이다.
export const flowRequestSchema = z.discriminatedUnion("type", [
  flowStepBeginRequestSchema,
  flowStepEndRequestSchema,
  flowAgentRequestSchema,
  flowHumanRequestSchema,
  flowWorkflowRequestSchema,
  flowToolRequestSchema,
  flowCancelRequestSchema,
  flowSubscribeRequestSchema,
  flowUnsubscribeRequestSchema,
  flowReportRequestSchema,
  flowEscalateRequestSchema,
]);
export type FlowRequest = z.infer<typeof flowRequestSchema>;
