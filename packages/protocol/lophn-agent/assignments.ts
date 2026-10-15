import { z } from "zod";
import { defineCommand, defineRead } from "../base/route.ts";
import { defineEvent } from "../base/event.ts";
import { idSchema } from "../base/ids.ts";
import {
  positiveRevisionSchema,
  readCursorSchema,
  seqSchema,
} from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import {
  assignmentRecordSchema,
  assignmentScopeOutputSchema,
  assignmentScopeSchema,
  assignmentStateSchema,
  operatorScopeSchema,
  pauseReasonOutputSchema,
  pauseReasonSchema,
  scopeMatchesRole,
} from "./assignment-values.ts";
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
  role: builtinRoles,
  scope: assignmentScopeSchema,
}).refine((value) => scopeMatchesRole(value.role, value.scope), {
  message: "builtin assignment scope is not all",
});

// 자리(project·app)의 보관·보관 해제 반응 구독자다. notification 구독자와 같은 등록 규칙을 쓴다.
export const ASSIGNMENT_SUBSCRIBER = "lophn-agent-assignments";

export const createAppEngineerAssignmentInputSchema = z.strictObject({
  id: idSchema("asg"),
  app_created_seq: seqSchema,
  app: idSchema("app"),
  // AppCreated 반응(assignment 생성)과 cursor 전진을 같은 transaction에 확정한다
  // (architecture 5.10, createNotification과 같은 모양). 반응 없이 직접 내는
  // 등록은 이 둘을 비워 둔다.
  processed_through_seq: seqSchema.optional(),
  // cursor CAS가 자기 구독자를 input에서 읽는다(events advance-cursor와 같은 모양).
  subscriber: z.literal(ASSIGNMENT_SUBSCRIBER).optional(),
});

// 사람이 새 Operator 정의를 저장할 때 SaveAgent가 같은 transaction에서 부른다.
export const createOperatorAssignmentInputSchema = z.strictObject({
  id: idSchema("asg"),
  scope: operatorScopeSchema,
});

export const pauseAssignmentInputSchema = z.strictObject({
  assignment: idSchema("asg"),
  reason: pauseReasonSchema,
  // 자리 보관 반응의 멈춤과 cursor 전진을 같은 transaction에 확정한다.
  // 마지막 반응만 이 둘을 싣는다. 반응 없이 내는 멈춤은 비워 둔다.
  processed_through_seq: seqSchema.optional(),
  subscriber: z.literal(ASSIGNMENT_SUBSCRIBER).optional(),
});

export const pauseAssignmentCompareSchema = z.strictObject({
  revision: positiveRevisionSchema,
  state: z.literal("enabled"),
  processed_through_seq: seqSchema.optional(),
});

export const resumeAssignmentInputSchema = z.strictObject({
  assignment: idSchema("asg"),
  processed_through_seq: seqSchema.optional(),
  subscriber: z.literal(ASSIGNMENT_SUBSCRIBER).optional(),
});

export const resumeAssignmentCompareSchema = z.strictObject({
  revision: positiveRevisionSchema,
  state: z.literal("paused"),
  processed_through_seq: seqSchema.optional(),
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

// 반응 command의 비교 기준은 기록된 cursor다(createNotification과 같은 모양).
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

export const createOperatorAssignment = defineCommand({
  resource: "assignments",
  method: "create-operator",
  name: "CreateOperatorAssignment",
  input: createOperatorAssignmentInputSchema,
  output: assignmentResult,
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
  actors: ["machine"],
  errors: [...errors],
});

export const resumeAssignment = defineCommand({
  resource: "assignments",
  method: "resume",
  name: "ResumeAssignment",
  input: resumeAssignmentInputSchema,
  output: assignmentResult,
  compare: resumeAssignmentCompareSchema,
  actors: ["machine"],
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
  input: z.strictObject({ assignment: idSchema("asg") }),
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

const subject = idSchema("asg");
const revisionPair = {
  before: positiveRevisionSchema,
  after: positiveRevisionSchema,
};

export const assignmentCreated = defineEvent("AssignmentCreated", {
  subject,
  payload: z.object({
    revision: positiveRevisionSchema,
    role: agentRoleSchema,
    scope: assignmentScopeOutputSchema,
  }),
});

export const assignmentPaused = defineEvent("AssignmentPaused", {
  subject,
  payload: z.object({
    ...revisionPair,
    reason: pauseReasonOutputSchema,
  }),
});

export const assignmentResumed = defineEvent("AssignmentResumed", {
  subject,
  payload: z.object(revisionPair),
});

export const assignmentWithdrawn = defineEvent("AssignmentWithdrawn", {
  subject,
  payload: z.object(revisionPair),
});

export const ASSIGNMENT_ROUTES = [
  createBuiltinAssignment,
  createAppEngineerAssignment,
  createOperatorAssignment,
  pauseAssignment,
  resumeAssignment,
  withdrawAssignment,
  assignmentRead,
  assignmentList,
] as const;

export const ASSIGNMENT_EVENTS = [
  assignmentCreated,
  assignmentPaused,
  assignmentResumed,
  assignmentWithdrawn,
] as const;
