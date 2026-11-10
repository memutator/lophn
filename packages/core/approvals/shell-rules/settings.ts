import {
  DEFAULT_SHELL_RULES_SETTING,
  SHELL_RULES_SETTING_KEY,
  shellRulesSettingSchema,
} from "../../../protocol/approvals/mod.ts";
import { declareSetting } from "../../../protocol/config/mod.ts";

// 전역과 project 규칙. 제품 기본은 코드(PRODUCT_SHELL_RULES)에 있고 여기 담지 않는다.
export const shellRulesSetting = declareSetting({
  key: SHELL_RULES_SETTING_KEY,
  type: shellRulesSettingSchema,
  default: DEFAULT_SHELL_RULES_SETTING,
  description:
    "Rules that allow or deny shell commands an agent runs without asking, global and per project. Only the person changes it (Settings > Shell rules, or the answer to a permission question).",
  locked: true,
});
