import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineRead } from "../base/route.ts";
import type { PlaceKind } from "./places.ts";

// 끈 skill의 정확한 이름이다(전역 설정, project `extensions.json`, agent 정의의 `skills_off`가 같은 규칙을 쓴다).
// 지금 발견되지 않는 이름도 그대로 둔다: 그 skill이 다시 나타나도 끈 채다. 와일드카드·패턴은 이름 규칙이 거절한다.
export const skillNameSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export const SKILLS_OFF_MAX = 256;

// skill의 층은 내장, 전역, project·app, domain이고 공유 skill(shared)이 더해진다. 끄기는 전역, project, agent 세 층에서 한다. 같은 이름은 마지막 층이
// 덮고, 같은 층의 domain끼리는 domain 이름이 앞서는 쪽이 이긴다.
// project·app은 그 place 폴더의 `.lophn/skills`, shared는 할당한 앱의 active release가 내놓은 public skill이다.
export const SKILL_SOURCES = [
  "builtin",
  "global",
  "project",
  "app",
  "domain",
  "shared",
] as const;
const skillSourceSchema = z.enum(SKILL_SOURCES);
export type SkillSource = z.infer<typeof skillSourceSchema>;

// 내장 skill 선언이다. 모두 끌 수 없다. 설명은 SKILL.md frontmatter에 있다. `menu`는 사람이 `/`로 부르는 skill인지이고
// prompt 목록에는 닿지 않는다.
export const BUILTIN_SKILLS: readonly {
  name: string;
  places: readonly PlaceKind[];
  can_disable: false;
  menu: boolean;
}[] = [
  {
    name: "new-app",
    places: ["home"],
    can_disable: false,
    menu: true,
  },
  {
    name: "repair-app",
    places: ["home"],
    can_disable: false,
    menu: true,
  },
  {
    name: "make-domain",
    places: ["home", "project", "app"],
    can_disable: false,
    menu: false,
  },
  {
    name: "write-artifact",
    places: ["project", "app"],
    can_disable: false,
    menu: false,
  },
  {
    name: "write-workflow",
    places: ["project"],
    can_disable: false,
    menu: false,
  },
  {
    name: "check-domains",
    places: ["project"],
    can_disable: false,
    menu: true,
  },
  {
    name: "design-app",
    places: ["app"],
    can_disable: false,
    menu: false,
  },
  {
    name: "write-kinds",
    places: ["project", "app"],
    can_disable: false,
    menu: false,
  },
];

const skillEntrySchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  source: skillSourceSchema,
  enabled: z.boolean(),
  can_disable: z.boolean(),
  // domain 층 skill이면 그 domain id다. 내장·전역 skill은 null이다.
  domain: z.string().min(1).nullable(),
});
export type SkillEntry = z.infer<typeof skillEntrySchema>;

// agent 설정 화면이 보는 skill 목록이다. `project`나 `app`을 주면 전역과 내장에 그 그릇의 domain 층을 더한다. 같은 이름은
// 마지막 층이 덮고 가려진 쪽은 목록에 두지 않는다. 끈 skill도 목록에 남고 enabled만 false다. can_disable이
// false인 내장 skill은 끌 수 없다.
const skillsReadInputSchema = z
  .strictObject({
    project: idSchema("prj").optional(),
    app: idSchema("app").optional(),
  })
  .refine((input) => input.project === undefined || input.app === undefined, {
    message: "pass project or app, not both",
  });

export const skillsRead = defineRead({
  resource: "skills",
  method: "read",
  name: "ReadSkills",
  input: skillsReadInputSchema,
  output: withReadCommon(
    z.object({
      skills: z.array(skillEntrySchema),
      skills_off: z.array(z.string()),
    }),
  ),
  actors: ["user", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});
