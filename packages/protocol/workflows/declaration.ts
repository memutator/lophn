import { z } from "zod";
import { workspaceNameSchema } from "../lophn-agent/workspaces.ts";
import { workflowInputsSchema, workflowOutputsSchema } from "./inputs.ts";
import {
  participantKeySchema,
  sessionOpenModeSchema,
  stepNameSchema,
  stepNextSchema,
} from "./values.ts";

// lophn이 읽는 칸만 검사한다. 모르는 칸은 틀렸다고 하지 않고 읽지도 않는다.
// by·with·next가 가리키는 이름이 있는지는 읽을 때 보지 않는다(넘길 때 "넘기지 못함" 줄이 된다).
// 사람은 다른 컴퓨터에 있지 않다(on은 agent 참가자만).
export const declarationParticipantSchema = z.union([
  z
    .looseObject({ kind: z.literal("human") })
    .refine((p) => !("on" in p), { message: "a human participant has no on" }),
  z.looseObject({
    agent: z.string().min(1),
    workspace: workspaceNameSchema.optional(),
    on: z.string().min(1).optional(),
    open: sessionOpenModeSchema.optional(),
  }),
]);

export const declarationStepSchema = z.looseObject({
  by: participantKeySchema,
  with: participantKeySchema.optional(),
  prompt: z.string(),
  in: z.string().optional(),
  out: z.string().optional(),
  next: z.array(stepNextSchema).optional(),
  open: sessionOpenModeSchema.optional(),
});

// 통합 선언 schema다. `kind`는 제거하되 기존 YAML에 남아 있으면 보존·무시하고,
// flow code 유무에 따른 `steps` 필수 여부와 step 모양 검사는 core가 맡는다.
export const workflowDeclarationSchema = z.looseObject({
  kind: z.enum(["agent", "flow"]).optional(),
  flow_sdk: z
    .string()
    .regex(/^\d+\.\d+\.\d+$/)
    .optional(),
  default_step: stepNameSchema.optional(),
  open: sessionOpenModeSchema.optional(),
  inputs: workflowInputsSchema.optional(),
  outputs: workflowOutputsSchema.optional(),
  agent: z.string().min(1).optional(),
  participants: z
    .record(participantKeySchema, declarationParticipantSchema)
    .optional(),
  steps: z.record(stepNameSchema, z.unknown()).optional(),
});
export type WorkflowDeclaration = z.infer<typeof workflowDeclarationSchema>;
