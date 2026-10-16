import { z } from "zod";
import { defineRead } from "../base/route.ts";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";

// 전역에서 끈 skill의 정확한 이름이다. 전역 등록
// 목록 쪽의 끄기라서 agent 정의의 `skills_off`와 따로이고 둘 중 하나라도 끄면 그 agent는 쓰지 못한다. 지금 발견되지
// 않는 이름도 그대로 둔다: 그 skill이 다시 나타나도 끈 채다. 와일드카드·패턴은 이름 규칙이 거절한다.
export const skillNameSchema = z.string().max(64).regex(
  /^[a-z0-9]+(-[a-z0-9]+)*$/,
);
export const SKILLS_OFF_MAX = 256;

// skill의 층은 전역, project이고 끄기는 전역, project, agent 세 층에서 한다. 같은 이름은 마지막 층이 덮는다.
// 내장 skill은 lophn이 가진다.
export const SKILL_SOURCES = ["builtin", "global", "project"] as const;
const skillSourceSchema = z.enum(SKILL_SOURCES);
export type SkillSource = z.infer<typeof skillSourceSchema>;

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

const skillEntrySchema = z.object({
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
const skillsReadInputSchema = z.strictObject({
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
