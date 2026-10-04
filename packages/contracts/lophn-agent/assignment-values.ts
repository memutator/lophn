import { z } from "zod";
import { atSchema, idSchema } from "../platform/mod.ts";
import { ASSIGNMENT_STATES } from "./instructions.ts";
import { positiveRevisionSchema } from "./run-values.ts";
import { agentRoleSchema, appCommandKeySchema } from "./scope.ts";

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

const PAUSE_KINDS = [
  "user",
  "consecutive_failures",
  "scope_archived",
  "output_archived",
] as const;

const pauseFields = {
  kind: z.enum(PAUSE_KINDS),
  detail: z.string().refine((value) => value.trim().length > 0, {
    message: "pause detail is blank",
  }),
  runs: z.array(idSchema("run")),
  target: z.string().nullable(),
};

function pauseShape(value: {
  kind: string;
  runs: readonly string[];
  target: string | null;
}): boolean {
  if (value.kind === "consecutive_failures") {
    return value.runs.length === 3 &&
      new Set(value.runs).size === 3 && value.target === null;
  }
  if (value.runs.length !== 0) return false;
  if (value.kind === "scope_archived" || value.kind === "output_archived") {
    return value.target !== null && value.target.trim().length > 0;
  }
  return value.target === null;
}

export const pauseReasonSchema = z.strictObject(pauseFields).refine(
  pauseShape,
  { message: "pause reason is not coupled" },
);
export const pauseReasonOutputSchema = z.object(pauseFields).refine(
  pauseShape,
  { message: "pause reason is not coupled" },
);

const outputFields = {
  document: idSchema("doc"),
  content: z.string().refine((value) => value.trim().length > 0, {
    message: "output content is blank",
  }),
};

export const outputDeclarationSchema = z.strictObject(outputFields);
export const outputDeclarationOutputSchema = z.object(outputFields);

const commandFields = {
  app: idSchema("app"),
  command: appCommandKeySchema,
};

export const readCommandSchema = z.strictObject(commandFields);
export const readCommandOutputSchema = z.object(commandFields);

export type ReadCommand = z.infer<typeof readCommandSchema>;

const scheduleFields = {
  first_at: atSchema,
  every_ms: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
};

export const scheduleSchema = z.strictObject(scheduleFields);
export const scheduleOutputSchema = z.object(scheduleFields);

export type Schedule = z.infer<typeof scheduleSchema>;

function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

function commandKey(command: ReadCommand): string {
  return `${command.app}\0${command.command}`;
}

const bodyFields = {
  preset: idSchema("pst"),
  preset_revision: positiveRevisionSchema,
  scope: assignmentScopeSchema,
  outputs: z.array(outputDeclarationSchema),
  read_apps: z.array(idSchema("app")),
  read_commands: z.array(readCommandSchema),
  schedule: scheduleSchema.nullable(),
  approval: idSchema("apr").nullable(),
};

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

function bodyShape(value: {
  scope: AssignmentScope;
  outputs: readonly { document: string }[];
  read_apps: readonly string[];
  read_commands: readonly ReadCommand[];
  schedule: Schedule | null;
  approval: string | null;
}, operator: boolean): boolean {
  const documents = value.outputs.map((output) => output.document);
  const commands = value.read_commands;
  const listed = commands.every((command) =>
    value.read_apps.includes(command.app)
  );
  if (!unique(documents) || !unique(value.read_apps)) return false;
  if (!unique(commands.map(commandKey)) || !listed) return false;
  if (!operator) {
    return value.outputs.length === 0 && value.read_apps.length === 0 &&
      commands.length === 0 && value.schedule === null &&
      value.approval === null;
  }
  return value.outputs.length >= 1 && value.schedule !== null &&
    value.approval !== null;
}

const assignmentFields = {
  id: idSchema("asg"),
  role: agentRoleSchema,
  ...bodyFields,
  state: assignmentStateSchema,
  pause_reason: pauseReasonOutputSchema.nullable(),
  last_due_at: atSchema.nullable(),
  revision: positiveRevisionSchema,
};

function assignmentShape(value: {
  role: z.infer<typeof agentRoleSchema>;
  scope: AssignmentScope;
  outputs: readonly { document: string }[];
  read_apps: readonly string[];
  read_commands: readonly ReadCommand[];
  schedule: Schedule | null;
  approval: string | null;
  state: string;
  pause_reason: unknown;
  last_due_at: string | null;
}): boolean {
  if (!scopeMatchesRole(value.role, value.scope)) return false;
  const operator = value.role === "operator";
  if ((value.pause_reason !== null) !== (value.state === "paused")) {
    return false;
  }
  if (!operator && value.last_due_at !== null) return false;
  return bodyShape(value, operator);
}

export const assignmentRecordSchema = z.object({
  ...assignmentFields,
  scope: assignmentScopeOutputSchema,
  outputs: z.array(outputDeclarationOutputSchema),
  read_commands: z.array(readCommandOutputSchema),
  schedule: scheduleOutputSchema.nullable(),
  pause_reason: pauseReasonOutputSchema.nullable(),
}).refine(assignmentShape, { message: "assignment shape is not coupled" });

export type Assignment = z.infer<typeof assignmentRecordSchema>;

const bundleFields = {
  draft_version: idSchema("ver"),
  assignment: idSchema("asg").nullable(),
  expected_assignment_revision: positiveRevisionSchema.nullable(),
  preset: idSchema("pst"),
  preset_revision: positiveRevisionSchema,
  preset_definition: z.string().regex(/^[0-9a-f]{64}$/),
  scope: assignmentScopeSchema,
  outputs: z.array(outputDeclarationSchema).min(1),
  read_apps: z.array(idSchema("app")),
  read_commands: z.array(readCommandSchema),
  schedule: scheduleSchema,
  reason: z.string().refine((value) => value.trim().length > 0, {
    message: "reason is blank",
  }),
};

function bundleShape(value: {
  assignment: string | null;
  expected_assignment_revision: number | null;
  scope: AssignmentScope;
  outputs: readonly { document: string }[];
  read_apps: readonly string[];
  read_commands: readonly ReadCommand[];
}): boolean {
  const creating = value.assignment === null;
  if (creating !== (value.expected_assignment_revision === null)) return false;
  if (value.scope.kind === "all") return false;
  return unique(value.outputs.map((output) => output.document)) &&
    unique(value.read_apps) &&
    unique(value.read_commands.map(commandKey)) &&
    value.read_commands.every((command) =>
      value.read_apps.includes(command.app)
    );
}

// preset_definition은 preset 판 전체 blob의 sha256이다. preset ID가 아니다.
export const operatorApprovalBundleSchema = z.strictObject(bundleFields)
  .refine(bundleShape, { message: "operator approval bundle is not coupled" });

export const operatorApprovalBundleOutputSchema = z.object({
  ...bundleFields,
  scope: assignmentScopeOutputSchema,
  outputs: z.array(outputDeclarationOutputSchema).min(1),
  read_commands: z.array(readCommandOutputSchema),
  schedule: scheduleOutputSchema,
}).refine(bundleShape, { message: "operator approval bundle is not coupled" });

export type OperatorApprovalBundle = z.infer<
  typeof operatorApprovalBundleSchema
>;
