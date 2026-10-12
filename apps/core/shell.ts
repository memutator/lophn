// shell이 core에 등록하는 것. 전역 읽기 폭과 OS notification opt-in 설정 항목이다(contracts#T24
// settings registry, shell/design-system#R23, platform/notifications#R9). shell은 이 key를
// settings.get·apply로만 읽고 쓴다.
import { z } from "zod";
import { defineSetting } from "../../packages/protocol/platform/mod.ts";

export const readingWidthSetting = defineSetting({
  key: "shell.reading_width",
  owner: "shell/design-system",
  display_name_key: "settings.reading-width.name",
  description: "Reading width shared by every document.",
  value_meaning_key: "settings.reading-width.value",
  default_meaning_key: "settings.reading-width.default",
  affected_features: ["shell/editor", "shell/design-system"],
  risk_key: "settings.reading-width.risk",
  revert_key: "settings.reading-width.revert",
  constraints: { choices: ["narrow", "default", "wide"] },
  required: false,
  layers: ["common"],
  // 열린 문서와 새로 여는 문서가 곧바로 같은 폭을 쓴다.
  apply_at: "current_check",
  apply_at_key: "settings.reading-width.apply-at",
  machine_local: false,
  default_present: true,
  default: "default",
  value_type: z.enum(["narrow", "default", "wide"]),
});

// OS notification은 사람이 켰을 때만 올린다(platform/notifications#R9). Electron main이
// 새 notification이 도착할 때마다 지금 값을 읽는다(main/desktop/os-notification.ts).
export const osNotificationsSetting = defineSetting({
  key: "shell.os_notifications",
  owner: "shell/desktop",
  display_name_key: "settings.os-notifications.name",
  description:
    "Show a desktop notification when something needs your attention.",
  value_meaning_key: "settings.os-notifications.value",
  default_meaning_key: "settings.os-notifications.default",
  affected_features: ["shell/desktop", "platform/notifications"],
  risk_key: "settings.os-notifications.risk",
  revert_key: "settings.os-notifications.revert",
  constraints: {},
  required: false,
  layers: ["common"],
  apply_at: "current_check",
  apply_at_key: "settings.os-notifications.apply-at",
  machine_local: false,
  default_present: true,
  default: false,
  value_type: z.boolean(),
});

// core 조립의 settings.ts가 모으는 shell 등록 항목이다(platform/settings#R31).
export const shellDefinitions = {
  settings: [readingWidthSetting, osNotificationsSetting],
};
