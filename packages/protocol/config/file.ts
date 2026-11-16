import { z } from "zod";
import { idSchema } from "../base/ids.ts";
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
// locked는 agent가 사람만 바꾸는 설정을 바꾸려 한 것이다. needs_approval은 agent가 사람의 허락이 드는 설정을 바꾸려 했는데
// 허락을 받지 못한 것이다(사람이 거절했다, 물을 사람이 없다, 기다림이 끝났다). message는 그 이유(영어)다.
const SETTING_REJECTION_REASONS = [
  "unknown_key",
  "wrong_type",
  "out_of_range",
  "invalid_value",
  "locked",
  "needs_approval",
] as const;
const settingRejectionSchema = z.strictObject({
  key: z.string(),
  reason: z.enum(SETTING_REJECTION_REASONS),
  message: z.string().optional(),
});
export type SettingRejection = z.infer<typeof settingRejectionSchema>;

// 값은 썼지만 바꾼 쪽이 알아야 할 것(theme의 모자란 대비 등)이다.
const settingNoteSchema = z.strictObject({
  key: z.string(),
  message: z.string(),
});
export type SettingNote = z.infer<typeof settingNoteSchema>;

const settingEntrySchema = z.strictObject({
  key: z.string(),
  // 선언의 설명(영어)이다.
  description: z.string(),
  // 사람이 Settings 화면에서만 바꾼다. 명령과 agent는 바꾸지 못한다.
  locked: z.literal(true).optional(),
  // agent가 바꾸면 사람이 승인 카드에서 그 한 번을 허락해야 한다.
  approval: z.literal("person").optional(),
  // core가 선언의 zod type에서 만든 JSON Schema다.
  type: z.record(z.string(), z.json()),
  default: z.json().optional(),
  // 파일에 있을 때만 있다. 기본값과 나눠 보이려는 것이다.
  chosen: z.json().optional(),
});
export type SettingEntry = z.infer<typeof settingEntrySchema>;

const settingsListInputSchema = z.strictObject({
  keys: z.array(z.string()).optional(),
});
// 항목마다 file 하나인 설정 묶음. 항목의 key는 `<key>.<id>`이고 `settings/update`로 쓰고 지운다.
const settingFolderSchema = z.strictObject({
  key: z.string(),
  description: z.string(),
  locked: z.literal(true).optional(),
  // data root 아래 folder 이름이다.
  folder: z.string(),
  // 항목 하나의 JSON Schema다.
  type: z.record(z.string(), z.json()),
  entries: z.array(z.strictObject({ id: z.string(), value: z.json() })),
  // 읽지 못한 file. name은 `.json`을 뺀 file 이름이다.
  unreadable: z.array(
    z.strictObject({
      name: z.string(),
      reason: z.enum(["bad_id", "too_large", "not_json", "bad_shape"]),
    }),
  ),
});
export type SettingFolder = z.infer<typeof settingFolderSchema>;

// keys를 주면 그 key의 설정과 그 key의 folder만 온다.
const settingsListOutputSchema = z.strictObject({
  settings: z.array(settingEntrySchema),
  folders: z.array(settingFolderSchema),
});

const settingChangeInputSchema = z.discriminatedUnion("action", [
  z.strictObject({
    key: z.string(),
    action: z.literal("set"),
    value: z.json(),
  }),
  z.strictObject({ key: z.string(), action: z.literal("unset") }),
]);
// tool_call은 agent turn의 `lophn settings` 호출이다. approval 설정을 바꾸면 core가 그 tool call에 승인 카드를 연다.
// 없으면 물을 자리가 없어 agent의 approval 설정 바꾸기는 needs_approval이다. 사람 자격은 보지 않는다.
const settingsUpdateInputSchema = z.strictObject({
  tool_call: idSchema("tcl").optional(),
  changes: z
    .array(settingChangeInputSchema)
    .refine(
      (changes) =>
        new Set(changes.map((change) => change.key)).size === changes.length,
      { message: "duplicate setting changes" },
    ),
});
// rejected가 비어 있지 않으면 아무것도 쓰지 않은 것이다.
const settingsUpdateOutputSchema = z.strictObject({
  changed: z.array(z.string()),
  rejected: z.array(settingRejectionSchema),
  notes: z.array(settingNoteSchema),
});

export const settingsList = defineMemory({
  resource: "settings",
  method: "list",
  name: "SettingsList",
  input: settingsListInputSchema,
  output: settingsListOutputSchema,
  reads: ["settings"],
  actors: ["user", "agent", "app", "machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});
// `changes`를 적지 않는다. 설정 store가 바뀐 key마다 `StateChanged`를 내므로 적으면 두 번 난다.
export const settingsUpdate = defineMemory({
  resource: "settings",
  method: "update",
  name: "SettingsUpdate",
  input: settingsUpdateInputSchema,
  output: settingsUpdateOutputSchema,
  // agent는 locked가 아닌 설정만 바꾸고 approval 설정은 사람이 허락한 그 값만 쓴다(handler가 거르고 묻는다. 묻는 동안 답을
  // 기다린다). 어느 agent가 닿는지는 credential 상한(명령의 workspaces)이 정한다.
  actors: ["user", "agent"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

export const SETTINGS_FILE_ROUTES = [settingsList, settingsUpdate] as const;
