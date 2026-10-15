import { z } from "zod";
import { positiveRevisionSchema } from "../base/values.ts";
import { idSchema } from "../base/ids.ts";
import { ASSIGNMENT_STATES } from "./instructions.ts";
import { agentRoleSchema } from "./scope.ts";

export const assignmentStateSchema = z.enum(ASSIGNMENT_STATES);

export const SCOPE_KINDS = ["all", "project", "app"] as const;

const scopeBranches = [
  z.strictObject({ kind: z.literal("all"), id: z.null() }),
  z.strictObject({ kind: z.literal("project"), id: idSchema("prj") }),
  z.strictObject({ kind: z.literal("app"), id: idSchema("app") }),
] as const;

const scopeOutputBranches = [
  z.object({ kind: z.literal("all"), id: z.null() }),
  z.object({ kind: z.literal("project"), id: idSchema("prj") }),
  z.object({ kind: z.literal("app"), id: idSchema("app") }),
] as const;

export const assignmentScopeSchema = z.discriminatedUnion(
  "kind",
  scopeBranches,
);
export const assignmentScopeOutputSchema = z.discriminatedUnion(
  "kind",
  scopeOutputBranches,
);

export type AssignmentScope = z.infer<typeof assignmentScopeSchema>;

// Operator는 project 또는 앱 자리에만 놓인다. 만드는 입력은 `all`을 받지 않는다.
export const operatorScopeSchema = z.discriminatedUnion("kind", [
  scopeBranches[1],
  scopeBranches[2],
]);

// 멈춤은 담당 자리가 보관된 동안만이다.
const pauseFields = {
  kind: z.literal("scope_archived"),
  detail: z.string().refine((value) => value.trim().length > 0, {
    message: "pause detail is blank",
  }),
  target: z.union([idSchema("prj"), idSchema("app")]),
};

export const pauseReasonSchema = z.strictObject(pauseFields);
export const pauseReasonOutputSchema = z.object(pauseFields);

export function scopeMatchesRole(
  role: z.infer<typeof agentRoleSchema>,
  scope: AssignmentScope,
): boolean {
  if (role === "lophn" || role === "context_engineer") {
    return scope.kind === "all";
  }
  if (role === "app_engineer") return scope.kind === "app";
  return scope.kind === "project" || scope.kind === "app";
}

const assignmentFields = {
  id: idSchema("asg"),
  role: agentRoleSchema,
  scope: assignmentScopeOutputSchema,
  state: assignmentStateSchema,
  pause_reason: pauseReasonOutputSchema.nullable(),
  revision: positiveRevisionSchema,
};

export const assignmentRecordSchema = z.object(assignmentFields).refine(
  (value) =>
    scopeMatchesRole(value.role, value.scope as AssignmentScope) &&
    (value.pause_reason !== null) === (value.state === "paused"),
  { message: "assignment shape is not coupled" },
);

export type Assignment = z.infer<typeof assignmentRecordSchema>;
