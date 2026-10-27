import assert from "node:assert/strict";
import { test } from "node:test";
import type { SkillEntry } from "../extensions/mod.ts";
import { promptSkills } from "./prepare.ts";

// 다른 domain의 skill이 prompt 목록에 켜진 채로 나가면 그 agent가 맡지 않은 domain의 규칙을 따른다.
test("agent가 맡지 않은 domain의 skill은 목록에서 꺼진다", () => {
  const entry = (name: string, domain: string | null) =>
    ({ name, description: name, enabled: true, domain }) as SkillEntry;
  const listed = promptSkills(
    [entry("global", null), entry("mine", "dom_a"), entry("other", "dom_b")],
    { skills: ["global", "mine", "other"], domains: ["dom_a"] },
  );
  assert.deepStrictEqual(
    listed.map((skill) => [skill.name, skill.enabled]),
    [
      ["global", true],
      ["mine", true],
      ["other", false],
    ],
  );
});

test("같은 이름의 skill은 전역과 맡은 domain 가운데 한 줄만 나간다", () => {
  const entry = (name: string, domain: string | null) =>
    ({
      name,
      description: `${name}:${domain}`,
      enabled: true,
      domain,
    }) as SkillEntry;
  const entries = [entry("x", null), entry("x", "dom_a"), entry("x", "dom_b")];
  const resolved = { skills: ["x"], domains: ["dom_b"] };
  assert.deepStrictEqual(promptSkills(entries, resolved), [
    { name: "x", description: "x:dom_b", enabled: true },
  ]);
  assert.deepStrictEqual(
    promptSkills(entries, { skills: ["x"], domains: [] }).map(
      (skill) => skill.description,
    ),
    ["x:null"],
  );
});
