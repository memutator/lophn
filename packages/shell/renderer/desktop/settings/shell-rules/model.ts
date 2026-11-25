// Permission rules의 순수 규칙: 설정 값에서 한 층의 한 줄만 고친 새 값을 만든다. 고친 층 밖의 줄은 그대로 둔다.
import type { MessageKey } from "@lophn/i18n";

import {
  PERMISSION_RULE_ACTIONS,
  PERMISSION_RULE_CATEGORIES,
  type PermissionRule,
  type PermissionRuleAction,
  type PermissionRuleCategory,
  type PermissionRulesSetting,
} from "../../../../../protocol/approvals/permission-rules.ts";
import type { ShellRuleLayer } from "./source.ts";

export const ACTION_OPTIONS: readonly {
  readonly value: PermissionRuleAction;
  readonly label: MessageKey;
}[] = PERMISSION_RULE_ACTIONS.map((value) => ({
  value,
  label: `settings.label.shell-action-${value}` as const,
}));

export const CATEGORY_OPTIONS: readonly {
  readonly value: PermissionRuleCategory;
  readonly label: MessageKey;
}[] = PERMISSION_RULE_CATEGORIES.map((value) => ({
  value,
  label: `settings.label.rule-category-${value}` as const,
}));

export function categoryLabelKey(category: PermissionRuleCategory): MessageKey {
  return `settings.label.rule-category-${category}`;
}

/**
 * 지나치게 넓은 shell 허용 규칙을 경고 표시로만 가려낸다(자동으로 지우지 않는다).
 * 예: `*`, `rm -rf *`, `sudo *`, `sh *`, `bash *`, `curl *`, `mv *`, `chmod *` 등.
 */
const BROAD_SHELL_PATTERN =
  /^(?:\*+|\s*|(?:sudo|su|sh|bash|zsh|dash|eval|env|curl|wget|mv|chmod|chown|dd)\b(?:\s*\*|\s+-|\s*$)|mkfs\S*\*?|rm\s+(?:-(?:[a-z]*[rf][a-z]*|\s+)*\*|-\S*[rf]\S*\s+\*|\*))/i;

export function isBroadShellPattern(rule: PermissionRule): boolean {
  if (rule.category !== "shell" || rule.action !== "allow") return false;
  const trimmed = rule.pattern.trim();
  if (trimmed === "*" || trimmed === "**") return true;
  return BROAD_SHELL_PATTERN.test(trimmed);
}

function rulesOf(value: PermissionRulesSetting, layer: ShellRuleLayer) {
  return layer.kind === "global"
    ? value.global
    : (value.projects[layer.project] ?? []);
}

// 규칙이 모두 지워진 project는 키도 지운다. 지운 project의 id가 설정에 남아 목록에 계속 뜨지 않게 한다.
function withRules(
  value: PermissionRulesSetting,
  layer: ShellRuleLayer,
  rules: PermissionRule[],
): PermissionRulesSetting {
  if (layer.kind === "global") return { ...value, global: rules };
  const { [layer.project]: _old, ...others } = value.projects;
  return {
    ...value,
    projects:
      rules.length === 0 ? others : { ...others, [layer.project]: rules },
  };
}

export function withAdded(
  value: PermissionRulesSetting,
  layer: ShellRuleLayer,
  rule: PermissionRule,
): PermissionRulesSetting {
  return withRules(value, layer, [...rulesOf(value, layer), rule]);
}

export function withRemoved(
  value: PermissionRulesSetting,
  layer: ShellRuleLayer,
  index: number,
): PermissionRulesSetting {
  return withRules(
    value,
    layer,
    rulesOf(value, layer).filter((_, at) => at !== index),
  );
}

export function withAction(
  value: PermissionRulesSetting,
  layer: ShellRuleLayer,
  index: number,
  action: PermissionRuleAction,
): PermissionRulesSetting {
  return withRules(
    value,
    layer,
    rulesOf(value, layer).map((rule, at) =>
      at === index ? { ...rule, action } : rule,
    ),
  );
}
