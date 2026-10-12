import { assert, assertEquals } from "@std/assert";
import { ERROR_CODES } from "../../base/mod.ts";
import { routePath, settingDefinitionSchema } from "../platform/mod.ts";
import {
  GLOBAL_SKILL_SOURCE_KINDS,
  globalSkillsRead,
  globalSkillSummarySchema,
  SKILL_SOURCE_KINDS,
  skillShadowSchema,
  skillSkippedSchema,
  skillsOffSetting,
  skillSummarySchema,
} from "./skill-settings.ts";

Deno.test("lophn-agent/extensions#R1 [agent-I19b]: a skill comes from the place, a registered folder, the personal store or the bundle, in that order", () => {
  assertEquals([...SKILL_SOURCE_KINDS], [
    "place",
    "registered",
    "personal",
    "bundled",
  ]);
  for (const source_kind of SKILL_SOURCE_KINDS) {
    assert(
      skillSummarySchema.safeParse({
        name: "review-notes",
        description: "Reads review notes",
        source_kind,
      }).success,
    );
  }
  assert(
    !skillSummarySchema.safeParse({
      name: "review-notes",
      description: "Reads review notes",
      source_kind: "workspace",
    }).success,
  );
});

Deno.test("lophn-agent/extensions#R33 [agent-I19b]: a hidden skill is reported with the source that won and the source that lost", () => {
  assert(
    skillShadowSchema.safeParse({
      name: "review-notes",
      kept: "place",
      hidden: "registered",
    }).success,
  );
  assert(
    !skillShadowSchema.safeParse({
      name: "review-notes",
      kept: "place",
      hidden: "elsewhere",
    }).success,
  );
});

Deno.test("lophn-agent/extensions#R2 [agent-I19b]: an excluded skill folder is reported with its path and the reason", () => {
  assert(
    skillSkippedSchema.safeParse({
      path: "/data/projects/prj/skills/Bad_Name",
      reason: "skill name uses characters outside lowercase letters",
    }).success,
  );
  assert(!skillSkippedSchema.safeParse({ path: "/x" }).success);
});

const common = { as_of_seq: "3", next_cursor: null };

Deno.test("lophn-agent/extensions#R1 shell/desktop#R50 [agent-I49]: 전역 skill 목록은 사람 화면이 읽는 route 하나이고 입력은 비어 있으며 machine과 agent는 읽지 못한다", () => {
  assertEquals(routePath(globalSkillsRead), "/v1/global-skills/read");
  assertEquals(globalSkillsRead.kind, "read");
  assertEquals(globalSkillsRead.name, "ReadGlobalSkills");
  assertEquals([...globalSkillsRead.actors], ["user"]);
  // 자리를 입력으로 받지 않는다: 자리 skill은 place-extension-settings가 맡는다.
  assert(globalSkillsRead.input.safeParse({}).success);
  assert(!globalSkillsRead.input.safeParse({ place: "prj" }).success);
  assert(!globalSkillsRead.input.safeParse({ limit: 5 }).success);
  assert(globalSkillsRead.errors.every((code) => ERROR_CODES.includes(code)));
  assert(!globalSkillsRead.errors.includes("internal"));
});

Deno.test("lophn-agent/extensions#R1 R3 R33 shell/desktop#R50 [agent-I49]: 전역 목록의 한 줄은 이름·설명·전역 출처·켜짐이고 자리 출처는 들어오지 않으며 끈 이름은 지금 없는 것도 함께 온다", () => {
  assertEquals([...GLOBAL_SKILL_SOURCE_KINDS], [
    "registered",
    "personal",
    "bundled",
  ]);
  const line = {
    name: "review-notes",
    description: "Reads review notes",
    source_kind: "registered",
    enabled: false,
  };
  const output = {
    ...common,
    skills: [line],
    skills_off: ["review-notes", "gone-skill"],
    shadowed: [{ name: "x", kept: "registered", hidden: "bundled" }],
    skipped: [{ path: "/skills/Bad_Name", reason: "skill name is bad" }],
  };
  assert(globalSkillsRead.output.safeParse(output).success);
  for (const source_kind of GLOBAL_SKILL_SOURCE_KINDS) {
    assert(
      globalSkillsRead.output.safeParse({
        ...output,
        skills: [{ ...line, source_kind }],
      }).success,
    );
  }
  assert(
    !globalSkillsRead.output.safeParse({
      ...output,
      skills: [{ ...line, source_kind: "place" }],
    }).success,
  );
  assert(
    !globalSkillsRead.output.safeParse({
      ...output,
      skills: [{ name: line.name, description: line.description }],
    }).success,
  );
  // 본문·보조 자료·bundle 경로는 싣지 않는다(R5).
  assertEquals(Object.keys(globalSkillSummarySchema.shape).sort(), [
    "description",
    "enabled",
    "name",
    "source_kind",
  ]);
  assert(
    !globalSkillsRead.output.safeParse({ ...output, skills_off: undefined })
      .success,
  );
});

Deno.test("shell/desktop#Q22 lophn-agent/extensions#R4 [agent-I49]: 전역에서 끈 skill은 정확한 이름 목록 설정 하나이고 기본은 빈 목록이다", () => {
  assertEquals(skillsOffSetting.key, "lophn-agent.extensions.skills_off");
  assertEquals(skillsOffSetting.owner, "lophn-agent/extensions");
  assertEquals(skillsOffSetting.apply_at, "next_run");
  assertEquals(skillsOffSetting.machine_local, true);
  assertEquals(skillsOffSetting.default_present, true);
  assertEquals(skillsOffSetting.default, []);
  assert(skillsOffSetting.value_type.safeParse([]).success);
  assert(
    skillsOffSetting.value_type.safeParse(["review-notes", "x1-y"]).success,
  );
  // 와일드카드·패턴·잘못된 이름·이름이 아닌 값은 거절이다(R30).
  for (
    const bad of [
      ["review*"],
      ["Review"],
      ["-lead"],
      ["a--b"],
      ["a".repeat(65)],
      [""],
      [3],
      "review-notes",
    ]
  ) {
    assert(!skillsOffSetting.value_type.safeParse(bad).success, String(bad));
  }
  assert(
    !skillsOffSetting.value_type.safeParse(
      Array.from({ length: 257 }, (_, at) => `skill-${at}`),
    ).success,
  );
  // 설정 registry가 공개하는 모양을 통과한다.
  assert(
    settingDefinitionSchema.safeParse({
      key: skillsOffSetting.key,
      owner: skillsOffSetting.owner,
      display_name_key: skillsOffSetting.display_name_key,
      description: skillsOffSetting.description,
      value_meaning_key: skillsOffSetting.value_meaning_key,
      default_meaning_key: skillsOffSetting.default_meaning_key,
      affected_features: [...skillsOffSetting.affected_features],
      risk_key: skillsOffSetting.risk_key,
      revert_key: skillsOffSetting.revert_key,
      constraints: skillsOffSetting.constraints,
      required: skillsOffSetting.required,
      layers: [...skillsOffSetting.layers],
      apply_at: skillsOffSetting.apply_at,
      apply_at_key: skillsOffSetting.apply_at_key,
      machine_local: skillsOffSetting.machine_local,
      value_type: { type: "array" },
      default_present: true,
      default: [],
    }).success,
  );
});
