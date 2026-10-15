import { z } from "zod";
import { defineRead } from "../base/route.ts";
import { defineSetting } from "../config/settings.ts";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";

// skill 발견 root 정의 등록(settings registry).
// 사람이 등록한 절대 폴더를 등록 순서대로 발견한다. machine_local
// 이고 다음 run부터 적용한다. 기본은 등록 폴더가 없는 빈 목록이다.
// runtime이 같은 값 타입으로 읽도록 core 등록과 한 정의다.
export const skillFoldersSetting = defineSetting({
  key: "lophn-agent.extensions.skill_folders",
  owner: "lophn-agent/extensions",
  display_name_key: "settings.lophn-agent.skill_folders.name",
  description: "Registered absolute skill discovery roots in user order.",
  value_meaning_key: "settings.lophn-agent.skill_folders.value",
  default_meaning_key: "settings.lophn-agent.skill_folders.default",
  affected_features: ["lophn-agent/extensions"],
  risk_key: "settings.lophn-agent.skill_folders.risk",
  revert_key: "settings.lophn-agent.skill_folders.revert",
  constraints: {
    path: "absolute folder paths",
    max_entries: 64,
  },
  required: false,
  layers: ["common"],
  apply_at: "next_run",
  apply_at_key: "settings.lophn-agent.skill_folders.apply_at",
  machine_local: true,
  default_present: true,
  default: [],
  value_type: z.array(z.string().regex(/^(\/|[A-Za-z]:\\).+/)).max(64),
});

// skill의 출처다(extensions domain model SkillEntry.source_kind). 발견 순서 그대로다: 자리 층의 place가 먼저고
// 나머지 셋은 전역 층이다.
export const SKILL_SOURCE_KINDS = [
  "place",
  "registered",
  "personal",
  "bundled",
] as const;
export const skillSourceKindSchema = z.enum(SKILL_SOURCE_KINDS);
export type SkillSourceKind = z.infer<typeof skillSourceKindSchema>;

// 화면이 보이는 발견 목록의 한 줄이다. 본문·보조 자료·bundle 경로는 싣지 않는다.
export const skillSummarySchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  source_kind: skillSourceKindSchema,
});
export type SkillSummary = z.infer<typeof skillSummarySchema>;

// 같은 이름으로 가려진 skill이다. 먼저 발견한 출처가 이기고 진 출처를 사람에게 알린다.
export const skillShadowSchema = z.object({
  name: z.string().min(1).max(64),
  kept: skillSourceKindSchema,
  hidden: skillSourceKindSchema,
});
export type SkillShadow = z.infer<typeof skillShadowSchema>;

// 형식이 맞지 않아 목록에서 제외한 꾸러미의 경로와 이유다.
export const skillSkippedSchema = z.object({
  path: z.string().min(1),
  reason: z.string().min(1),
});
export type SkillSkipped = z.infer<typeof skillSkippedSchema>;

// 전역에서 끈 skill의 정확한 이름이다. 전역 등록
// 목록 쪽의 끄기라서 agent 정의의 `skills_off`와 따로이고 둘 중 하나라도 끄면 그 agent는 쓰지 못한다. 지금 발견되지
// 않는 이름도 그대로 둔다: 그 skill이 다시 나타나도 끈 채다. 와일드카드·패턴은 이름 규칙이 거절한다.
const skillNameSchema = z.string().max(64).regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export const SKILLS_OFF_MAX = 256;

export const skillsOffSetting = defineSetting({
  key: "lophn-agent.extensions.skills_off",
  owner: "lophn-agent/extensions",
  display_name_key: "settings.lophn-agent.skills_off.name",
  description: "Exact names of the skills switched off for every agent.",
  value_meaning_key: "settings.lophn-agent.skills_off.value",
  default_meaning_key: "settings.lophn-agent.skills_off.default",
  affected_features: ["lophn-agent/extensions"],
  risk_key: "settings.lophn-agent.skills_off.risk",
  revert_key: "settings.lophn-agent.skills_off.revert",
  constraints: {
    name: "lowercase letters, digits and single hyphens, up to 64 characters",
    max_entries: SKILLS_OFF_MAX,
  },
  required: false,
  layers: ["common"],
  apply_at: "next_run",
  apply_at_key: "settings.lophn-agent.skills_off.apply_at",
  machine_local: true,
  default_present: true,
  default: [],
  value_type: z.array(skillNameSchema).max(SKILLS_OFF_MAX),
});

// 전역 층의 출처만이다: 자리 skill은 place-extension-settings가 맡는다.
export const GLOBAL_SKILL_SOURCE_KINDS = [
  "registered",
  "personal",
  "bundled",
] as const;

// 전역 목록의 한 줄이다. 끈 skill도 목록에 남고 enabled만 false다. 본문·보조 자료·bundle 경로는 싣지 않는다.
export const globalSkillSummarySchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  source_kind: z.enum(GLOBAL_SKILL_SOURCE_KINDS),
  enabled: z.boolean(),
});

// 사람 화면(Settings › Agents)이 전역 skill을 보고 켜고 끄는 읽기다. 켜고 끄기는 `skillsOffSetting`을 settings
// apply로 바꾼다. skills_off는 지금 발견되지 않는 끈 이름까지 담아 화면이 바꿀 때 그 이름을 지우지 않게 한다.
// 같은 이름은 먼저 발견한 출처 하나만 목록에 두고 가려진 것과 제외한 꾸러미는 이유와 함께 알린다.
export const globalSkillsRead = defineRead({
  resource: "global-skills",
  method: "read",
  name: "ReadGlobalSkills",
  input: z.strictObject({}),
  output: withReadCommon(z.object({
    skills: z.array(globalSkillSummarySchema),
    skills_off: z.array(z.string()),
    shadowed: z.array(skillShadowSchema),
    skipped: z.array(skillSkippedSchema),
  })),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

// skill의 층은 전역, project이고 끄기는 전역, project, agent 세 층에서 한다. 같은 이름은 마지막 층이 덮는다.
// 내장 skill은 lophn이 가진다.
export const SKILL_SOURCES = ["builtin", "global", "project"] as const;
export const skillSourceSchema = z.enum(SKILL_SOURCES);

// 내장 skill 선언이다. description은 skill 목록에 들어가는 영어 한 줄이다.
export const BUILTIN_SKILLS = [
  {
    name: "context-init",
    role: "project_manager",
    can_disable: false,
    description:
      "Set the project's purpose, then draft the first context version with its contract and search scripts, test it, and publish it.",
  },
  {
    name: "context-update",
    role: "project_manager",
    can_disable: false,
    description:
      "Draft a new context version from the applied one, test it, and publish it.",
  },
] as const;

export const skillEntrySchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  source: skillSourceSchema,
  enabled: z.boolean(),
  can_disable: z.boolean(),
});
export type SkillEntry = z.infer<typeof skillEntrySchema>;

// agent 설정 화면이 보는 skill 목록이다. `project`를 주면 전역과 내장에 그 project 층을 더한다. 같은 이름은
// 마지막 층이 덮고 가려진 쪽은 목록에 두지 않는다. 끈 skill도 목록에 남고 enabled만 false다. can_disable이
// false인 내장 skill은 끌 수 없다.
export const skillsReadInputSchema = z.strictObject({
  project: idSchema("prj").optional(),
});

export const skillsRead = defineRead({
  resource: "skills",
  method: "read",
  name: "ReadSkills",
  input: skillsReadInputSchema,
  output: withReadCommon(z.object({
    skills: z.array(skillEntrySchema),
    skills_off: z.array(z.string()),
  })),
  actors: ["user", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});
