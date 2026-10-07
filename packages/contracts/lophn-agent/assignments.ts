import { z } from "zod";
import {
  defineCommand,
  defineEvent,
  defineRead,
  idSchema,
  seqSchema,
  sha256Schema,
  withReadCommon,
} from "../platform/mod.ts";
import {
  assignmentRecordSchema,
  assignmentScopeOutputSchema,
  assignmentScopeSchema,
  assignmentStateSchema,
  operatorApprovalBundleSchema,
  pauseReasonOutputSchema,
  pauseReasonSchema,
  scopeMatchesRole,
} from "./assignment-values.ts";
import { operatorOutputRefOutputSchema } from "./instructions.ts";
import { positiveRevisionSchema, readCursorSchema } from "./run-values.ts";
import { agentRoleSchema } from "./scope.ts";

const errors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
] as const;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

const builtinRoles = z.enum(["lophn", "context_engineer"]);

export const createBuiltinAssignmentInputSchema = z.strictObject({
  id: idSchema("asg"),
  preset: idSchema("pst"),
  preset_revision: positiveRevisionSchema,
  role: builtinRoles,
  scope: assignmentScopeSchema,
}).refine((value) => scopeMatchesRole(value.role, value.scope), {
  message: "builtin assignment scope is not all",
});

// AppCreated 반응 구독자다. notification 구독자와 같은 등록 규칙을 쓴다(R1).
export const ASSIGNMENT_SUBSCRIBER = "lophn-agent-assignments";

export const createAppEngineerAssignmentInputSchema = z.strictObject({
  id: idSchema("asg"),
  app_created_seq: seqSchema,
  app: idSchema("app"),
  preset: idSchema("pst"),
  preset_revision: positiveRevisionSchema,
  // AppCreated 반응(assignment 생성)과 cursor 전진을 같은 transaction에 확정한다
  // (architecture 5.10, createNotification과 같은 모양). 반응 없이 직접 내는
  // 등록은 이 둘을 비워 둔다.
  processed_through_seq: seqSchema.optional(),
  // cursor CAS가 자기 구독자를 input에서 읽는다(events advance-cursor와 같은 모양).
  subscriber: z.literal(ASSIGNMENT_SUBSCRIBER).optional(),
});

export const applyOperatorAssignmentInputSchema = z.strictObject({
  approval: idSchema("apr"),
  decision_seq: seqSchema,
  id: idSchema("asg"),
  bundle: operatorApprovalBundleSchema,
}).refine(
  (value) =>
    value.bundle.assignment === null || value.bundle.assignment === value.id,
  { message: "bundle assignment does not match the applied id" },
);

export const changeAssignmentPresetInputSchema = z.strictObject({
  assignment: idSchema("asg"),
  preset: idSchema("pst"),
  preset_revision: positiveRevisionSchema,
});

export const changeAssignmentPresetCompareSchema = z.strictObject({
  revision: positiveRevisionSchema,
  role: z.enum(["lophn", "app_engineer", "context_engineer"]),
});

export const pauseAssignmentInputSchema = z.strictObject({
  assignment: idSchema("asg"),
  reason: pauseReasonSchema,
});

export const pauseAssignmentCompareSchema = z.strictObject({
  revision: positiveRevisionSchema,
  state: z.literal("enabled"),
});

export const resumeAssignmentInputSchema = z.strictObject({
  assignment: idSchema("asg"),
});

export const resumeAssignmentCompareSchema = z.strictObject({
  revision: positiveRevisionSchema,
  state: z.literal("paused"),
});

export const withdrawAssignmentInputSchema = z.strictObject({
  assignment: idSchema("asg"),
});

export const withdrawAssignmentCompareSchema = z.strictObject({
  revision: positiveRevisionSchema,
  state: z.enum(["enabled", "paused"]),
});

const assignmentResult = z.object({ assignment: assignmentRecordSchema });

export const createBuiltinAssignment = defineCommand({
  resource: "assignments",
  method: "create-builtin",
  name: "CreateBuiltinAssignment",
  input: createBuiltinAssignmentInputSchema,
  output: assignmentResult,
  actors: ["machine"],
  errors: [...errors],
});

// 반응 command의 비교 기준은 기록된 cursor다(R1, createNotification과 같은 모양).
export const createAppEngineerAssignmentCompareSchema = z.strictObject({
  processed_through_seq: seqSchema.optional(),
});

export const createAppEngineerAssignment = defineCommand({
  resource: "assignments",
  method: "create-app-engineer",
  name: "CreateAppEngineerAssignment",
  input: createAppEngineerAssignmentInputSchema,
  output: assignmentResult,
  compare: createAppEngineerAssignmentCompareSchema,
  actors: ["machine"],
  errors: [...errors],
});

export const applyOperatorAssignment = defineCommand({
  resource: "assignments",
  method: "apply-operator",
  name: "ApplyOperatorAssignment",
  input: applyOperatorAssignmentInputSchema,
  output: assignmentResult,
  actors: ["machine"],
  errors: [...errors],
  confirmation: "required",
  binding: ["approval", "decision_seq", "bundle"],
  display_read: "/v1/assignments/read",
});

export const changeAssignmentPreset = defineCommand({
  resource: "assignments",
  method: "change-preset",
  name: "ChangeAssignmentPreset",
  input: changeAssignmentPresetInputSchema,
  output: assignmentResult,
  compare: changeAssignmentPresetCompareSchema,
  actors: ["user"],
  errors: [...errors],
});

export const pauseAssignment = defineCommand({
  resource: "assignments",
  method: "pause",
  name: "PauseAssignment",
  input: pauseAssignmentInputSchema,
  output: assignmentResult,
  compare: pauseAssignmentCompareSchema,
  actors: ["user", "machine"],
  errors: [...errors],
});

export const resumeAssignment = defineCommand({
  resource: "assignments",
  method: "resume",
  name: "ResumeAssignment",
  input: resumeAssignmentInputSchema,
  output: assignmentResult,
  compare: resumeAssignmentCompareSchema,
  actors: ["user"],
  errors: [...errors],
});

export const withdrawAssignment = defineCommand({
  resource: "assignments",
  method: "withdraw",
  name: "WithdrawAssignment",
  input: withdrawAssignmentInputSchema,
  output: assignmentResult,
  compare: withdrawAssignmentCompareSchema,
  actors: ["user"],
  errors: [...errors],
});

export const assignmentRead = defineRead({
  resource: "assignments",
  method: "read",
  name: "ReadAssignment",
  input: z.strictObject({
    assignment: idSchema("asg"),
    revision: positiveRevisionSchema.optional(),
  }),
  output: withReadCommon(assignmentResult),
  actors: ["user", "agent", "machine", "coding_agent"],
  errors: [...readErrors],
});

export const assignmentList = defineRead({
  resource: "assignments",
  method: "list",
  name: "ListAssignments",
  input: z.strictObject({
    role: agentRoleSchema.optional(),
    state: assignmentStateSchema.optional(),
    cursor: readCursorSchema.optional(),
  }),
  output: withReadCommon(z.object({
    assignments: z.array(assignmentRecordSchema),
  })),
  actors: ["user", "agent", "machine", "coding_agent"],
  errors: [...readErrors],
});

// 그 문서를 출력으로 가진 Operator. 없으면 null이고 withdrawn도 그대로 돌려준다.
export const assignmentOutputs = defineRead({
  resource: "assignments",
  method: "outputs",
  name: "ReadAssignmentOutput",
  input: z.strictObject({ document: idSchema("doc") }),
  output: withReadCommon(z.object({
    output: operatorOutputRefOutputSchema.nullable(),
  })),
  actors: ["user", "agent", "machine", "coding_agent"],
  errors: [...readErrors],
});

const subject = idSchema("asg");
const revisionPair = {
  before: positiveRevisionSchema,
  after: positiveRevisionSchema,
};

export const assignmentCreated = defineEvent("AssignmentCreated", {
  subject,
  payload: z.object({
    revision: positiveRevisionSchema,
    definition_hash: sha256Schema,
    preset: idSchema("pst"),
    preset_revision: positiveRevisionSchema,
    scope: assignmentScopeOutputSchema,
    approval: idSchema("apr").nullable(),
  }),
});

export const assignmentChanged = defineEvent("AssignmentChanged", {
  subject,
  payload: z.object({
    ...revisionPair,
    before_hash: sha256Schema,
    after_hash: sha256Schema,
    preset: idSchema("pst"),
    preset_revision: positiveRevisionSchema,
    approval: idSchema("apr").nullable(),
    schedule_changed: z.boolean(),
  }),
});

export const assignmentPaused = defineEvent("AssignmentPaused", {
  subject,
  payload: z.object({
    ...revisionPair,
    reason: pauseReasonOutputSchema,
    definition_hash: sha256Schema,
  }),
});

export const assignmentResumed = defineEvent("AssignmentResumed", {
  subject,
  payload: z.object({
    ...revisionPair,
    definition_hash: sha256Schema,
  }),
});

export const assignmentWithdrawn = defineEvent("AssignmentWithdrawn", {
  subject,
  payload: z.object({
    ...revisionPair,
    definition_hash: sha256Schema,
  }),
});

export const ASSIGNMENT_ROUTES = [
  createBuiltinAssignment,
  createAppEngineerAssignment,
  applyOperatorAssignment,
  changeAssignmentPreset,
  pauseAssignment,
  resumeAssignment,
  withdrawAssignment,
  assignmentRead,
  assignmentList,
  assignmentOutputs,
] as const;

export const ASSIGNMENT_EVENTS = [
  assignmentCreated,
  assignmentChanged,
  assignmentPaused,
  assignmentResumed,
  assignmentWithdrawn,
] as const;
