import type { ShellRulesSetting } from "../../../protocol/approvals/mod.ts";
import type { Workspace } from "../../../protocol/lophn-agent/workspaces.ts";

// project workspace면 그 project 층에, 앱 workspace와 workspace 없는 lophn이면 전역에 allow 줄을 끝에 더한다.
export function withAlwaysRules(
  value: ShellRulesSetting,
  workspace: Workspace | null,
  patterns: readonly string[],
): ShellRulesSetting {
  const layer =
    workspace?.kind === "project"
      ? (value.projects[workspace.id] ?? [])
      : value.global;
  const next = [...layer];
  for (const pattern of patterns) {
    if (
      !next.some((rule) => rule.action === "allow" && rule.pattern === pattern)
    ) {
      next.push({ pattern, action: "allow" });
    }
  }
  return workspace?.kind === "project"
    ? { ...value, projects: { ...value.projects, [workspace.id]: next } }
    : { ...value, global: next };
}
