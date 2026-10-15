import { z } from "zod";
import { actorSchema } from "../base/actor.ts";
import { withReadCommon } from "../base/envelope.ts";
import { defineEvent } from "../base/event.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineRead } from "../base/route.ts";
import { atSchema } from "../base/values.ts";

export const SETTINGS_EXCHANGE_FORMAT_VERSION = 1;
export const SETTINGS_EXCHANGE_FORMAT = {
  format: "TOML",
  toml_version: "1.0",
  encoding: "UTF-8",
  format_version: SETTINGS_EXCHANGE_FORMAT_VERSION,
} as const;

const nonemptySchema = z.string().regex(/\S/);
const keySchema = z.string().min(1);
const concernSchema = z.string().regex(/^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)*$/);
const jsonObjectSchema = z.record(z.string(), z.json());
export const settingsRevisionNumberSchema = z.number().int().nonnegative().max(
  Number.MAX_SAFE_INTEGER,
);
export const settingApplyAtSchema = z.enum([
  "next_run",
  "current_check",
  "next_call",
]);
export type SettingApplyAt = z.infer<typeof settingApplyAtSchema>;

const definitionFields = {
  key: keySchema,
  owner: concernSchema,
  display_name_key: nonemptySchema,
  description: nonemptySchema,
  value_meaning_key: nonemptySchema,
  default_meaning_key: nonemptySchema,
  affected_features: z.array(nonemptySchema).min(1),
  risk_key: nonemptySchema,
  revert_key: nonemptySchema,
  constraints: jsonObjectSchema,
  required: z.boolean(),
  layers: z.array(z.literal("common")).length(1),
  apply_at: settingApplyAtSchema,
  apply_at_key: nonemptySchema,
  machine_local: z.boolean(),
};

const definitionMetadataSchema = z.strictObject(definitionFields);
type DefinitionMetadata = z.infer<typeof definitionMetadataSchema>;

export type SettingDefinition<S extends z.ZodType = z.ZodType> =
  & DefinitionMetadata
  & { value_type: S }
  & (
    | { default_present: true; default: z.input<S> }
    | { default_present: false; default?: never }
  );

export function defineSetting<S extends z.ZodType>(
  definition: SettingDefinition<S>,
): SettingDefinition<S> {
  const { value_type, default_present, default: defaultValue, ...metadata } =
    definition;
  definitionMetadataSchema.parse(metadata);
  if (default_present) value_type.parse(defaultValue);
  else if (Object.hasOwn(definition, "default")) {
    throw new Error("a setting without a default must omit default");
  }
  return definition;
}

// HTTP에서는 실행 가능한 schema 대신 소유 concern의 JSON Schema를 공개한다.
export const settingDefinitionSchema = z.object({
  ...definitionFields,
  value_type: jsonObjectSchema,
  default_present: z.boolean(),
  default: z.json().optional(),
}).refine(
  (value) => value.default_present === Object.hasOwn(value, "default"),
  { message: "default presence does not match default_present" },
);
export type SettingDefinitionOutput = z.infer<typeof settingDefinitionSchema>;

export const settingChoiceSchema = z.object({
  layer: z.literal("common"),
  key: keySchema,
  value: z.json(),
});
export type SettingChoice = z.infer<typeof settingChoiceSchema>;

export const settingChangeSchema = z.object({
  layer: z.literal("common"),
  key: keySchema,
  before_present: z.boolean(),
  action: z.enum(["set", "delete"]),
  before: z.json(),
  after: z.json(),
}).refine((value) => value.before_present || value.before === null, {
  message: "absent choice must have null before",
}).refine((value) => value.action !== "delete" || value.after === null, {
  message: "deleted choice must have null after",
});
export type SettingChange = z.infer<typeof settingChangeSchema>;

export const settingsRevisionSchema = z.object({
  revision: settingsRevisionNumberSchema,
  previous_revision: settingsRevisionNumberSchema.nullable(),
  changes: z.array(settingChangeSchema),
  affected_concerns: z.array(concernSchema),
  defaults_revision: nonemptySchema,
  actor: actorSchema.refine((value) => value === "user" || value === "machine"),
  at: atSchema,
}).refine(
  (value) =>
    value.revision === 0
      ? value.previous_revision === null
      : value.previous_revision === value.revision - 1,
  { message: "previous_revision must be the preceding revision" },
).refine(
  (value) =>
    new Set(value.changes.map((change) => change.key)).size ===
      value.changes.length,
  { message: "duplicate setting changes" },
);
export type SettingsRevision = z.infer<typeof settingsRevisionSchema>;

export const settingsStateSchema = z.object({
  singleton: z.literal(1),
  revision: settingsRevisionNumberSchema,
  defaults_revision: nonemptySchema,
});
export type SettingsState = z.infer<typeof settingsStateSchema>;

export const effectiveSettingSchema = z.object({
  key: keySchema,
  resolved: z.boolean(),
  value: z.json(),
  source_layer: z.enum(["builtin", "common"]).nullable(),
  choices: z.array(settingChoiceSchema),
  revision: settingsRevisionNumberSchema,
  apply_at: settingApplyAtSchema,
}).refine(
  (value) =>
    value.resolved
      ? value.source_layer !== null
      : value.value === null && value.source_layer === null,
  { message: "unresolved setting must have null value and source_layer" },
);
export type EffectiveSetting = z.infer<typeof effectiveSettingSchema>;

export const settingsValidationErrorSchema = z.object({
  key: keySchema,
  layer: z.literal("common"),
  expected: nonemptySchema,
  remedy: nonemptySchema,
});
export type SettingsValidationError = z.infer<
  typeof settingsValidationErrorSchema
>;

export const settingMutationSchema = z.discriminatedUnion("action", [
  z.strictObject({
    layer: z.literal("common"),
    key: keySchema,
    action: z.literal("set"),
    value: z.json(),
  }),
  z.strictObject({
    layer: z.literal("common"),
    key: keySchema,
    action: z.literal("delete"),
  }),
]);
export type SettingMutation = z.infer<typeof settingMutationSchema>;

export const settingsDefinitionsInputSchema = z.strictObject({
  keys: z.array(keySchema).optional(),
});
export const settingsDefinitionsOutputSchema = withReadCommon(z.object({
  definitions: z.array(settingDefinitionSchema),
  defaults_revision: nonemptySchema,
}));
export const settingsGetInputSchema = z.strictObject({
  keys: z.array(keySchema).optional(),
});
export const settingsGetOutputSchema = withReadCommon(z.object({
  settings: z.array(effectiveSettingSchema),
  revision: settingsRevisionNumberSchema,
  defaults_revision: nonemptySchema,
}));
export const settingsHistoryInputSchema = z.strictObject({
  after_revision: settingsRevisionNumberSchema.optional(),
  limit: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
});
export const settingsHistoryOutputSchema = withReadCommon(z.object({
  revisions: z.array(settingsRevisionSchema),
}));

const readActors = ["user", "agent", "machine"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;
export const settingsDefinitions = defineRead({
  resource: "settings",
  method: "definitions",
  name: "SettingsDefinitions",
  input: settingsDefinitionsInputSchema,
  output: settingsDefinitionsOutputSchema,
  actors: readActors,
  errors: readErrors,
});
export const settingsGet = defineRead({
  resource: "settings",
  method: "get",
  name: "GetSettings",
  input: settingsGetInputSchema,
  output: settingsGetOutputSchema,
  actors: readActors,
  errors: readErrors,
});
export const settingsHistory = defineRead({
  resource: "settings",
  method: "history",
  name: "SettingsHistory",
  input: settingsHistoryInputSchema,
  output: settingsHistoryOutputSchema,
  actors: readActors,
  errors: readErrors,
});

export const applySettingsInputSchema = z.strictObject({
  changes: z.array(settingMutationSchema).refine(
    (changes) =>
      new Set(changes.map((change) => change.key)).size === changes.length,
    { message: "duplicate setting mutations" },
  ),
  // machine apply만 쓰는 질문 근거다. 사람 apply는 생략한다.
  evidence: z.strictObject({
    question: idSchema("qst"),
    option: z.string().min(1),
  }).optional(),
});
export const reloadSettingsInputSchema = z.strictObject({});
export const settingsCompareSchema = z.strictObject({
  revision: settingsRevisionNumberSchema,
  defaults_revision: nonemptySchema,
});
export const settingApplicationSchema = z.object({
  key: keySchema,
  apply_at: settingApplyAtSchema,
});
export type SettingApplication = z.infer<typeof settingApplicationSchema>;
export const settingsApplyResultSchema = z.object({
  revision: settingsRevisionNumberSchema,
  changed: z.boolean(),
  applied: z.array(settingApplicationSchema),
});
export type SettingsApplyResult = z.infer<typeof settingsApplyResultSchema>;

const commandErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "conflict",
  "unavailable",
] as const;
export const applySettings = defineCommand({
  resource: "settings",
  method: "apply",
  name: "ApplySettings",
  input: applySettingsInputSchema,
  output: settingsApplyResultSchema,
  compare: settingsCompareSchema,
  actors: ["user", "machine"],
  errors: commandErrors,
});
export const reloadSettings = defineCommand({
  resource: "settings",
  method: "reload",
  name: "ReloadSettings",
  input: reloadSettingsInputSchema,
  output: settingsApplyResultSchema,
  compare: settingsCompareSchema,
  actors: ["user", "machine"],
  errors: commandErrors,
});

export const settingsChangedPayloadSchema = z.object({
  revision: settingsRevisionNumberSchema,
  changes: z.array(settingChangeSchema),
  affected_concerns: z.array(concernSchema),
  applied: z.array(settingApplicationSchema),
});
export const settingsReloadedPayloadSchema = z.object({
  revision: settingsRevisionNumberSchema,
  defaults_revision: nonemptySchema,
  keys: z.array(keySchema),
  affected_concerns: z.array(concernSchema),
  applied: z.array(settingApplicationSchema),
});
export const settingsChanged = defineEvent("SettingsChanged", {
  subject: z.null(),
  payload: settingsChangedPayloadSchema,
});
export const settingsReloaded = defineEvent("SettingsReloaded", {
  subject: z.null(),
  payload: settingsReloadedPayloadSchema,
});
export const SETTINGS_ROUTES = [
  settingsDefinitions,
  settingsGet,
  settingsHistory,
  applySettings,
  reloadSettings,
] as const;
export const SETTINGS_EVENTS = [settingsChanged, settingsReloaded] as const;
