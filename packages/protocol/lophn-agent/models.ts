import { z } from "zod";
import { atSchema, seqSchema, sha256Schema } from "../base/values.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { jsonObjectSchema } from "../base/json-values.ts";
import { withReadCommon } from "../base/envelope.ts";
import {
  EFFORT_LABELS,
  type EffortValue,
  effortValueSchema,
  MODEL_MEDIA,
  modelMediaSchema,
  nonnegativeDecimalSchema,
  priceBasisOutputSchema,
  priceBasisSchema,
} from "./resolved-model.ts";
import { workspaceKeySchema } from "./mcp-settings.ts";
import { EFFORT_VALUES, OPTION_AXIS_EFFORT } from "./option-axes.ts";

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const positiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

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

const CATALOG_SOURCES = [
  "release_snapshot",
  "models_dev",
  "lophn_patch",
  "user",
] as const;
const CATALOG_FAILURES = ["invalid_input", "unavailable", "not_found"] as const;

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
  headers: z
    .record(nonblankSchema, nonblankSchema)
    .refine((headers) => Object.keys(headers).length > 0, {
      message: "headers are empty",
    })
    .optional(),
};
const modelIdWireFields = {
  kind: z.literal("model_id"),
  model_name: nonblankSchema,
};
const optionWireSchema = z.discriminatedUnion("kind", [
  z.strictObject(bodyPatchWireFields),
  z.strictObject(modelIdWireFields),
]);
const optionWireOutputSchema = z.discriminatedUnion("kind", [
  z.object(bodyPatchWireFields),
  z.object(modelIdWireFields),
]);
export type OptionWire = z.infer<typeof optionWireSchema>;

const optionValueFields = {
  value: nonblankSchema,
  label: nonblankSchema,
  wire: optionWireSchema.nullable(),
};
const optionValueSchema = z.strictObject(optionValueFields);
const optionValueOutputSchema = z.object({
  ...optionValueFields,
  wire: optionWireOutputSchema.nullable(),
});

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

const optionAxisSchema = z
  .strictObject(optionAxisFields)
  .superRefine(optionAxisShape);
const optionAxisOutputSchema = z
  .object({
    ...optionAxisFields,
    values: z.array(optionValueOutputSchema).min(1),
    budget: z.object(optionBudgetFields).nullable(),
  })
  .superRefine(optionAxisShape);
export type OptionAxis = z.infer<typeof optionAxisSchema>;

function uniqueAxisIds(axes: readonly { id: string }[] | null): boolean {
  return (
    axes === null || new Set(axes.map((axis) => axis.id)).size === axes.length
  );
}
// null은 option을 아직 모른다는 뜻(고를 수 없고 option 필드도 보내지 않는다)이고 빈 배열은 없다고 확인된 것이다.
const axesSchema = z.array(optionAxisSchema).nullable().refine(uniqueAxisIds, {
  message: "duplicate option axis",
});
const axesOutputSchema = z
  .array(optionAxisOutputSchema)
  .nullable()
  .refine(uniqueAxisIds, { message: "duplicate option axis" });

const mediaList = z
  .array(z.enum(MODEL_MEDIA))
  .refine((values) => new Set(values).size === values.length, {
    message: "duplicate media",
  })
  .nullable();

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
const catalogStateOutputSchema = z.object(stateFields);
export type CatalogState = z.infer<typeof catalogStateSchema>;

// 켠 model 목록이다. 기본이 "끔"이라 켠 것만 적는다. 새 model과 새 provider는 적지 않으면 꺼져 있다.
const shownFields = {
  provider: idSchema("pvd"),
  model_name: nonblankSchema,
};
const shownModelSchema = z.strictObject(shownFields);
const shownModelOutputSchema = z.object(shownFields);

function uniqueShown(
  items: readonly { provider: string; model_name: string }[],
): boolean {
  return (
    new Set(items.map((item) => `${item.provider}\0${item.model_name}`))
      .size === items.length
  );
}
const duplicateShown = { message: "duplicate shown model" };
const shownModelsItemsSchema = z
  .array(shownModelSchema)
  .refine(uniqueShown, duplicateShown);
const shownOutputItemsSchema = z
  .array(shownModelOutputSchema)
  .refine(uniqueShown, duplicateShown);
const shownModelsSchema = z.strictObject({
  items: shownModelsItemsSchema,
  settings_seq: seqSchema,
});
const shownModelsOutputSchema = z.object({
  items: shownOutputItemsSchema,
  settings_seq: seqSchema,
});
export type ShownModels = z.infer<typeof shownModelsSchema>;

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "unavailable",
] as const;
const readActors = ["user", "agent", "machine"] as const;

// 바꾸는 slot만 싣는다. null은 그 slot을 비운다. 나머지 slot은 그대로다.
const settingsSeqCompare = z.strictObject({ settings_seq: seqSchema });

// 켠 목록을 통째로 바꾼다. model 하나를 끄고 켜는 일도, provider 전체를 끄고 켜는 일도 새 목록 하나다.
export const changeShownModels = defineCommand({
  resource: "shown-models",
  method: "change",
  name: "ChangeShownModels",
  input: z.strictObject({ items: shownModelsItemsSchema }),
  output: z.object({ shown: shownModelsOutputSchema }),
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

export const shownModelsRead = defineRead({
  resource: "shown-models",
  method: "read",
  name: "ReadShownModels",
  input: z.strictObject({}),
  output: withReadCommon(z.object({ shown: shownModelsOutputSchema })),
  actors: readActors,
  errors: [...readErrors],
});

// 사람이 custom provider model에 적은 정보다. 칸 이름과 모양은 CatalogEntry를 따르고, core가 이것으로
// source가 "user"인 항목을 만들어 catalog의 user 층에 합친다. null은 "안 적음"이다(한도·tool 지원은 turn이
// 목록 밖 기본값으로 채우고, effort null은 option 없음, price null은 가격 모름).
const userEffortFields = {
  // 약한 값에서 강한 값 순서다.
  values: z.array(effortValueSchema).min(1),
  // null이면 model에 맡긴다.
  default_value: effortValueSchema.nullable(),
};
const userPriceFields = {
  input: nonnegativeDecimalSchema.nullable(),
  output: nonnegativeDecimalSchema.nullable(),
  cache_read: nonnegativeDecimalSchema.nullable(),
  cache_write: nonnegativeDecimalSchema.nullable(),
};

// 사람이 고른 effort가 core가 만드는 축이 된다. label은 고정이고 wire·budget은 없다.
export function effortAxisOf(effort: {
  values: readonly EffortValue[];
  default_value: EffortValue | null;
}): OptionAxis {
  return {
    id: OPTION_AXIS_EFFORT,
    label: "Effort",
    values: effort.values.map((value) => ({
      value,
      label: EFFORT_LABELS[value],
      wire: null,
    })),
    default_value: effort.default_value,
    budget: null,
  };
}

// 순서·중복·기본 값 검사는 effort 축의 기존 검사를 그대로 쓴다.
const validEffort = (effort: Parameters<typeof effortAxisOf>[0]) =>
  optionAxisSchema.safeParse(effortAxisOf(effort)).success;
const invalidEffort = { message: "invalid effort values" };

const userInfoFields = {
  context_limit: positiveIntegerSchema.nullable(),
  input_limit: positiveIntegerSchema.nullable(),
  output_limit: positiveIntegerSchema.nullable(),
  supports_tools: z.boolean().nullable(),
  input_media: modelMediaSchema,
  output_media: modelMediaSchema,
};
const userModelInfoSchema = z.strictObject({
  ...userInfoFields,
  effort: z
    .strictObject(userEffortFields)
    .refine(validEffort, invalidEffort)
    .nullable(),
  price: z.strictObject(userPriceFields).nullable(),
});
const userModelInfoOutputSchema = z.object({
  ...userInfoFields,
  effort: z
    .object(userEffortFields)
    .refine(validEffort, invalidEffort)
    .nullable(),
  price: z.object(userPriceFields).nullable(),
});
export type UserModelInfo = z.infer<typeof userModelInfoSchema>;

const userModelKeyFields = {
  provider_definition: nonblankSchema,
  model_name: nonblankSchema,
};
const userModelItemSchema = z.strictObject({
  ...userModelKeyFields,
  info: userModelInfoSchema,
});
// saved_at은 저장한 시각이다. 가격 근거(price_basis.checked_at)가 된다.
const userModelRecordOutputSchema = z.object({
  ...userModelKeyFields,
  info: userModelInfoOutputSchema,
  saved_at: atSchema,
});
const userModelsOutputFields = {
  seq: seqSchema,
  items: z.array(userModelRecordOutputSchema),
};
export type UserModelItem = z.infer<typeof userModelItemSchema>;
export type UserModelRecord = z.infer<typeof userModelRecordOutputSchema>;

const userModelsSeqCompare = z.strictObject({ seq: seqSchema });
const userModelErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "conflict",
] as const;

// custom provider model 하나의 정보를 더하거나 고친다. 내장·구독 OAuth 정의의 key는 invalid_input이다.
export const saveUserModelInfo = defineCommand({
  resource: "user-model-info",
  method: "save",
  name: "SaveUserModelInfo",
  input: userModelItemSchema,
  output: z.object(userModelsOutputFields),
  compare: userModelsSeqCompare,
  actors: ["user"],
  errors: [...userModelErrors],
});

export const removeUserModelInfo = defineCommand({
  resource: "user-model-info",
  method: "remove",
  name: "RemoveUserModelInfo",
  input: z.strictObject(userModelKeyFields),
  output: z.object(userModelsOutputFields),
  compare: userModelsSeqCompare,
  actors: ["user"],
  errors: [...userModelErrors],
});

export const userModelInfoRead = defineRead({
  resource: "user-model-info",
  method: "read",
  name: "ReadUserModelInfo",
  input: z.strictObject({}),
  output: withReadCommon(z.object(userModelsOutputFields)),
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
    // 앞선 응답의 next_cursor다. catalog 전체가 한 응답 한도를 넘으므로 page로 읽는다.
    cursor: z.string().min(1).optional(),
  }),
  output: withReadCommon(
    z.object({
      state: catalogStateOutputSchema,
      entries: z.array(catalogEntryOutputSchema),
    }),
  ),
  actors: readActors,
  errors: [...readErrors],
});

// model은 전역 기본 하나와 agent 설정에서 고른다. 처음은 null이다.
const modelDefaultSchema = modelChoiceSchema.nullable();
const modelDefaultOutputSchema = modelChoiceOutputSchema.nullable();

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

// workspace(Home, project, 앱) 층 model. 처음은 null이고 null이면 전역 기본을 따른다.
export const workspaceModelRead = defineRead({
  resource: "workspace-model",
  method: "read",
  name: "ReadWorkspaceModel",
  input: z.strictObject({ workspace: workspaceKeySchema }),
  output: withReadCommon(z.object({ model: modelDefaultOutputSchema })),
  actors: readActors,
  errors: [...readErrors, "not_found"],
});

export const workspaceModelChange = defineCommand({
  resource: "workspace-model",
  method: "change",
  name: "ChangeWorkspaceModel",
  input: z.strictObject({
    workspace: workspaceKeySchema,
    model: modelDefaultSchema,
  }),
  output: z.object({ model: modelDefaultOutputSchema }),
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
  workspaceModelRead,
  workspaceModelChange,
  changeShownModels,
  shownModelsRead,
  saveUserModelInfo,
  removeUserModelInfo,
  userModelInfoRead,
  modelCatalogRead,
] as const;

// models.dev catalog와 provider model 목록을 다시 읽는 주기다. 새 model이 열린 날 하루를 기다리지 않게 짧게 둔다.
// models.dev는 ETag로 조건부 GET이라 바뀌지 않았으면 본문을 받지 않는다.
export const CATALOG_REFRESH_INTERVAL_MS = 7_200_000;
export const INSTRUCTION_FILE_MAX_BYTES = 32_768;

// turn 기준에 고정하는 값은 ResolvedModel을 그대로 쓴다.
