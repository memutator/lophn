import { z } from "zod";
import {
  atSchema,
  durationMsSchema,
  idSchema,
  sha256Schema,
} from "../platform/mod.ts";

const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const order = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nonempty = z.string().regex(/\S/);
const safeCode = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const hash = sha256Schema;

export const TOOL_EFFECTS = ["read", "write", "external"] as const;
export const toolEffectSchema = z.enum(TOOL_EFFECTS);
export type ToolEffect = z.infer<typeof toolEffectSchema>;

export const TOOL_OUTCOME_KINDS = [
  "success",
  "failure",
  "not_executed",
  "uncertain",
] as const;
export const toolOutcomeKindSchema = z.enum(TOOL_OUTCOME_KINDS);

// 내장 tool 이름과 입력 schema는 다른 최상위가 부르지 않으므로 여기 두지 않는다.
export const toolNameSchema = nonempty.max(64);

export const TOOL_DECISIONS = ["allow", "ask", "deny"] as const;
export const toolDecisionEffectSchema = z.enum([
  "read",
  "reversible_write",
  "irreversible",
]);

const toolDecisionFields = {
  decision: z.enum(TOOL_DECISIONS),
  reason: nonempty,
  effect: toolDecisionEffectSchema.nullable(),
  assignment_revision: revision.nullable(),
  preset_revision: revision.nullable(),
  contract_revision: nonempty.nullable(),
  comparison_basis: z.json().nullable(),
  approval: idSchema("apr").nullable(),
};

function decisionShape(value: {
  decision: "allow" | "ask" | "deny";
  approval: string | null;
}) {
  return value.decision === "deny" ? value.approval === null : true;
}

export const toolDecisionSchema = z.strictObject(toolDecisionFields).refine(
  decisionShape,
  { message: "deny carries no approval" },
);
export const toolDecisionOutputSchema = z.object(toolDecisionFields).refine(
  decisionShape,
  { message: "deny carries no approval" },
);
export type ToolDecision = z.infer<typeof toolDecisionOutputSchema>;

const toolOutcomeFields = {
  kind: toolOutcomeKindSchema,
  code: safeCode,
};

export const toolOutcomeSchema = z.strictObject(toolOutcomeFields);
export const toolOutcomeOutputSchema = z.object(toolOutcomeFields);
export type ToolOutcome = z.infer<typeof toolOutcomeOutputSchema>;

const appCommandFields = {
  app: idSchema("app"),
  release: idSchema("rel"),
  command: nonempty,
  blueprint_hash: hash,
  definition_hash: hash,
  permission_basis: z.strictObject({
    grant: idSchema("grt"),
    scope: nonempty,
    basis_seq: z.string().regex(/^[0-9]+$/),
  }),
  context_binding: z.record(z.string(), z.json()).nullable(),
};

export const appCommandBindingSchema = z.strictObject(appCommandFields);
export const appCommandBindingOutputSchema = z.object({
  ...appCommandFields,
  permission_basis: z.object({
    grant: idSchema("grt"),
    scope: nonempty,
    basis_seq: z.string().regex(/^[0-9]+$/),
  }),
  context_binding: z.record(z.string(), z.json()).nullable(),
});
export type AppCommandBinding = z.infer<typeof appCommandBindingOutputSchema>;

// 외부 이름은 ext_<server>_<tool>, 영문·숫자·밑줄·하이픈 64자 이하.
export const canonicalExternalToolSchema = z.string().regex(
  /^ext_[A-Za-z0-9_-]{1,60}$/,
);

const extensionFields = {
  server_name: nonempty.max(64),
  configuration_revision: revision,
  original_tool: nonempty.max(64),
  canonical_name: canonicalExternalToolSchema,
};

export const toolExtensionSchema = z.strictObject(extensionFields);
export const toolExtensionOutputSchema = z.object(extensionFields);
export type ToolExtension = z.infer<typeof toolExtensionOutputSchema>;

const sourceFields = {
  target: nonempty,
  version: nonempty.nullable(),
  range: nonempty.nullable(),
  original_bytes: order.nullable(),
  original_lines: order.nullable(),
  omitted_count: order.nullable(),
};

export const toolResultSourceSchema = z.strictObject(sourceFields);
export const toolResultSourceOutputSchema = z.object(sourceFields);

const continuationFields = {
  has_more: z.boolean(),
  read_next: nonempty.nullable(),
};

export const toolResultContinuationSchema = z.strictObject(continuationFields);
export const toolResultContinuationOutputSchema = z.object(continuationFields);

const resultFields = {
  status: toolOutcomeKindSchema,
  summary: nonempty.max(400),
  content: z.json().nullable(),
  complete: z.boolean(),
  source: toolResultSourceSchema.nullable(),
  continuation: toolResultContinuationSchema.nullable(),
  pending: z.array(nonempty).max(32),
};

export const toolResultSchema = z.strictObject(resultFields);
export const toolResultOutputSchema = z.object({
  ...resultFields,
  source: toolResultSourceOutputSchema.nullable(),
  continuation: toolResultContinuationOutputSchema.nullable(),
});
export type ToolResult = z.infer<typeof toolResultOutputSchema>;

export const TOOL_CALL_STATES = ["requested", "started", "finished"] as const;

const toolCallFields = {
  id: idSchema("tcl"),
  run: idSchema("run"),
  model_call: idSchema("mcl"),
  response_key: nonempty.max(128),
  response_order: order,
  tool: toolNameSchema,
  definition_revision: nonempty,
  effect: toolEffectSchema,
  app_command: appCommandBindingSchema.nullable(),
  confirm: z.boolean(),
  extension: toolExtensionSchema.nullable(),
  input: hash,
  output: hash.nullable(),
  retry_of: idSchema("tcl").nullable(),
  attempt: z.union([z.literal(0), z.literal(1)]),
  retry_at: atSchema.nullable(),
  decision: toolDecisionSchema.nullable(),
  state: z.enum(TOOL_CALL_STATES),
  started_at: atSchema.nullable(),
  finished_at: atSchema.nullable(),
  duration_ms: durationMsSchema.nullable(),
  outcome: toolOutcomeSchema.nullable(),
};

type Call = {
  state: "requested" | "started" | "finished";
  started_at: string | null;
  finished_at: string | null;
  outcome: { kind: string } | null;
  output: string | null;
  attempt: 0 | 1;
  retry_of: string | null;
  retry_at: string | null;
};

function callShape(value: Call) {
  if (value.attempt === 1 && value.retry_of === null) return false;
  if (value.attempt === 0 && value.retry_of !== null) return false;
  if (value.retry_at !== null && value.attempt !== 1) return false;
  if (value.state === "requested") {
    return value.started_at === null && value.finished_at === null &&
      value.outcome === null;
  }
  if (value.state === "started") {
    return value.started_at !== null && value.finished_at === null &&
      value.outcome === null;
  }
  if (value.finished_at === null || value.outcome === null) return false;
  if (value.outcome.kind === "success" && value.output === null) return false;
  if (value.outcome.kind === "not_executed" && value.output !== null) {
    return false;
  }
  return value.started_at === null || value.started_at <= value.finished_at;
}

export const toolCallSchema = z.strictObject(toolCallFields).refine(callShape, {
  message: "tool call state, outcome and retry do not agree",
});
export const toolCallOutputSchema = z.object({
  ...toolCallFields,
  app_command: appCommandBindingOutputSchema.nullable(),
  extension: toolExtensionOutputSchema.nullable(),
  decision: toolDecisionOutputSchema.nullable(),
  outcome: toolOutcomeOutputSchema.nullable(),
}).refine(callShape, {
  message: "tool call state, outcome and retry do not agree",
});
export type ToolCall = z.infer<typeof toolCallOutputSchema>;
