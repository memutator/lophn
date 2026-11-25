import { createHash } from "node:crypto";
import type { IdSource } from "../../../base/mod.ts";
import type {
  PermissionRule,
  PermissionRulesSetting,
} from "../../../protocol/approvals/mod.ts";
import type { Workspace } from "../../../protocol/lophn-agent/workspaces.ts";

function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

// project workspace면 그 project 층에, 앱 workspace와 workspace 없는 lophn이면 전역에 allow 규칙을 더한다.
export function withAlwaysPermissionRules(
  value: PermissionRulesSetting,
  workspace: Workspace | null,
  patterns: readonly string[],
  ids?: IdSource,
): PermissionRulesSetting {
  const isProject = workspace?.kind === "project";
  const layer = isProject ? (value.projects[workspace.id] ?? []) : value.global;
  const source: PermissionRule["source"] = isProject ? "project" : "global";
  const next = [...layer];

  for (const pattern of patterns) {
    if (
      next.some(
        (rule) =>
          rule.category === "shell" &&
          rule.action === "allow" &&
          rule.pattern === pattern,
      )
    ) {
      continue;
    }
    const id = ids
      ? ids.newId("grt")
      : `rule-shell-${shortHash(`${source}\0${pattern}`)}`;
    next.push({
      id,
      category: "shell",
      pattern,
      action: "allow",
      source,
    });
  }

  return isProject
    ? { ...value, projects: { ...value.projects, [workspace.id]: next } }
    : { ...value, global: next };
}
