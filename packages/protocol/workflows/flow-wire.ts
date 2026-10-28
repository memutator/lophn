import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { agentAddressSchema } from "../lophn-agent/places.ts";
import { jsonValueSchema, toolNameSchema } from "../apps/channel-values.ts";
import {
  stepNameSchema,
  stepNextSchema,
  workflowTextSchema,
} from "./values.ts";

// flow process와 core가 stdin·stdout에 줄마다 JSON 하나씩 주고받는 약속이다.
// 요청에는 instance가 없다. core가 그 process의 instance로 채운다.

export const FLOW_SDK_NAME = "@lophn/flow";
// packages/sdk/flow/package.json의 version과 같아야 한다.
export const FLOW_SDK_VERSION = "1.0.0";
// SDK 설치 사본 안 lophn 진입 file.
export const FLOW_ENTRY_FILE = "entry.ts";

// core -> process: 첫 줄
export const flowStartMessageSchema = z.strictObject({
  type: z.literal("start"),
  instance: idSchema("wfi"),
  input: z.string(),
});
export type FlowStartMessage = z.infer<typeof flowStartMessageSchema>;

// 실패도 값이다. reason은 run의 error.reason, "cancelled", 또는 요청이 시작되지 못했을 때의 경계 오류 코드다.
export const flowOutcomeSchema = z.union([
  z.strictObject({ ok: z.literal(true), result: z.json() }),
  z.strictObject({
    ok: z.literal(false),
    reason: z.string(),
    message: z.string(),
  }),
]);
export type FlowOutcome = z.infer<typeof flowOutcomeSchema>;

// core -> process
export const flowResponseSchema = z.strictObject({
  type: z.literal("response"),
  id: z.string().min(1),
  outcome: flowOutcomeSchema,
});
export type FlowResponse = z.infer<typeof flowResponseSchema>;

// process -> core. agent·tool의 result는 run의 result이고 report의 result는 null이다.
// 칸 모양은 StartRun 입력과 같다. agent는 session을 이어 쓰지 않아 session이 없고,
// place가 없으면 instance의 project다.
export const flowRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("agent"),
    id: z.string().min(1),
    agent: agentAddressSchema,
    prompt: z.string().min(1),
    input: jsonValueSchema.optional(),
    schema: z.record(z.string(), z.json()).optional(),
  }),
  z.strictObject({
    type: z.literal("tool"),
    id: z.string().min(1),
    app: z.string().min(1),
    tool: toolNameSchema,
    input: jsonValueSchema.optional(),
  }),
  z.strictObject({
    type: z.literal("report"),
    id: z.string().min(1),
    step: stepNameSchema,
    text: workflowTextSchema,
    next: stepNextSchema.optional(),
  }),
]);
export type FlowRequest = z.infer<typeof flowRequestSchema>;
