import {
  DEFAULT_SHARED_APPS_SETTING,
  SHARED_APPS_SETTING_KEY,
  sharedAppsSettingSchema,
} from "../../../protocol/approvals/mod.ts";
import { declareSetting } from "../../../protocol/config/mod.ts";

// coding agent에게 준 앱 slug. 사람이 공유 요청을 승인할 때만 더한다.
export const sharedAppsSetting = declareSetting({
  key: SHARED_APPS_SETTING_KEY,
  type: sharedAppsSettingSchema,
  default: DEFAULT_SHARED_APPS_SETTING,
  description:
    "Apps whose commands coding agents in the terminal may use. An app is added when the person approves a share request.",
  locked: true,
});
