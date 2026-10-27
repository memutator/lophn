import { toWireToolName } from "../../../protocol/lophn-agent/tool-catalog.ts";

export type SkillListItem = {
  name: string;
  description: string;
  enabled: boolean;
};

// skill 목록 글이다. 이름과 설명만 싣고 꺼진 skill은 뺀다. 본문은 `skill.read`로 읽는다.
// 켜진 skill이 없으면 빈 문자열이다.
export function skillListText(skills: readonly SkillListItem[]): string {
  const on = skills
    .filter((s) => s.enabled)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  if (on.length === 0) return "";
  return [
    "# Skills",
    `Read a skill's full text with ${toWireToolName(
      "skill.read",
    )} when its description fits the work.`,
    ...on.map((s) => `- ${s.name}: ${s.description.replace(/\s+/g, " ")}`),
  ].join("\n");
}
