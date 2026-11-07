import { z } from "zod";
import { workspaceNameSchema } from "../lophn-agent/workspaces.ts";
import {
  participantKeySchema,
  stepNameSchema,
  stepNextSchema,
} from "./values.ts";

// lophn이 읽는 칸만 검사한다. 모르는 칸은 틀렸다고 하지 않고 읽지도 않는다.
// by·with·next가 가리키는 이름이 있는지는 읽을 때 보지 않는다(넘길 때 "넘기지 못함" 줄이 된다).
const declarationParticipantSchema = z.union([
  z.looseObject({ kind: z.literal("human") }),
  z.looseObject({
    agent: z.string().min(1),
    workspace: workspaceNameSchema.optional(),
  }),
]);

const declarationStepSchema = z.looseObject({
  by: participantKeySchema,
  with: participantKeySchema.optional(),
  prompt: z.string(),
  in: z.string().optional(),
  out: z.string().optional(),
  next: z.array(stepNextSchema).optional(),
});

// 첫 step이 steps의 첫 key라서 하나는 있어야 한다. 순서는 object의 key 순서에 기댄다.
// 정수 꼴 key는 stepNameSchema가 글자로 시작하게 해서 이미 막혀 있다.
const hasStep = (steps: Record<string, unknown>) =>
  Object.keys(steps).length > 0;
const NEEDS_STEP = { message: "steps needs at least one step" };

export const workflowDeclarationSchema = z.discriminatedUnion("kind", [
  z.looseObject({
    kind: z.literal("agent"),
    participants: z.record(participantKeySchema, declarationParticipantSchema),
    steps: z
      .record(stepNameSchema, declarationStepSchema)
      .refine(hasStep, NEEDS_STEP),
  }),
  // flow는 참가자가 없고 step 이름만 읽는다(화면이 줄 때문에 쓴다).
  z.looseObject({
    kind: z.literal("flow"),
    agent: z.string().min(1).optional(),
    steps: z.record(stepNameSchema, z.unknown()).refine(hasStep, NEEDS_STEP),
  }),
]);
export type WorkflowDeclaration = z.infer<typeof workflowDeclarationSchema>;
