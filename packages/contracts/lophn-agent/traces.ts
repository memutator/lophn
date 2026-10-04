import { z } from "zod";
import { COST_KINDS, tokenUsageSchema } from "./model-call-values.ts";
import {
  atSchema,
  defineCommand,
  defineRead,
  durationMsSchema,
  idSchema,
  seqSchema,
  sha256Schema,
  withReadCommon,
} from "../platform/mod.ts";
import { agentRoleSchema } from "./scope.ts";
import { runOutcomeOutputSchema } from "./run-values.ts";

const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const nonempty = z.string().regex(/\S/);
const hash = sha256Schema;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

const TRACE_CONTENT_KINDS = [
  "message",
  "model_input",
  "model_output",
  "tool_input",
  "tool_output",
] as const;

const traceTargetSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("run"), run: idSchema("run") }),
  z.strictObject({ kind: z.literal("session"), session: idSchema("ses") }),
  z.strictObject({
    kind: z.literal("model_call"),
    model_call: idSchema("mcl"),
  }),
]);

const missingSchema = z.strictObject({
  kind: z.enum(["body", "record", "source"]),
  reference: nonempty.max(200),
  reason: nonempty.max(200),
});

const timesSchema = z.strictObject({
  wall_ms: durationMsSchema,
  active_ms: durationMsSchema,
  waiting_ms: durationMsSchema,
  model_ms: durationMsSchema,
  first_output_ms: durationMsSchema.nullable(),
  tool_ms: durationMsSchema,
});

const handoffLinkSchema = z.strictObject({
  sender_run: idSchema("run"),
  receiver_run: idSchema("run"),
  original_message: idSchema("msg"),
});

export const runTraceSchema = z.object({
  run: idSchema("run").nullable(),
  basis: hash.nullable(),
  events: z.array(seqSchema),
  messages: z.array(idSchema("msg")),
  model_calls: z.array(idSchema("mcl")),
  tool_calls: z.array(idSchema("tcl")),
  handoff_links: z.array(handoffLinkSchema),
  times: timesSchema,
  reason: runOutcomeOutputSchema.nullable(),
  missing: z.array(missingSchema),
});
export type RunTrace = z.infer<typeof runTraceSchema>;

export const agentTraceReadInputSchema = z.strictObject({
  target: traceTargetSchema,
  role: agentRoleSchema.optional(),
  from_at: atSchema.optional(),
  through_at: atSchema.optional(),
  cursor: z.string().min(1).optional(),
  limit: z.number().int().positive().max(100).optional(),
}).refine(
  (value) =>
    value.from_at === undefined || value.through_at === undefined ||
    value.from_at < value.through_at,
  { message: "empty or inverted period" },
);

export const agentTraceReadOutputSchema = withReadCommon(z.object({
  trace: runTraceSchema,
}));

export const agentTraceRead = defineRead({
  resource: "agent-traces",
  method: "read",
  name: "ReadAgentTrace",
  input: agentTraceReadInputSchema,
  output: agentTraceReadOutputSchema,
  actors: ["user", "agent", "machine"],
  errors: readErrors,
});

export const TRACE_EXPORT_FORMAT_VERSION = 1;

const exportErrorSchema = z.strictObject({
  code: z.enum(readErrors),
  reference: nonempty.max(200),
});

export const agentTraceExportInputSchema = z.strictObject({
  targets: z.array(traceTargetSchema).min(1).max(100),
  format: z.literal("ndjson"),
  format_version: z.literal(TRACE_EXPORT_FORMAT_VERSION),
  destination: nonempty.max(1024),
  content_kinds: z.array(z.enum(TRACE_CONTENT_KINDS)).max(5),
}).refine(
  (value) => new Set(value.content_kinds).size === value.content_kinds.length,
  { message: "content kinds must be unique" },
).refine(
  (value) => !/^https?:\/\//i.test(value.destination),
  { message: "export destination is a local path" },
);

export const agentTraceExportOutputSchema = z.object({
  sent: count,
  not_sent: count,
  errors: z.array(exportErrorSchema),
});

// export는 업무 event가 없는 runtime 접수다. ledger command로 두지 않는다.
export const agentTraceExport = defineCommand({
  resource: "agent-traces",
  method: "export",
  name: "ExportAgentTrace",
  input: agentTraceExportInputSchema,
  output: agentTraceExportOutputSchema,
  actors: ["user"],
  errors: readErrors,
});


// TokenUsage·CallCost 정본은 model-call-values.ts다(ModelCall 기록과 같은 값).
const CALL_COST_KINDS = COST_KINDS;
const decimal = z.string().regex(/^(0|[1-9][0-9]{0,17})(\.[0-9]{1,6})?$/);
const currency = z.string().regex(/^[A-Z]{3}$/);

const usageGroupSchema = z.strictObject({
  run: idSchema("run").nullable(),
  session: idSchema("ses").nullable(),
  role: agentRoleSchema.nullable(),
  model: nonempty.nullable(),
  credential_key: nonempty.nullable(),
  from_at: atSchema,
  through_at: atSchema,
  currency: currency.nullable(),
}).refine((value) => value.from_at < value.through_at, {
  message: "empty or inverted period",
});

const tokenTotalSchema = z.strictObject({
  known: tokenUsageSchema,
  unknown_calls: count,
});

const costTotalSchema = z.strictObject({
  kind: z.enum(CALL_COST_KINDS),
  currency: currency.nullable(),
  amount: decimal.nullable(),
  calls: count,
});

export const usageTotalSchema = z.object({
  group: usageGroupSchema,
  calls: count,
  tokens: tokenTotalSchema,
  costs: z.array(costTotalSchema),
  missing_records: count,
  complete: z.boolean(),
}).refine(
  (value) => value.complete === (value.missing_records === 0),
  { message: "complete usage has no missing records" },
);
export type UsageTotal = z.infer<typeof usageTotalSchema>;

export const agentUsageReadInputSchema = z.strictObject({
  run: idSchema("run").optional(),
  session: idSchema("ses").optional(),
  role: agentRoleSchema.optional(),
  model: nonempty.optional(),
  credential_key: nonempty.optional(),
  from_at: atSchema,
  through_at: atSchema,
  currency: currency.optional(),
  cursor: z.string().min(1).optional(),
}).refine((value) => value.from_at < value.through_at, {
  message: "empty or inverted period",
});

export const agentUsageReadOutputSchema = withReadCommon(z.object({
  totals: z.array(usageTotalSchema),
}));

export const agentUsageRead = defineRead({
  resource: "agent-usage",
  method: "read",
  name: "ReadAgentUsage",
  input: agentUsageReadInputSchema,
  output: agentUsageReadOutputSchema,
  actors: ["user", "agent", "machine"],
  errors: readErrors,
});

export const TRACE_ROUTES = [
  agentTraceRead,
  agentTraceExport,
  agentUsageRead,
] as const;

// trace는 원본 참조 view다. 품질 점수·network export·본문 복제는 두지 않는다.
