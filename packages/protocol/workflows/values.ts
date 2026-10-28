import { z } from "zod";
import { placeNameSchema } from "../lophn-agent/places.ts";

export const workflowNameSchema = z
  .string()
  .max(63)
  .regex(/^[a-z][a-z0-9]*(-[a-z0-9]+)*$/);

// 사람과 agent가 보는 이름 `<project 이름>/<name>`이다. 저장하지 않고 도착할 때 project id로 푼다.
export const workflowKeySchema = z.string().refine(
  (s) => {
    const parts = s.split("/");
    return (
      parts.length === 2 &&
      parts[0] !== "" &&
      workflowNameSchema.safeParse(parts[1]).success
    );
  },
  { message: "workflow key must be <project name>/<name>" },
);

// next 안에서 workflow를 끝내는 예약 이름이다.
export const STEP_END = "end";

export const stepNameSchema = z
  .string()
  .max(63)
  .regex(/^[a-z][a-z0-9_-]*$/)
  .refine((s) => s !== STEP_END, { message: "end is reserved" });

export const stepNextSchema = z.union([stepNameSchema, z.literal(STEP_END)]);

export const participantKeySchema = z.string().min(1).max(63);

// step을 받는 참가자다. agent 이름과 place 이름(없으면 instance의 project)이거나,
// with의 참가자 session에 사람 차례를 적는 human, 선언만 받고 넘기지 못하는 harness다.
export const participantSchema = z.union([
  z.strictObject({
    agent: z.string().min(1),
    place: placeNameSchema.optional(),
  }),
  z.strictObject({ kind: z.literal("human") }),
  z.strictObject({ kind: z.literal("harness") }),
]);
export type Participant = z.infer<typeof participantSchema>;

export const SESSION_CHOICES = ["new", "same"] as const;
export const sessionChoiceSchema = z.enum(SESSION_CHOICES);
export type SessionChoice = z.infer<typeof sessionChoiceSchema>;

// report 글은 다음 step 메시지 본문에 그대로 실리고 화면이 줄마다 읽는 짧은 메모다.
export const WORKFLOW_TEXT_MAX_BYTES = 8192;
const encoder = new TextEncoder();
export const workflowTextSchema = z
  .string()
  .min(1)
  .refine((s) => encoder.encode(s).length <= WORKFLOW_TEXT_MAX_BYTES, {
    message: `text is over ${WORKFLOW_TEXT_MAX_BYTES} bytes`,
  });

// flow instance의 step `by`. flow는 참가자가 없다.
export const FLOW_STEP_BY = "program";

export const WORKFLOW_STATES = ["running", "ended", "stopped"] as const;
export const workflowStateSchema = z.enum(WORKFLOW_STATES);
export type WorkflowState = z.infer<typeof workflowStateSchema>;

export const WORKFLOW_LINE_KINDS = [
  "started",
  "report",
  "edit",
  "handed",
  "not_handed",
  "ended",
  "stopped",
  "lophn_restarted",
  "program_exited",
] as const;
export type WorkflowLineKind = (typeof WORKFLOW_LINE_KINDS)[number];
