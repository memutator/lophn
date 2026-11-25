import { z } from "zod";
import { idSchema } from "../base/ids.ts";

// 한 줄이다. 사람이 쓰므로 길이만 막는다. 통합 권한 규칙(`permission-rules.ts`)도 이 pattern schema를 쓴다.
export const SHELL_RULE_ACTIONS = ["allow", "ask", "deny"] as const;

export const shellPatternSchema = z
  .string()
  .min(1)
  .max(500)
  .refine((value) => value.trim() !== "" && !/[\r\n]/.test(value), {
    message: "shell pattern is one non-blank line",
  });

// 옛 `approvals.shell_rules` 설정을 `approvals.permission_rules`로 옮기는 data step 전용이다.
// 새 코드는 `permission-rules.ts`의 `PERMISSION_RULES_SETTING_KEY`와 `permissionRuleSchema`를 쓴다.
export const shellRuleSchema = z.strictObject({
  pattern: shellPatternSchema,
  action: z.enum(SHELL_RULE_ACTIONS),
});
export type ShellRule = z.infer<typeof shellRuleSchema>;

export const LEGACY_SHELL_RULES_SETTING_KEY = "approvals.shell_rules";

export const shellRulesSettingSchema = z.strictObject({
  global: z.array(shellRuleSchema),
  projects: z.record(idSchema("prj"), z.array(shellRuleSchema)),
});
export type ShellRulesSetting = z.infer<typeof shellRulesSettingSchema>;

export const DEFAULT_SHELL_RULES_SETTING: ShellRulesSetting = {
  global: [],
  projects: {},
};
