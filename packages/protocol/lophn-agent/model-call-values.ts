import { z } from "zod";
import { atSchema, durationMsSchema, sha256Schema } from "../base/values.ts";
import { idSchema } from "../base/ids.ts";
import { jsonObjectSchema } from "../base/json-values.ts";
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
const positiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const nonnegativeIntegerSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
const httpStatusSchema = z.number().int().min(100).max(599);

const MODEL_USE_KINDS = ["judgment", "organizing"] as const;
const MODEL_PURPOSES = [
  "judgment",
  "title_summary",
  "conversation_compression",
] as const;
// credential이 provider에 하나라 같은 provider·model의 다른 credential로 옮기는 시도는 없다.
const ATTEMPT_KINDS = ["initial", "retry"] as const;
const MODEL_OUTCOMES = [
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
const BILLING_ROUTES = [
  "api",
  "subscription",
  "extra_usage",
  "unknown",
] as const;

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
const tokenUsageOutputSchema = z.object(tokenFields);
export type TokenUsage = z.infer<typeof tokenUsageSchema>;

const costFields = {
  kind: z.enum(COST_KINDS),
  amount: nonnegativeDecimalSchema.nullable(),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .nullable(),
  basis: jsonObjectSchema.nullable(),
  confirmed_at: atSchema.nullable(),
};

function costShape(value: {
  kind: (typeof COST_KINDS)[number];
  amount: string | null;
  currency: string | null;
  basis: unknown;
}): boolean {
  const priced =
    value.kind === "reported" ||
    value.kind === "estimated" ||
    value.kind === "free";
  const amount = priced ? value.amount !== null : value.amount === null;
  const currency = (value.amount !== null) === (value.currency !== null);
  const basis = value.kind !== "estimated" || value.basis !== null;
  const free = value.kind !== "free" || value.amount === "0";
  return amount && currency && basis && free;
}

const callCostSchema = z.strictObject(costFields).refine(costShape, {
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

// 실패를 어느 판정 길로 가렸는가. code가 unknown이 되는 길을 기록으로 가르려고 둔다.
export const VERDICT_PATHS = [
  "structured_code",
  "http_status",
  "body_message",
  "unclassified",
  "stream_failed_without_code",
  "unparseable_success_body",
  "connection_failed",
  "idle_timeout",
] as const;

// secret이 아닌 응답 증거다. header는 allow-list로 고른 값만 담고 본문은 한 글자도 담지 않는다.
const evidenceFields = {
  verdict_path: z.enum(VERDICT_PATHS).nullable(),
  content_type: nonblankSchema.nullable(),
  request_id: nonblankSchema.nullable(),
  // 처음 본 모르는 SSE event type 몇 개.
  unknown_events: z.array(nonblankSchema).max(3),
};
const outcomeFields = {
  kind: z.enum(MODEL_OUTCOMES),
  code: providerFailureSchema.nullable(),
  retry_at: atSchema.nullable(),
  finish_reason: nonblankSchema.nullable(),
  http_status: httpStatusSchema.nullable(),
  provider_code: nonblankSchema.nullable(),
  // 옛 기록에는 없다.
  evidence: z.strictObject(evidenceFields).optional(),
};

function outcomeShape(value: {
  kind: (typeof MODEL_OUTCOMES)[number];
  code: string | null;
  retry_at: string | null;
}): boolean {
  return (
    (value.kind === "failed") === (value.code !== null) &&
    (value.retry_at === null || value.code === "temporary")
  );
}

export const modelOutcomeSchema = z
  .strictObject(outcomeFields)
  .refine(outcomeShape, {
    message: "model outcome and failure code do not agree",
  });
const modelOutcomeOutputSchema = z.object(outcomeFields).refine(outcomeShape, {
  message: "model outcome and failure code do not agree",
});
export type ModelOutcome = z.infer<typeof modelOutcomeSchema>;

const limitFields = {
  context_limit: positiveIntegerSchema,
  input_limit: positiveIntegerSchema,
  output_limit: positiveIntegerSchema,
  supports_tools: z.boolean(),
};
const callModelLimitsSchema = z.strictObject(limitFields);
const callModelLimitsOutputSchema = z.object(limitFields);

// option 축 id마다 고른 값이다. requested는 agent가 고른 값이고 applied는 맞춤과 기본값을 채운 뒤 요청에
// 실제로 실은 값이다. 둘이 다르면 맞춘 것이 기록에 남는다.
const optionMapSchema = z.record(nonblankSchema, nonblankSchema);
const callOptionValuesFields = {
  requested: optionMapSchema,
  applied: optionMapSchema,
};
const callOptionValuesSchema = z.strictObject(callOptionValuesFields);
const callOptionValuesOutputSchema = z.object(callOptionValuesFields);

const callModelFields = {
  provider: idSchema("pvd"),
  name: nonblankSchema,
  protocol: providerProtocolSchema,
  // 호출 때 고정한 provider의 credential 판. 인증 없음(custom provider의 loopback)만 null이다.
  credential_revision: positiveIntegerSchema.nullable(),
  option_values: callOptionValuesSchema,
  limits: callModelLimitsSchema,
  catalog_basis: jsonObjectSchema,
  price_basis: priceBasisSchema.nullable(),
  billing_route: z.enum(BILLING_ROUTES),
};

const callModelSchema = z.strictObject(callModelFields);
const callModelOutputSchema = z.object({
  ...callModelFields,
  option_values: callOptionValuesOutputSchema,
  limits: callModelLimitsOutputSchema,
  price_basis: priceBasisOutputSchema.nullable(),
});
export type CallModel = z.infer<typeof callModelSchema>;

const modelCallFields = {
  id: idSchema("mcl"),
  turn: idSchema("trn").nullable(),
  session: idSchema("ses").nullable(),
  model_use: z.enum(MODEL_USE_KINDS).nullable(),
  agent_hash: sha256Schema.nullable(),
  purpose: z.enum(MODEL_PURPOSES),
  attempt_kind: z.enum(ATTEMPT_KINDS),
  attempt_order: positiveIntegerSchema,
  retry_of: idSchema("mcl").nullable(),
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
  turn: string | null;
  session: string | null;
  model_use: string | null;
  agent_hash: string | null;
  purpose: (typeof MODEL_PURPOSES)[number];
  attempt_kind: (typeof ATTEMPT_KINDS)[number];
  retry_of: string | null;
  output: string | null;
  state: "started" | "finished";
  finished_at: string | null;
  outcome: { kind: (typeof MODEL_OUTCOMES)[number] } | null;
}): boolean {
  const attached =
    value.turn !== null &&
    value.session !== null &&
    value.model_use !== null &&
    value.agent_hash !== null;
  // Compact의 요약 call은 turn과 agent 대신 session을 가리킨다. turn이 없는 session도 요약한다.
  const summary =
    value.turn === null &&
    value.session !== null &&
    value.model_use === "organizing" &&
    value.agent_hash === null &&
    value.purpose === "conversation_compression";
  const finished = value.state === "finished";
  return (
    (attached || summary) &&
    (value.attempt_kind === "retry") === (value.retry_of !== null) &&
    finished === (value.finished_at !== null && value.outcome !== null) &&
    (value.output === null || finished) &&
    (value.outcome?.kind === "partial" ? value.output !== null : true)
  );
}

export const modelCallRecordSchema = z
  .object({
    ...modelCallFields,
    model: callModelOutputSchema,
    outcome: modelOutcomeOutputSchema.nullable(),
    usage: tokenUsageOutputSchema,
    cost: callCostOutputSchema,
  })
  .refine(modelCallShape, {
    message: "model call purpose, attempt and outcome do not agree",
  });
export type ModelCallRecord = z.infer<typeof modelCallRecordSchema>;
