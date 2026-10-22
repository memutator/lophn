import { z } from "zod";
import {
  participantKeySchema,
  participantSchema,
  stepNameSchema,
  stepNextSchema,
} from "./values.ts";

// lophn이 읽는 칸만 검사한다. 모르는 칸은 틀렸다고 하지 않고 읽지도 않는다.
// by·with·next가 가리키는 이름이 있는지는 읽을 때 보지 않는다(넘길 때 "넘기지 못함" 줄이 된다).
const declarationParticipantSchema = z.looseObject(participantSchema.shape);

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
export const workflowDeclarationSchema = z.discriminatedUnion("kind", [
  z.looseObject({
    kind: z.literal("agent"),
    participants: z.record(participantKeySchema, declarationParticipantSchema),
    steps: z.record(stepNameSchema, declarationStepSchema).refine(
      (steps) => Object.keys(steps).length > 0,
      { message: "steps needs at least one step" },
    ),
  }),
  z.looseObject({ kind: z.literal("flow") }),
]);
export type WorkflowDeclaration = z.infer<typeof workflowDeclarationSchema>;
