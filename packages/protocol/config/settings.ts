import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { defineCommand } from "../base/route.ts";

const nonemptySchema = z.string().regex(/\S/);
const keySchema = z.string().min(1);
const settingsRevisionNumberSchema = z.number().int().nonnegative().max(
  Number.MAX_SAFE_INTEGER,
);
const settingApplyAtSchema = z.enum([
  "next_turn",
  "current_check",
  "next_call",
]);

// HTTP에서는 실행 가능한 schema 대신 소유 concern의 JSON Schema를 공개한다.

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
