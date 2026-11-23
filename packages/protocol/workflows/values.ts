import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { workspaceNameSchema } from "../lophn-agent/workspaces.ts";

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

// step을 받는 참가자다. agent 이름과 workspace 이름(없으면 instance의 project)이거나,
// with의 참가자 session에 사람 차례를 적는 human이다. harness agent는 이름이 있는 agent라 agent 참가자다.
// on은 그 agent가 있는 사람의 다른 컴퓨터(명단의 이름이나 `mch_`)다. 넘길 때마다 푼다.
export const participantSchema = z.union([
  z.strictObject({
    agent: z.string().min(1),
    workspace: workspaceNameSchema.optional(),
    on: z.string().min(1).optional(),
  }),
  z.strictObject({ kind: z.literal("human") }),
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
  // 2a: 명시적 완료 없이 끝난 step, 사람의 [Retry], escalate 대기, 사람이 고른 최신 code 적용.
  "step_stalled",
  "retried",
  "escalated",
  "code_updated",
] as const;
export type WorkflowLineKind = (typeof WORKFLOW_LINE_KINDS)[number];

// 저장하지 않고 읽을 때 계산하는 상태다(저장 상태는 WORKFLOW_STATES 셋뿐이다).
export const DERIVED_STATUSES = [
  "working",
  "needs_you",
  "blocked",
  "ended",
  "stopped",
] as const;
export const derivedStatusSchema = z.enum(DERIVED_STATUSES);
export type DerivedStatus = z.infer<typeof derivedStatusSchema>;

// session이 속한 workflow instance와 step이다(`sessions.workflow_origin`). step을 넘길 때마다 갱신하고 team spawn 자식은 열 때 이어받는다.
export const workflowOriginSchema = z.strictObject({
  project: idSchema("prj"),
  workflow: workflowNameSchema,
  instance: idSchema("wfi"),
  step: z.string().min(1),
});
export type WorkflowOrigin = z.infer<typeof workflowOriginSchema>;

// 명시적으로 report한 산출물 경로 목록과 선택적 구조화 값이다. 경로는 lophn이 판정하지 않고 적힌 대로 둔다.
export const workflowRefsSchema = z.array(z.string().min(1).max(1024)).max(100);
export const workflowDataSchema = z.json();
