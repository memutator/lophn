import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineCommand } from "../base/route.ts";

const nonemptySchema = z.string().regex(/\S/);
const keySchema = z.string().min(1);
const concernSchema = z.string().regex(/^[a-z][a-z0-9-]*(\/[a-z][a-z0-9-]*)*$/);
const jsonObjectSchema = z.record(z.string(), z.json());
const settingsRevisionNumberSchema = z.number().int().nonnegative().max(
  Number.MAX_SAFE_INTEGER,
);
const settingApplyAtSchema = z.enum([
  "next_turn",
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

// HTTP에서는 실행 가능한 schema 대신 소유 concern의 JSON Schema를 공개한다.
const settingDefinitionSchema = z.object({
  ...definitionFields,
  value_type: jsonObjectSchema,
  default_present: z.boolean(),
  default: z.json().optional(),
}).refine(
  (value) => value.default_present === Object.hasOwn(value, "default"),
  { message: "default presence does not match default_present" },
);
export type SettingDefinitionOutput = z.infer<typeof settingDefinitionSchema>;

const settingChoiceSchema = z.object({
  layer: z.literal("common"),
  key: keySchema,
  value: z.json(),
});

const effectiveSettingSchema = z.object({
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

const applySettingsInputSchema = z.strictObject({
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
const settingsCompareSchema = z.strictObject({
  revision: settingsRevisionNumberSchema,
  defaults_revision: nonemptySchema,
});
const settingApplicationSchema = z.object({
  key: keySchema,
  apply_at: settingApplyAtSchema,
});
const settingsApplyResultSchema = z.object({
  revision: settingsRevisionNumberSchema,
  changed: z.boolean(),
  applied: z.array(settingApplicationSchema),
});

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
export const SETTINGS_ROUTES = [applySettings] as const;
