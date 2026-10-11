import { z } from "zod";
import {
  atSchema,
  durationMsSchema,
  idSchema,
  jsonObjectSchema,
  sha256Schema,
} from "../platform/mod.ts";
import {
  providerFailureSchema,
  providerProtocolSchema,
} from "./provider-values.ts";
import {
  nonnegativeDecimalSchema,
  priceBasisOutputSchema,
  priceBasisSchema,
} from "./resolved-model.ts";

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const positiveIntegerSchema = z.number().int().positive().max(
  Number.MAX_SAFE_INTEGER,
);
const nonnegativeIntegerSchema = z.number().int().nonnegative().max(
  Number.MAX_SAFE_INTEGER,
);
const httpStatusSchema = z.number().int().min(100).max(599);

export const MODEL_USE_KINDS = ["judgment", "organizing"] as const;
export const MODEL_PURPOSES = [
  "judgment",
  "title_summary",
  "conversation_compression",
  "connection_test",
] as const;
export const ATTEMPT_KINDS = ["initial", "retry", "credential_change"] as const;
export const MODEL_OUTCOMES = [
  "complete",
  "partial",
  "failed",
  "cancelled",
  "uncertain",
] as const;
export const COST_KINDS = [
  "reported",
  "estimated",
  "subscription",
  "free",
  "unknown",
] as const;
export const BILLING_ROUTES = [
  "api",
  "subscription",
  "extra_usage",
  "unknown",
] as const;

const testRequestFields = {
  command_key: nonblankSchema,
  test_kind: z.enum(["text", "tool_call"]),
};
export const modelCallTestRequestSchema = z.strictObject(testRequestFields);
export const modelCallTestRequestOutputSchema = z.object(testRequestFields);

const tokenFields = {
  input: nonnegativeIntegerSchema.nullable(),
  output: nonnegativeIntegerSchema.nullable(),
  cache_read: nonnegativeIntegerSchema.nullable(),
  cache_write: nonnegativeIntegerSchema.nullable(),
  reasoning: nonnegativeIntegerSchema.nullable(),
  cache_in_input: z.boolean().nullable(),
  reasoning_in_output: z.boolean().nullable(),
  definition_revision: nonblankSchema,
};
export const tokenUsageSchema = z.strictObject(tokenFields);
export const tokenUsageOutputSchema = z.object(tokenFields);
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

const costFields = {
  kind: z.enum(COST_KINDS),
  amount: nonnegativeDecimalSchema.nullable(),
  currency: z.string().regex(/^[A-Z]{3}$/).nullable(),
  basis: jsonObjectSchema.nullable(),
  confirmed_at: atSchema.nullable(),
};

function costShape(value: {
  kind: (typeof COST_KINDS)[number];
  amount: string | null;
  currency: string | null;
  basis: unknown;
}): boolean {
  const priced = value.kind === "reported" || value.kind === "estimated" ||
    value.kind === "free";
  const amount = priced ? value.amount !== null : value.amount === null;
  const currency = (value.amount !== null) === (value.currency !== null);
  const basis = value.kind !== "estimated" || value.basis !== null;
  const free = value.kind !== "free" || value.amount === "0";
  return amount && currency && basis && free;
}

export const callCostSchema = z.strictObject(costFields).refine(costShape, {
  message: "cost kind, amount and basis do not agree",
});
export const callCostOutputSchema = z.object(costFields).refine(costShape, {
  message: "cost kind, amount and basis do not agree",
});
export type CallCost = z.infer<typeof callCostSchema>;

export const initialCallCostSchema = callCostSchema.refine(
  (value) => value.kind === "unknown",
  { message: "a started call cost is unknown" },
);

const outcomeFields = {
  kind: z.enum(MODEL_OUTCOMES),
  code: providerFailureSchema.nullable(),
  retry_at: atSchema.nullable(),
  finish_reason: nonblankSchema.nullable(),
  http_status: httpStatusSchema.nullable(),
  provider_code: nonblankSchema.nullable(),
};

function outcomeShape(value: {
  kind: (typeof MODEL_OUTCOMES)[number];
  code: string | null;
  retry_at: string | null;
}): boolean {
  return (value.kind === "failed") === (value.code !== null) &&
    (value.retry_at === null || value.code === "temporary");
}

export const modelOutcomeSchema = z.strictObject(outcomeFields).refine(
  outcomeShape,
  { message: "model outcome and failure code do not agree" },
);
export const modelOutcomeOutputSchema = z.object(outcomeFields).refine(
  outcomeShape,
  { message: "model outcome and failure code do not agree" },
);
export type ModelOutcome = z.infer<typeof modelOutcomeSchema>;

const limitFields = {
  context_limit: positiveIntegerSchema,
  input_limit: positiveIntegerSchema,
  output_limit: positiveIntegerSchema,
  supports_tools: z.boolean(),
};
export const callModelLimitsSchema = z.strictObject(limitFields);
export const callModelLimitsOutputSchema = z.object(limitFields);

// option 축 id마다 고른 값이다. requested는 agent가 고른 값이고 applied는 맞춤과 기본값을 채운 뒤 요청에
// 실제로 실은 값이다. 둘이 다르면 맞춘 것이 기록에 남는다.
const optionMapSchema = z.record(nonblankSchema, nonblankSchema);
const callOptionValuesFields = {
  requested: optionMapSchema,
  applied: optionMapSchema,
};
export const callOptionValuesSchema = z.strictObject(callOptionValuesFields);
export const callOptionValuesOutputSchema = z.object(callOptionValuesFields);

const callModelFields = {
  provider: idSchema("pvd"),
  name: nonblankSchema,
  protocol: providerProtocolSchema,
  credential_key: nonblankSchema.nullable(),
  credential_revision: positiveIntegerSchema.nullable(),
  option_values: callOptionValuesSchema,
  limits: callModelLimitsSchema,
  catalog_basis: jsonObjectSchema,
  price_basis: priceBasisSchema.nullable(),
  billing_route: z.enum(BILLING_ROUTES),
};

function callModelShape(value: {
  credential_key: string | null;
  credential_revision: number | null;
}): boolean {
  return (value.credential_key === null) ===
    (value.credential_revision === null);
}

export const callModelSchema = z.strictObject(callModelFields).refine(
  callModelShape,
  { message: "credential key and revision must be recorded together" },
);
export const callModelOutputSchema = z.object({
  ...callModelFields,
  option_values: callOptionValuesOutputSchema,
  limits: callModelLimitsOutputSchema,
  price_basis: priceBasisOutputSchema.nullable(),
}).refine(callModelShape, {
  message: "credential key and revision must be recorded together",
});
export type CallModel = z.infer<typeof callModelSchema>;

const modelCallFields = {
  id: idSchema("mcl"),
  run: idSchema("run").nullable(),
  session: idSchema("ses").nullable(),
  model_use: z.enum(MODEL_USE_KINDS).nullable(),
  agent_hash: sha256Schema.nullable(),
  purpose: z.enum(MODEL_PURPOSES),
  test_request: modelCallTestRequestSchema.nullable(),
  attempt_kind: z.enum(ATTEMPT_KINDS),
  attempt_order: positiveIntegerSchema,
  retry_of: idSchema("mcl").nullable(),
  credential_change_of: idSchema("mcl").nullable(),
  model: callModelSchema,
  input: sha256Schema,
  context_basis: sha256Schema,
  output: sha256Schema.nullable(),
  state: z.enum(["started", "finished"]),
  started_at: atSchema,
  finished_at: atSchema.nullable(),
  duration_ms: durationMsSchema.nullable(),
  first_output_ms: durationMsSchema.nullable(),
  outcome: modelOutcomeSchema.nullable(),
  usage: tokenUsageSchema,
  cost: callCostSchema,
};

function modelCallShape(value: {
  run: string | null;
  session: string | null;
  model_use: string | null;
  agent_hash: string | null;
  purpose: (typeof MODEL_PURPOSES)[number];
  test_request: unknown;
  attempt_kind: (typeof ATTEMPT_KINDS)[number];
  retry_of: string | null;
  credential_change_of: string | null;
  output: string | null;
  state: "started" | "finished";
  finished_at: string | null;
  outcome: { kind: (typeof MODEL_OUTCOMES)[number] } | null;
}): boolean {
  const test = value.purpose === "connection_test";
  const attached = value.run !== null && value.session !== null &&
    value.model_use !== null && value.agent_hash !== null &&
    value.test_request === null;
  const detached = value.run === null && value.model_use === null &&
    value.agent_hash === null && value.test_request !== null;
  const finished = value.state === "finished";
  return (test ? detached : attached) &&
    (value.attempt_kind === "retry") === (value.retry_of !== null) &&
    (value.attempt_kind === "credential_change") ===
      (value.credential_change_of !== null) &&
    finished === (value.finished_at !== null && value.outcome !== null) &&
    (value.output === null || finished) &&
    (value.outcome?.kind === "partial" ? value.output !== null : true);
}

export const modelCallRecordSchema = z.object({
  ...modelCallFields,
  test_request: modelCallTestRequestOutputSchema.nullable(),
  model: callModelOutputSchema,
  outcome: modelOutcomeOutputSchema.nullable(),
  usage: tokenUsageOutputSchema,
  cost: callCostOutputSchema,
}).refine(modelCallShape, {
  message: "model call purpose, attempt and outcome do not agree",
});
export type ModelCallRecord = z.infer<typeof modelCallRecordSchema>;

export const MODEL_CALL_TEST_TIMEOUT_MS = 30_000;
