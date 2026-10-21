import type { ShellRulesSetting } from "../../../protocol/approvals/mod.ts";
import type { Place } from "../../../protocol/lophn-agent/places.ts";

// project place면 그 project 층에, 앱 place와 place 없는 lophn이면 전역에 allow 줄을 끝에 더한다.
export function withAlwaysRules(
  value: ShellRulesSetting,
  place: Place | null,
  patterns: readonly string[],
): ShellRulesSetting {
  const layer = place?.kind === "project"
    ? value.projects[place.id] ?? []
    : value.global;
  const next = [...layer];
  for (const pattern of patterns) {
    if (
      !next.some((rule) => rule.action === "allow" && rule.pattern === pattern)
    ) {
      next.push({ pattern, action: "allow" });
    }
  }
  return place?.kind === "project"
    ? { ...value, projects: { ...value.projects, [place.id]: next } }
    : { ...value, global: next };
}
