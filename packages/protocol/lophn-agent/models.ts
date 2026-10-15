import { z } from "zod";
import { atSchema, seqSchema, sha256Schema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { defineEvent } from "../base/event.ts";
import { idSchema } from "../base/ids.ts";
import { jsonObjectSchema } from "../base/json-values.ts";
import { withReadCommon } from "../base/envelope.ts";
import {
  EFFORT_LABELS,
  MODEL_MEDIA,
  priceBasisOutputSchema,
  priceBasisSchema,
  resolvedModelOutputSchema,
  resolvedModelSchema,
} from "./resolved-model.ts";
import { EFFORT_VALUES, OPTION_AXIS_EFFORT } from "./option-axes.ts";

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const positiveIntegerSchema = z.number().int().positive().max(
  Number.MAX_SAFE_INTEGER,
);

// agent 정의·전역 기본값·session이 가지는 model 선택 하나(harness/model domain의 ModelChoice).
// 계정은 provider가 고르므로 여기 없다. option_values는 축 id → 값이고 비면 모델에 맡긴다.
const modelChoiceFields = {
  provider: idSchema("pvd"),
  model_name: nonblankSchema,
  option_values: z.record(nonblankSchema, nonblankSchema),
};
export const modelChoiceSchema = z.strictObject(modelChoiceFields);
export const modelChoiceOutputSchema = z.object(modelChoiceFields);
export type ModelChoice = z.infer<typeof modelChoiceSchema>;

export const CATALOG_SOURCES = [
  "release_snapshot",
  "models_dev",
  "lophn_patch",
  "user",
] as const;
export const CATALOG_FAILURES = [
  "invalid_input",
  "unavailable",
  "not_found",
] as const;

// token 예산으로 번역되는 effort 값의 기준 예산이다. 확인된 최소·최대 안으로 제한해서 쓴다.
export const EFFORT_BUDGET_TOKENS = {
  low: 2048,
  medium: 8192,
  high: 16384,
  maximum: 32768,
} as const;
// 예산 축이 가질 수 있는 effort 값은 끔과 예산이 있는 넷뿐이다.
const BUDGET_EFFORT_VALUES: readonly string[] = [
  "off",
  ...Object.keys(EFFORT_BUDGET_TOKENS),
];

// 요청에 싣는 방법은 둘뿐이다. 화면은 wire를 모르고 축·값의 표시 이름만 쓴다.
const bodyPatchWireFields = {
  kind: z.literal("body_patch"),
  // 빈 조각은 "요청에 더할 것이 없다"는 명시 값이다(예: Standard).
  patch: jsonObjectSchema,
  // 같은 값이 요청 header도 요구할 때만 싣는다(예: Anthropic fast mode의 beta header).
  headers: z.record(nonblankSchema, nonblankSchema).refine(
    (headers) => Object.keys(headers).length > 0,
    { message: "headers are empty" },
  ).optional(),
};
const modelIdWireFields = {
  kind: z.literal("model_id"),
  model_name: nonblankSchema,
};
export const optionWireSchema = z.discriminatedUnion("kind", [
  z.strictObject(bodyPatchWireFields),
  z.strictObject(modelIdWireFields),
]);
export const optionWireOutputSchema = z.discriminatedUnion("kind", [
  z.object(bodyPatchWireFields),
  z.object(modelIdWireFields),
]);
export type OptionWire = z.infer<typeof optionWireSchema>;

const optionValueFields = {
  value: nonblankSchema,
  label: nonblankSchema,
  wire: optionWireSchema.nullable(),
};
export const optionValueSchema = z.strictObject(optionValueFields);
export const optionValueOutputSchema = z.object({
  ...optionValueFields,
  wire: optionWireOutputSchema.nullable(),
});
export type OptionValue = z.infer<typeof optionValueSchema>;

const optionBudgetFields = {
  minimum: positiveIntegerSchema,
  maximum: positiveIntegerSchema,
};
const optionAxisFields = {
  id: nonblankSchema,
  label: nonblankSchema,
  values: z.array(optionValueSchema).min(1),
  default_value: nonblankSchema.nullable(),
  budget: z.strictObject(optionBudgetFields).nullable(),
};

function optionAxisShape(
  axis: {
    id: string;
    values: readonly { value: string; label: string; wire: unknown }[];
    default_value: string | null;
    budget: { minimum: number; maximum: number } | null;
  },
  ctx: z.RefinementCtx,
): void {
  const names = axis.values.map((entry) => entry.value);
  const issue = (message: string) => ctx.addIssue({ code: "custom", message });
  if (new Set(names).size !== names.length) issue("duplicate option value");
  if (axis.default_value !== null && !names.includes(axis.default_value)) {
    issue("default value is not one of the axis values");
  }
  if (axis.budget !== null && axis.budget.minimum > axis.budget.maximum) {
    issue("budget minimum is above its maximum");
  }
  if (axis.id !== OPTION_AXIS_EFFORT) {
    if (axis.budget !== null) issue("only the effort axis has a budget");
    if (axis.values.some((entry) => entry.wire === null)) {
      issue("a value outside the effort axis needs its own wire");
    }
    return;
  }
  // effort 값은 약한 값에서 강한 값 순서로 일곱 이름 안에서만 고르고, 표시 이름은 고정이다.
  const ranks = names.map((name) => EFFORT_VALUES.indexOf(name as never));
  if (ranks.some((rank) => rank < 0)) issue("unknown effort value");
  if (ranks.some((rank, index) => index > 0 && rank <= ranks[index - 1])) {
    issue("effort values are not ordered from weak to strong");
  }
  for (const entry of axis.values) {
    if (
      EFFORT_LABELS[entry.value as keyof typeof EFFORT_LABELS] !== entry.label
    ) {
      issue("effort value label differs from its fixed display name");
    }
  }
  if (
    axis.budget !== null &&
    !names.every((n) => BUDGET_EFFORT_VALUES.includes(n))
  ) {
    issue("a budget axis only takes off, low, medium, high and maximum");
  }
}

export const optionAxisSchema = z.strictObject(optionAxisFields)
  .superRefine(optionAxisShape);
export const optionAxisOutputSchema = z.object({
  ...optionAxisFields,
  values: z.array(optionValueOutputSchema).min(1),
  budget: z.object(optionBudgetFields).nullable(),
}).superRefine(optionAxisShape);
export type OptionAxis = z.infer<typeof optionAxisSchema>;

function uniqueAxisIds(axes: readonly { id: string }[] | null): boolean {
  return axes === null ||
    new Set(axes.map((axis) => axis.id)).size === axes.length;
}
// null은 option을 아직 모른다는 뜻(고를 수 없고 option 필드도 보내지 않는다)이고 빈 배열은 없다고 확인된 것이다.
const axesSchema = z.array(optionAxisSchema).nullable().refine(uniqueAxisIds, {
  message: "duplicate option axis",
});
const axesOutputSchema = z.array(optionAxisOutputSchema).nullable().refine(
  uniqueAxisIds,
  { message: "duplicate option axis" },
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
  options: axesSchema,
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
  options: axesOutputSchema,
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

// 전역 층의 기본 model. 앞의 넷은 role별 기본값이고 summaries는 제목·요약·압축에 쓰는
// "Model for summaries" 한 칸이다. 처음은 모두 null이다.
export const MODEL_DEFAULT_SLOTS = [
  "lophn",
  "project_manager",
  "app_engineer",
  "operator",
  "summaries",
] as const;
export const modelDefaultSlotSchema = z.enum(MODEL_DEFAULT_SLOTS);
export type ModelDefaultSlot = z.infer<typeof modelDefaultSlotSchema>;

const defaultsFields = {
  lophn: modelChoiceSchema.nullable(),
  project_manager: modelChoiceSchema.nullable(),
  app_engineer: modelChoiceSchema.nullable(),
  operator: modelChoiceSchema.nullable(),
  summaries: modelChoiceSchema.nullable(),
  settings_seq: seqSchema,
};
export const modelDefaultsSchema = z.strictObject(defaultsFields);
export const modelDefaultsOutputSchema = z.object({
  ...defaultsFields,
  lophn: modelChoiceOutputSchema.nullable(),
  project_manager: modelChoiceOutputSchema.nullable(),
  app_engineer: modelChoiceOutputSchema.nullable(),
  operator: modelChoiceOutputSchema.nullable(),
  summaries: modelChoiceOutputSchema.nullable(),
});
export type ModelDefaults = z.infer<typeof modelDefaultsSchema>;

// 즐겨찾기 순서는 별표를 찍은 순서이고 새로 찍은 것이 맨 끝이다. provider로 다시 묶지 않는다.
const favoriteFields = {
  provider: idSchema("pvd"),
  model_name: nonblankSchema,
};
export const modelFavoriteSchema = z.strictObject(favoriteFields);
export const modelFavoriteOutputSchema = z.object(favoriteFields);
export type ModelFavorite = z.infer<typeof modelFavoriteSchema>;

function uniqueFavorites(
  items: readonly { provider: string; model_name: string }[],
): boolean {
  return new Set(items.map((item) => `${item.provider}\0${item.model_name}`))
    .size === items.length;
}
const duplicateFavorite = { message: "duplicate favorite" };
export const modelFavoritesItemsSchema = z.array(modelFavoriteSchema).refine(
  uniqueFavorites,
  duplicateFavorite,
);
const favoritesOutputItemsSchema = z.array(modelFavoriteOutputSchema).refine(
  uniqueFavorites,
  duplicateFavorite,
);
export const modelFavoritesSchema = z.strictObject({
  items: modelFavoritesItemsSchema,
  settings_seq: seqSchema,
});
export const modelFavoritesOutputSchema = z.object({
  items: favoritesOutputItemsSchema,
  settings_seq: seqSchema,
});
export type ModelFavorites = z.infer<typeof modelFavoritesSchema>;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "unavailable",
] as const;
const readActors = ["user", "agent", "machine", "coding_agent"] as const;

// 바꾸는 slot만 싣는다. null은 그 slot을 비운다. 나머지 slot은 그대로다.
export const changeModelDefaultsInputSchema = z.strictObject({
  lophn: modelChoiceSchema.nullable().optional(),
  project_manager: modelChoiceSchema.nullable().optional(),
  app_engineer: modelChoiceSchema.nullable().optional(),
  operator: modelChoiceSchema.nullable().optional(),
  summaries: modelChoiceSchema.nullable().optional(),
}).refine(
  (value) => Object.values(value).some((choice) => choice !== undefined),
  { message: "model defaults change is empty" },
);
const settingsSeqCompare = z.strictObject({ settings_seq: seqSchema });

export const changeModelDefaults = defineCommand({
  resource: "agent-model-defaults",
  method: "change",
  name: "ChangeModelDefaults",
  input: changeModelDefaultsInputSchema,
  output: z.object({ defaults: modelDefaultsOutputSchema }),
  compare: settingsSeqCompare,
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

// 순서 있는 목록을 통째로 바꾼다. 별표를 찍고 끄는 일, 끌어 옮기는 일이 모두 새 순서 하나다.
export const changeModelFavorites = defineCommand({
  resource: "model-favorites",
  method: "change",
  name: "ChangeModelFavorites",
  input: z.strictObject({ items: modelFavoritesItemsSchema }),
  output: z.object({ favorites: modelFavoritesOutputSchema }),
  compare: settingsSeqCompare,
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
  ],
});

export const modelFavoritesRead = defineRead({
  resource: "model-favorites",
  method: "read",
  name: "ReadModelFavorites",
  input: z.strictObject({}),
  output: withReadCommon(z.object({ favorites: modelFavoritesOutputSchema })),
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
    slots: z.array(modelDefaultSlotSchema).min(1),
    defaults: modelDefaultsOutputSchema,
  }),
});

export const modelFavoritesChanged = defineEvent("ModelFavoritesChanged", {
  subject: z.null(),
  payload: z.object({
    settings_seq: seqSchema,
    items: favoritesOutputItemsSchema,
  }),
});

// model은 전역 기본 하나와 agent 설정에서 고른다. 처음은 null이다.
export const modelDefaultSchema = modelChoiceSchema.nullable();
export const modelDefaultOutputSchema = modelChoiceOutputSchema.nullable();

export const modelDefaultRead = defineRead({
  resource: "model-default",
  method: "read",
  name: "ReadModelDefault",
  input: z.strictObject({}),
  output: withReadCommon(z.object({ default: modelDefaultOutputSchema })),
  actors: readActors,
  errors: [...readErrors],
});

export const modelDefaultChange = defineCommand({
  resource: "model-default",
  method: "change",
  name: "ChangeModelDefault",
  input: z.strictObject({ default: modelDefaultSchema }),
  output: z.object({ default: modelDefaultOutputSchema }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const MODEL_ROUTES = [
  modelDefaultRead,
  modelDefaultChange,
  changeModelDefaults,
  modelDefaultsRead,
  changeModelFavorites,
  modelFavoritesRead,
  modelCatalogRead,
  modelCatalogRefresh,
] as const;

export const MODEL_EVENTS = [
  modelDefaultsChanged,
  modelFavoritesChanged,
] as const;

export const CATALOG_REFRESH_INTERVAL_MS = 86_400_000;
export const INSTRUCTION_FILE_MAX_BYTES = 32_768;
export const INSTRUCTION_CALL_MAX_BYTES = 131_072;

// turn 기준에 고정하는 값은 ResolvedModel을 그대로 쓴다.
export const turnBasisModelSchema = resolvedModelSchema;
export const turnBasisModelOutputSchema = resolvedModelOutputSchema;
