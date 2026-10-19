import { assertEquals } from "@std/assert";
import type { SkillEntry } from "../extensions/mod.ts";
import { promptSkills } from "./prepare.ts";

// 다른 domain의 skill이 prompt 목록에 켜진 채로 나가면 그 agent가 맡지 않은 domain의 규칙을 따른다.
Deno.test("agent가 맡지 않은 domain의 skill은 목록에서 꺼진다", () => {
  const entry = (name: string, domain: string | null) =>
    ({ name, description: name, enabled: true, domain }) as SkillEntry;
  const listed = promptSkills(
    [entry("global", null), entry("mine", "dom_a"), entry("other", "dom_b")],
    { skills: ["global", "mine", "other"], domains: ["dom_a"] },
  );
  assertEquals(
    listed.map((skill) => [skill.name, skill.enabled]),
    [["global", true], ["mine", true], ["other", false]],
  );
});
