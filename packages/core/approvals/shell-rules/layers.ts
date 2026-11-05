import {
  PRODUCT_SHELL_RULES,
  type ShellRuleLayers,
  type ShellRulesSetting,
} from "../../../protocol/approvals/mod.ts";
import type { Workspace } from "../../../protocol/lophn-agent/workspaces.ts";

// 앱 workspace의 turn은 project 층이 없다. 제품 기본과 전역만 본다.
export function shellRuleLayers(
  value: ShellRulesSetting,
  workspace: Workspace | null,
): ShellRuleLayers {
  return {
    floor: PRODUCT_SHELL_RULES.floor,
    layers: [
      PRODUCT_SHELL_RULES.ask,
      value.global,
      workspace?.kind === "project" ? (value.projects[workspace.id] ?? []) : [],
    ],
  };
}
