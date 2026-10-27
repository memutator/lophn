// Shell rules의 순수 규칙: 설정 값에서 한 층의 한 줄만 고친 새 값을 만든다. 고친 층 밖의 줄은 그대로 둔다.
import type { MessageKey } from "@lophn/wording";

import {
  SHELL_RULE_ACTIONS,
  type ShellRulesSetting,
} from "../../../../../protocol/approvals/shell-rules.ts";
import type { ShellRule, ShellRuleAction, ShellRuleLayer } from "./source.ts";

export const ACTION_OPTIONS: readonly {
  readonly value: ShellRuleAction;
  readonly label: MessageKey;
}[] = SHELL_RULE_ACTIONS.map((value) => ({
  value,
  label: `settings.label.shell-action-${value}` as const,
}));

function rulesOf(value: ShellRulesSetting, layer: ShellRuleLayer) {
  return layer.kind === "global"
    ? value.global
    : (value.projects[layer.project] ?? []);
}

// 규칙이 모두 지워진 project는 키도 지운다. 지운 project의 id가 설정에 남아 목록에 계속 뜨지 않게 한다.
function withRules(
  value: ShellRulesSetting,
  layer: ShellRuleLayer,
  rules: ShellRule[],
): ShellRulesSetting {
  if (layer.kind === "global") return { ...value, global: rules };
  const { [layer.project]: _old, ...others } = value.projects;
  return {
    ...value,
    projects:
      rules.length === 0 ? others : { ...others, [layer.project]: rules },
  };
}

export function withAdded(
  value: ShellRulesSetting,
  layer: ShellRuleLayer,
  rule: ShellRule,
): ShellRulesSetting {
  return withRules(value, layer, [...rulesOf(value, layer), rule]);
}

export function withRemoved(
  value: ShellRulesSetting,
  layer: ShellRuleLayer,
  index: number,
): ShellRulesSetting {
  return withRules(
    value,
    layer,
    rulesOf(value, layer).filter((_, at) => at !== index),
  );
}

export function withAction(
  value: ShellRulesSetting,
  layer: ShellRuleLayer,
  index: number,
  action: ShellRuleAction,
): ShellRulesSetting {
  return withRules(
    value,
    layer,
    rulesOf(value, layer).map((rule, at) =>
      at === index ? { ...rule, action } : rule,
    ),
  );
}
