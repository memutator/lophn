import { z } from "zod";
import {
  atSchema,
  defineCommand,
  defineEvent,
  defineRead,
  seqSchema,
  sha256Schema,
  withReadCommon,
} from "../platform/mod.ts";
import { presetModelSelectionSchema } from "./preset-values.ts";
import {
  MODEL_MEDIA,
  priceBasisOutputSchema,
  priceBasisSchema,
  reasoningLevelSchema,
  resolvedModelOutputSchema,
  resolvedModelSchema,
} from "./resolved-model.ts";

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const positiveIntegerSchema = z.number().int().positive().max(
  Number.MAX_SAFE_INTEGER,
);

export const CATALOG_SOURCES = [
  "release_snapshot",
  "models_dev",
  "lophn_patch",
  "user",
] as const;
export const REASONING_MODES = [
  "unknown",
  "none",
  "named",
  "budget",
  "toggle",
] as const;
export const CATALOG_FAILURES = [
  "invalid_input",
  "unavailable",
  "not_found",
] as const;

export const orderedLevels = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "very_high",
  "maximum",
] as const;

const reasoningFields = {
  mode: z.enum(REASONING_MODES),
  levels: z.array(reasoningLevelSchema),
  minimum_budget: positiveIntegerSchema.nullable(),
  maximum_budget: positiveIntegerSchema.nullable(),
  default_level: reasoningLevelSchema.exclude(["provider_default"]).nullable(),
};

function reasoningShape(value: {
  mode: (typeof REASONING_MODES)[number];
  levels: readonly string[];
  minimum_budget: number | null;
  maximum_budget: number | null;
}): boolean {
  const budget = value.mode === "budget";
  const range = budget
    ? value.minimum_budget !== null && value.maximum_budget !== null &&
      value.minimum_budget <= value.maximum_budget
    : value.minimum_budget === null && value.maximum_budget === null;
  const named = value.mode !== "named" ||
    value.levels.every((level) => level !== "provider_default");
  return new Set(value.levels).size === value.levels.length && range && named;
}

export const reasoningSupportSchema = z.strictObject(reasoningFields).refine(
  reasoningShape,
  { message: "reasoning support does not match its mode" },
);
export const reasoningSupportOutputSchema = z.object(reasoningFields).refine(
  reasoningShape,
  { message: "reasoning support does not match its mode" },
);

const mediaList = z.array(z.enum(MODEL_MEDIA)).refine(
  (values) => new Set(values).size === values.length,
  { message: "duplicate media" },
).nullable();

const entryFields = {
  provider_definition: nonblankSchema,
  model_name: nonblankSchema,
  context_limit: positiveIntegerSchema.nullable(),
  input_limit: positiveIntegerSchema.nullable(),
  output_limit: positiveIntegerSchema.nullable(),
  supports_tools: z.boolean().nullable(),
  input_media: mediaList,
  output_media: mediaList,
  reasoning: reasoningSupportSchema,
  preview: z.boolean().nullable(),
  deprecated: z.boolean().nullable(),
  source: z.enum(CATALOG_SOURCES),
  source_revision: nonblankSchema,
  checked_at: atSchema.nullable(),
  received_at: atSchema.nullable(),
  price_basis: priceBasisSchema.nullable(),
};

export const catalogEntrySchema = z.strictObject(entryFields);
export const catalogEntryOutputSchema = z.object({
  ...entryFields,
  reasoning: reasoningSupportOutputSchema,
  price_basis: priceBasisOutputSchema.nullable(),
});
export type CatalogEntry = z.infer<typeof catalogEntrySchema>;

const stateFields = {
  auto_update: z.boolean(),
  etag: nonblankSchema.nullable(),
  last_checked_at: atSchema.nullable(),
  last_received_at: atSchema.nullable(),
  last_failure: z.enum(CATALOG_FAILURES).nullable(),
  snapshot_hash: sha256Schema,
};
export const catalogStateSchema = z.strictObject(stateFields);
export const catalogStateOutputSchema = z.object(stateFields);
export type CatalogState = z.infer<typeof catalogStateSchema>;

const defaultsFields = {
  judgment: presetModelSelectionSchema.nullable(),
  organizing: presetModelSelectionSchema.nullable(),
  settings_seq: seqSchema,
};
export const modelDefaultsSchema = z.strictObject(defaultsFields);
export const modelDefaultsOutputSchema = z.object(defaultsFields);
export type ModelDefaults = z.infer<typeof modelDefaultsSchema>;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "unavailable",
] as const;
const readActors = ["user", "agent", "machine", "coding_agent"] as const;

export const changeModelDefaults = defineCommand({
  resource: "agent-model-defaults",
  method: "change",
  name: "ChangeModelDefaults",
  input: modelDefaultsSchema,
  output: modelDefaultsOutputSchema,
  compare: z.strictObject({ settings_seq: seqSchema }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

export const modelDefaultsRead = defineRead({
  resource: "agent-model-defaults",
  method: "read",
  name: "ReadModelDefaults",
  input: z.strictObject({}),
  output: withReadCommon(z.object({ defaults: modelDefaultsOutputSchema })),
  actors: readActors,
  errors: [...readErrors],
});

export const modelCatalogRead = defineRead({
  resource: "agent-model-catalog",
  method: "read",
  name: "ReadModelCatalog",
  input: z.strictObject({
    provider_definition: nonblankSchema.optional(),
    model_name: nonblankSchema.optional(),
  }),
  output: withReadCommon(z.object({
    state: catalogStateOutputSchema,
    entries: z.array(catalogEntryOutputSchema),
  })),
  actors: readActors,
  errors: [...readErrors],
});

export const modelCatalogRefresh = defineCommand({
  resource: "agent-model-catalog",
  method: "refresh",
  name: "RefreshModelCatalog",
  input: z.strictObject({}),
  output: z.object({ state: catalogStateOutputSchema }),
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

export const modelDefaultsChanged = defineEvent("ModelDefaultsChanged", {
  subject: z.null(),
  payload: z.object({
    settings_seq: seqSchema,
    defaults: modelDefaultsOutputSchema,
  }),
});

export const MODEL_ROUTES = [
  changeModelDefaults,
  modelDefaultsRead,
  modelCatalogRead,
  modelCatalogRefresh,
] as const;

export const MODEL_EVENTS = [modelDefaultsChanged] as const;

export const REASONING_BUDGET_TOKENS = {
  low: 2048,
  medium: 8192,
  high: 16384,
  maximum: 32768,
} as const;
export const CATALOG_REFRESH_INTERVAL_MS = 86_400_000;
export const INSTRUCTION_FILE_MAX_BYTES = 32_768;
export const INSTRUCTION_CALL_MAX_BYTES = 131_072;

// RunBasis에 고정하는 값은 T26의 ResolvedModel을 그대로 쓴다.
export const runBasisModelSchema = resolvedModelSchema;
export const runBasisModelOutputSchema = resolvedModelOutputSchema;
