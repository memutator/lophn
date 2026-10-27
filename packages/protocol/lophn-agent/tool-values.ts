import { z } from "zod";
import { atSchema, durationMsSchema, sha256Schema } from "../base/values.ts";
import { idSchema } from "../base/ids.ts";

const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const order = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nonempty = z.string().regex(/\S/);
const safeCode = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
const hash = sha256Schema;

const TOOL_EFFECTS = ["read", "write", "external"] as const;
export const toolEffectSchema = z.enum(TOOL_EFFECTS);
export type ToolEffect = z.infer<typeof toolEffectSchema>;

const TOOL_OUTCOME_KINDS = [
  "success",
  "failure",
  "not_executed",
  "uncertain",
] as const;
const toolOutcomeKindSchema = z.enum(TOOL_OUTCOME_KINDS);

// 내장 tool 이름과 입력 schema는 다른 최상위가 부르지 않으므로 여기 두지 않는다.
export const toolNameSchema = nonempty.max(64);

// tool 줄에 보이는 분류와 제목. 저장하지 않고 ToolCallStarted·ListToolCalls를 낼 때 만들며
// 지금의 redaction을 거친다. title이 한 줄이고 120자에서 잘라 `…`를 붙이는 것은 만드는 쪽이 지킨다.
export const TOOL_CALL_CATEGORIES = [
  "read",
  "list",
  "search",
  "command",
  "web",
  "other",
] as const;
export type ToolCallCategory = (typeof TOOL_CALL_CATEGORIES)[number];
export const toolCallDisplaySchema = z.object({
  category: z.enum(TOOL_CALL_CATEGORIES),
  title: z.string().min(1),
});
export type ToolCallDisplay = z.infer<typeof toolCallDisplaySchema>;

const TOOL_DECISIONS = ["allow", "ask", "deny"] as const;

const toolDecisionFields = {
  decision: z.enum(TOOL_DECISIONS),
  reason: nonempty,
  assignment_revision: revision.nullable(),
  // turn 기준이 고정한 resolved agent의 hash다. turn을 읽지 못했을 때만 null이다.
  agent_hash: hash.nullable(),
};

export const toolDecisionSchema = z.strictObject(toolDecisionFields);
const toolDecisionOutputSchema = z.object(toolDecisionFields);

const toolOutcomeFields = {
  kind: toolOutcomeKindSchema,
  code: safeCode,
};

export const toolOutcomeSchema = z.strictObject(toolOutcomeFields);
const toolOutcomeOutputSchema = z.object(toolOutcomeFields);
export type ToolOutcome = z.infer<typeof toolOutcomeOutputSchema>;

const appToolFields = {
  app: idSchema("app"),
  release: idSchema("rel"),
  command: nonempty,
  declaration_hash: hash,
  definition_hash: hash,
  permission_basis: z.strictObject({
    grant: idSchema("grt"),
    scope: nonempty,
    basis_seq: z.string().regex(/^[0-9]+$/),
  }),
  // 이 값이 있으면 tool_calls.app_tool로 묶이고 revert가 앱의 선언된 revert command를 부른다.
  revert_command: z.string().min(1).optional(),
};

const appToolBindingSchema = z.strictObject(appToolFields);
const appToolBindingOutputSchema = z.object({
  ...appToolFields,
  permission_basis: z.object({
    grant: idSchema("grt"),
    scope: nonempty,
    basis_seq: z.string().regex(/^[0-9]+$/),
  }),
});

// 외부 이름은 ext_<server>_<tool>, 영문·숫자·밑줄·하이픈 64자 이하.
const canonicalExternalToolSchema = z
  .string()
  .regex(/^ext_[A-Za-z0-9_-]{1,60}$/);

const extensionFields = {
  server_name: nonempty.max(64),
  configuration_revision: revision,
  original_tool: nonempty.max(64),
  canonical_name: canonicalExternalToolSchema,
};

export const toolExtensionSchema = z.strictObject(extensionFields);
const toolExtensionOutputSchema = z.object(extensionFields);

const sourceFields = {
  target: nonempty,
  version: nonempty.nullable(),
  range: nonempty.nullable(),
  original_bytes: order.nullable(),
  original_lines: order.nullable(),
  omitted_count: order.nullable(),
};

const toolResultSourceSchema = z.strictObject(sourceFields);
const toolResultSourceOutputSchema = z.object(sourceFields);

const continuationFields = {
  has_more: z.boolean(),
  read_next: nonempty.nullable(),
};

const toolResultContinuationSchema = z.strictObject(continuationFields);
const toolResultContinuationOutputSchema = z.object(continuationFields);

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
const toolResultOutputSchema = z.object({
  ...resultFields,
  source: toolResultSourceOutputSchema.nullable(),
  continuation: toolResultContinuationOutputSchema.nullable(),
});
export type ToolResult = z.infer<typeof toolResultOutputSchema>;

const TOOL_CALL_STATES = ["requested", "started", "finished"] as const;

const toolCallFields = {
  id: idSchema("tcl"),
  turn: idSchema("trn"),
  model_call: idSchema("mcl"),
  response_key: nonempty.max(128),
  response_order: order,
  tool: toolNameSchema,
  definition_revision: nonempty,
  effect: toolEffectSchema,
  app_tool: appToolBindingSchema.nullable(),
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
    return (
      value.started_at === null &&
      value.finished_at === null &&
      value.outcome === null
    );
  }
  if (value.state === "started") {
    return (
      value.started_at !== null &&
      value.finished_at === null &&
      value.outcome === null
    );
  }
  if (value.finished_at === null || value.outcome === null) return false;
  if (value.outcome.kind === "success" && value.output === null) return false;
  if (value.outcome.kind === "not_executed" && value.output !== null) {
    return false;
  }
  return value.started_at === null || value.started_at <= value.finished_at;
}

const toolCallOutputFields = {
  ...toolCallFields,
  app_tool: appToolBindingOutputSchema.nullable(),
  extension: toolExtensionOutputSchema.nullable(),
  decision: toolDecisionOutputSchema.nullable(),
  outcome: toolOutcomeOutputSchema.nullable(),
};

export const toolCallOutputSchema = z
  .object(toolCallOutputFields)
  .refine(callShape, {
    message: "tool call state, outcome and retry do not agree",
  });
export type ToolCall = z.infer<typeof toolCallOutputSchema>;

// 목록에 실어 보내는 call 하나. display는 저장하지 않는다.
export const listedToolCallOutputSchema = z
  .object({
    ...toolCallOutputFields,
    display: toolCallDisplaySchema,
  })
  .refine(callShape, {
    message: "tool call state, outcome and retry do not agree",
  });
export type ListedToolCall = z.infer<typeof listedToolCallOutputSchema>;
