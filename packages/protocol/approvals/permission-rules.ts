import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { atSchema } from "../base/values.ts";
import { permissionModeSchema } from "../lophn-agent/turn-values.ts";
import { shellPatternSchema } from "./shell-rules.ts";

// 통합 권한 규칙과 approvals 설정 계약. 규칙·신뢰 목록은 data root 설정(core 소유)에만 둔다.
export const PERMISSION_RULE_CATEGORIES = [
  "shell",
  "file",
  "app_tool",
  "mcp_tool",
  "local_tool",
] as const;
export const permissionRuleCategorySchema = z.enum(PERMISSION_RULE_CATEGORIES);
export type PermissionRuleCategory = z.infer<
  typeof permissionRuleCategorySchema
>;

export const PERMISSION_RULE_ACTIONS = ["allow", "ask", "deny"] as const;
export const permissionRuleActionSchema = z.enum(PERMISSION_RULE_ACTIONS);
export type PermissionRuleAction = z.infer<typeof permissionRuleActionSchema>;

export const PERMISSION_RULE_SOURCES = [
  "floor",
  "product",
  "global",
  "project",
] as const;
export const permissionRuleSourceSchema = z.enum(PERMISSION_RULE_SOURCES);
export type PermissionRuleSource = z.infer<typeof permissionRuleSourceSchema>;

export const permissionRuleSchema = z.strictObject({
  id: z.string().min(1),
  category: permissionRuleCategorySchema,
  pattern: shellPatternSchema,
  action: permissionRuleActionSchema,
  reason: z.string().max(200).optional(),
  source: permissionRuleSourceSchema.optional(),
});
export type PermissionRule = z.infer<typeof permissionRuleSchema>;

// Gate가 받는 규칙 층. floor는 어느 층도 덮지 못하고, 전역·project는 deny > ask > allow 고정 우선으로 평가한다.
export type PermissionRuleLayers = {
  floor: readonly PermissionRule[];
  global: readonly PermissionRule[];
  project: readonly PermissionRule[];
};

const RM_FLAGS = ["-rf", "-fr", "-r -f", "-f -r"];
const RM_EVERYTHING = ["/", "~", "~/", "/\\*", "~/\\*"];

const floorShellRule = (pattern: string, index: number): PermissionRule => ({
  id: `floor-shell-${index}`,
  category: "shell",
  pattern,
  action: "deny",
  source: "floor",
});

const productAskShellRule = (
  pattern: string,
  index: number,
): PermissionRule => ({
  id: `product-shell-ask-${index}`,
  category: "shell",
  pattern,
  action: "ask",
  source: "product",
});

// floor는 사람도 덮지 못하므로 좁게 둔다. `rm -rf /*`처럼 `*`로 쓰면 `rm -rf /tmp/x`까지 막혀
// 일을 못 하므로, 글자 그대로의 `/*`·`~/*`만 floor에 둔다(`\*`).
export const PRODUCT_SHELL_RULES: {
  floor: PermissionRule[];
  ask: PermissionRule[];
} = {
  floor: [
    ...["", "sudo "].flatMap((sudo) => [
      ...RM_FLAGS.flatMap((flags) =>
        RM_EVERYTHING.map((target) => `${sudo}rm ${flags} ${target}`),
      ),
      `${sudo}mkfs*`,
      `${sudo}dd * of=/dev/*`,
    ]),
    ":(){ :|:& };:",
  ].map(floorShellRule),
  ask: [
    "rm -r*",
    "rm -fr*",
    "rm -f -r*",
    "git push*--force*",
    "git push* -f*",
    "git reset --hard*",
    "curl * | sh *",
    "curl * | bash *",
    "wget * | sh *",
    "wget * | bash *",
  ].map(productAskShellRule),
};

export const PRODUCT_FLOOR_RULES: readonly PermissionRule[] =
  PRODUCT_SHELL_RULES.floor;

// Settings key `approvals.permission_rules`의 값. `declareSetting`은 core가 한다.
export const PERMISSION_RULES_SETTING_KEY = "approvals.permission_rules";

export const permissionRulesSettingSchema = z.strictObject({
  global: z.array(permissionRuleSchema),
  projects: z.record(idSchema("prj"), z.array(permissionRuleSchema)),
});
export type PermissionRulesSetting = z.infer<
  typeof permissionRulesSettingSchema
>;

export const DEFAULT_PERMISSION_RULES_SETTING: PermissionRulesSetting = {
  global: [],
  projects: {},
};

// Settings key `approvals.default_mode`의 값. agent 정의의 `permission_mode`가 비어 있을 때 새 session이 따르는 전역 기본 단계다.
export const DEFAULT_MODE_SETTING_KEY = "approvals.default_mode";

// Settings key `approvals.workflow_modes`의 값. `<project_id>/<workflow_name>` -> `<participant_key>` -> `PermissionMode`.
export const WORKFLOW_MODES_SETTING_KEY = "approvals.workflow_modes";

export const workflowModesSettingSchema = z.record(
  z.string().min(1),
  z.record(z.string().min(1), permissionModeSchema),
);
export type WorkflowModesSetting = z.infer<typeof workflowModesSettingSchema>;

export const DEFAULT_WORKFLOW_MODES_SETTING: WorkflowModesSetting = {};

// Settings key `approvals.local_tool_trust`의 값. `.lophn/tools/*`·`<data root>/tools/*` 스크립트의 신뢰한 `(실제 경로, sha256)` 목록이다.
export const LOCAL_TOOL_TRUST_SETTING_KEY = "approvals.local_tool_trust";

export const localToolTrustEntrySchema = z.strictObject({
  path: z.string().min(1),
  sha256: z.string().min(1),
  trusted_at: atSchema,
});
export type LocalToolTrustEntry = z.infer<typeof localToolTrustEntrySchema>;

export const localToolTrustSettingSchema = z.array(localToolTrustEntrySchema);
export type LocalToolTrustSetting = z.infer<typeof localToolTrustSettingSchema>;

export const DEFAULT_LOCAL_TOOL_TRUST_SETTING: LocalToolTrustSetting = [];
