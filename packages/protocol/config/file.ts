import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import { SETTING_KEY } from "./declaration.ts";

// `<data root>/settings.json`. key 전체 이름을 그대로 쓰는 평평한 객체이고
// 사람이 명시한 선택만 담는다. 기본값과 합친 값은 쓰지 않는다.
export const SETTINGS_FILE_NAME = "settings.json";
export const settingsFileSchema = z.record(
  z.string().regex(SETTING_KEY),
  z.json(),
);

// 하나라도 거절이면 아무것도 적용하지 않는다. 값은 싣지 않는다.
export const SETTING_REJECTION_REASONS = [
  "unknown_key",
  "wrong_type",
  "out_of_range",
  "invalid_value",
] as const;
export const settingRejectionSchema = z.strictObject({
  key: z.string(),
  reason: z.enum(SETTING_REJECTION_REASONS),
});
export type SettingRejection = z.infer<typeof settingRejectionSchema>;

export const settingEntrySchema = z.strictObject({
  key: z.string(),
  // core가 선언의 zod type에서 만든 JSON Schema다.
  type: z.record(z.string(), z.json()),
  default: z.json().optional(),
  // 파일에 있을 때만 있다. 기본값과 나눠 보이려는 것이다.
  chosen: z.json().optional(),
});
export type SettingEntry = z.infer<typeof settingEntrySchema>;

export const settingsListInputSchema = z.strictObject({
  keys: z.array(z.string()).optional(),
});
export const settingsListOutputSchema = z.strictObject({
  settings: z.array(settingEntrySchema),
});

export const settingChangeInputSchema = z.discriminatedUnion("action", [
  z.strictObject({
    key: z.string(),
    action: z.literal("set"),
    value: z.json(),
  }),
  z.strictObject({ key: z.string(), action: z.literal("unset") }),
]);
export const settingsUpdateInputSchema = z.strictObject({
  changes: z.array(settingChangeInputSchema).refine(
    (changes) =>
      new Set(changes.map((change) => change.key)).size === changes.length,
    { message: "duplicate setting changes" },
  ),
});
// rejected가 비어 있지 않으면 아무것도 쓰지 않은 것이다.
export const settingsUpdateOutputSchema = z.strictObject({
  changed: z.array(z.string()),
  rejected: z.array(settingRejectionSchema),
});

export const settingsList = defineMemory({
  resource: "settings",
  method: "list",
  name: "SettingsList",
  input: settingsListInputSchema,
  output: settingsListOutputSchema,
  actors: ["user", "agent", "app", "machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});
export const settingsUpdate = defineMemory({
  resource: "settings",
  method: "update",
  name: "SettingsUpdate",
  input: settingsUpdateInputSchema,
  output: settingsUpdateOutputSchema,
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

export const SETTINGS_FILE_ROUTES = [settingsList, settingsUpdate] as const;
