import { z } from "zod";
import { withReadCommon } from "../base/envelope.ts";
import { idSchema } from "../base/ids.ts";
import { defineMemory, defineRead } from "../base/route.ts";
import { slugSchema } from "../projects/values.ts";
import type { WorkspaceKind } from "./workspaces.ts";

// 끈 skill의 정확한 이름이다(전역 설정, project `extensions.json`, agent 정의의 `skills_off`가 같은 규칙을 쓴다).
// 지금 발견되지 않는 이름도 그대로 둔다: 그 skill이 다시 나타나도 끈 채다. 와일드카드·패턴은 이름 규칙이 거절한다.
export const skillNameSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);
export const SKILLS_OFF_MAX = 256;

// 배포 기록 하나: 앱(slug)의 public skill 하나를 이 층에 배포했다. 층은 전역 설정, workspace `extensions.json`, agent 정의의 `deployed_skills`
// 셋이고 MCP·`skills_off`와 같다. skill 본문은 층에 복사하지 않는다: 앱의 active release bundle이 봉한 사본이고 기록은 그것을 가리킨다.
export const skillDeploymentSchema = z.strictObject({
  app: slugSchema,
  skill: skillNameSchema,
});
export type SkillDeployment = z.infer<typeof skillDeploymentSchema>;
// coding agent(터미널의 harness)에게 배포한 앱 skill의 설정 key다. 값은 lophn agent의 세 층과 같은 `{app, skill}` 목록이고 harness는 넷째 자리다.
// 사본은 `lophn harness sync-skills`가 harness의 skill 폴더에 쓴다. 바꾸는 길은 Settings › Coding agents와 `lophn skill deploy --to harness`다.
export const CODING_DEPLOYED_SKILLS_SETTING_KEY =
  "coding-agent.deployed_skills";
export const DEPLOYED_SKILLS_MAX = 256;
export const deployedSkillsSchema = z
  .array(skillDeploymentSchema)
  .max(DEPLOYED_SKILLS_MAX)
  .refine(
    (entries) =>
      new Set(entries.map((entry) => `${entry.app}/${entry.skill}`)).size ===
      entries.length,
    { message: "duplicate deployed skill" },
  );

// skill의 층은 내장, 전역, project·app, workspace-data이고 공유 skill(shared)이 더해진다. 끄기는 전역, workspace(Home, project, 앱), agent 세 층에서 한다.
// 같은 이름은 마지막 층이 덮는다. project·app은 그 workspace 폴더의 `.lophn/skills`, workspace-data는 Home·project·앱 그릇 자리의 `skills/`(폴더 없는 project도 받는다),
// shared는 그 session에 닿는 배포 기록(전역, workspace, agent)이 가리킨 앱 skill이고 앱의 active release가 내놓은 public skill이다.
export const SKILL_SOURCES = [
  "builtin",
  "global",
  "project",
  "app",
  "workspace-data",
  "shared",
] as const;
const skillSourceSchema = z.enum(SKILL_SOURCES);
export type SkillSource = z.infer<typeof skillSourceSchema>;

// 내장 skill 선언이다. 모두 끌 수 없다. 설명은 SKILL.md frontmatter에 있다. `menu`는 사람이 `/`로 부르는 skill인지이고
// prompt 목록에는 닿지 않는다.
export const BUILTIN_SKILLS: readonly {
  name: string;
  workspaces: readonly WorkspaceKind[];
  can_disable: false;
  menu: boolean;
}[] = [
  {
    name: "new-app",
    workspaces: ["home"],
    can_disable: false,
    menu: true,
  },
  {
    name: "repair-app",
    workspaces: ["home"],
    can_disable: false,
    menu: true,
  },
  {
    name: "update",
    workspaces: ["home"],
    can_disable: false,
    menu: true,
  },
  {
    name: "connect-computers",
    workspaces: ["home"],
    can_disable: false,
    menu: false,
  },
  {
    name: "write-artifact",
    workspaces: ["project", "app"],
    can_disable: false,
    menu: false,
  },
  {
    name: "write-workflow",
    workspaces: ["project"],
    can_disable: false,
    menu: false,
  },
  {
    name: "design-app",
    workspaces: ["app"],
    can_disable: false,
    menu: false,
  },
  {
    name: "migrate-sdk",
    workspaces: ["home", "project", "app"],
    can_disable: false,
    menu: false,
  },
  {
    name: "publish-package",
    workspaces: ["app"],
    can_disable: false,
    menu: false,
  },
  {
    name: "write-skill",
    workspaces: ["home", "project", "app"],
    can_disable: false,
    menu: true,
  },
];

const skillEntrySchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().min(1).max(1024),
  source: skillSourceSchema,
  enabled: z.boolean(),
  can_disable: z.boolean(),
});
export type SkillEntry = z.infer<typeof skillEntrySchema>;

// agent 설정 화면이 보는 skill 목록이다. `workspace`를 주면 전역과 내장에 그 workspace(Home, project, 앱)의 층을 더하고 안 주면
// 전역만이다(Settings). 같은 이름은 마지막 층이 덮고 가려진 쪽은 목록에 두지 않는다. 끈 skill도 목록에 남고 enabled만 false다.
// can_disable이 false인 내장 skill은 끌 수 없다.
// 열쇠는 mcp-settings의 `workspaceKeySchema`와 같다. mcp-settings가 이 파일을 import해서 여기서는 다시 적는다.
const skillsReadInputSchema = z.strictObject({
  workspace: z
    .union([z.literal("home"), idSchema("prj"), idSchema("app")])
    .optional(),
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
  reads: ["settings"],
  actors: ["user", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

const skillListEntrySchema = skillEntrySchema.extend({
  path: z.string().min(1),
});
export type SkillListEntry = z.infer<typeof skillListEntrySchema>;

const skillSkippedSchema = z.object({
  path: z.string().min(1),
  reason: z.string().min(1),
});
export type SkillSkippedEntry = z.infer<typeof skillSkippedSchema>;

// `lophn skill list`가 부르는 읽기 전용 route다. session workspace(사람 자격이면 --project/--app 또는 Home)에서
// 보이는 skill(경로 포함)과 발견에서 빠진 skipped 목록을 함께 돌려준다.
export const skillsList = defineMemory({
  resource: "skills",
  method: "list",
  name: "ListSkills",
  input: z.strictObject({
    project: z.string().min(1).optional(),
    app: z.string().min(1).optional(),
  }),
  output: z.object({
    skills: z.array(skillListEntrySchema),
    skipped: z.array(skillSkippedSchema),
  }),
  actors: ["user", "agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

export const SKILL_CHECK_ERROR_CODES = [
  "missing_manifest",
  "symlink_forbidden",
  "size_exceeded",
  "invalid_frontmatter",
  "name_dir_mismatch",
  "builtin_name_collision",
  "empty_body",
  "angle_brackets_in_description",
  "unfinished_todo",
  "unclosed_code_fence",
  "missing_companion",
] as const;
export type SkillCheckErrorCode = (typeof SKILL_CHECK_ERROR_CODES)[number];

export const SKILL_CHECK_WARNING_CODES = [
  "description_long",
  "body_long",
  "nested_subdirs_ignored",
  "auxiliary_file",
  "non_md_companion",
  "shadows_existing",
] as const;
export type SkillCheckWarningCode = (typeof SKILL_CHECK_WARNING_CODES)[number];

const skillCheckIssueSchema = z.object({
  code: z.string().min(1),
  file: z.string().min(1),
  message: z.string().min(1),
});
export type SkillCheckIssue = z.infer<typeof skillCheckIssueSchema>;

const skillCheckResultSchema = z.object({
  ok: z.boolean(),
  name: z.string().nullable(),
  bytes: z.object({
    manifest: z.number().int().nonnegative(),
    companions: z.record(z.string(), z.number().int().nonnegative()),
  }),
  errors: z.array(skillCheckIssueSchema),
  warnings: z.array(skillCheckIssueSchema),
});
export type SkillCheckResult = z.infer<typeof skillCheckResultSchema>;

// `lophn skill check <path>`가 부르는 읽기 전용 검사 route다. agent 자격은 그 session의 읽기 범위 안 폴더만 검사한다.
export const skillsCheck = defineMemory({
  resource: "skills",
  method: "check",
  name: "CheckSkill",
  input: z.strictObject({
    path: z.string().min(1),
    project: z.string().min(1).optional(),
    app: z.string().min(1).optional(),
  }),
  output: skillCheckResultSchema,
  actors: ["user", "agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

// `lophn skill deploy|undeploy|deployments`. 배포는 앱의 public skill 하나를 층 하나에 기록하는 일이다. `to`는 `global`, `workspace`(부른
// session의 workspace), `workspace:<project 이름·id, 앱 slug·id, home>`, `agent:<handle>`이다. 사람은 모두 하고, agent는 자기 앱 workspace의 앱
// skill과 Home lophn이면 묻지 않고 한다. 그 밖의 agent는 사람에게 묻고(`tool_call`이 그 카드를 연다) 사람이 없는 실행은 거절한다.
const deployTargetInput = {
  app: slugSchema,
  skill: skillNameSchema,
  to: z.string().min(1).max(200),
  tool_call: idSchema("tcl").optional(),
};
const deployErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

export const skillsDeploy = defineMemory({
  resource: "skills",
  method: "deploy",
  name: "DeploySkill",
  input: z.strictObject(deployTargetInput),
  output: z.object({ deployed: z.boolean() }),
  actors: ["user", "agent"],
  errors: [...deployErrors],
});

export const skillsUndeploy = defineMemory({
  resource: "skills",
  method: "undeploy",
  name: "UndeploySkill",
  input: z.strictObject(deployTargetInput),
  output: z.object({ removed: z.boolean() }),
  actors: ["user", "agent"],
  errors: [...deployErrors],
});

const deploymentRowSchema = z.object({
  app: slugSchema,
  skill: skillNameSchema,
  layer: z.enum(["global", "harness", "workspace", "agent"]),
  // workspace 층이면 그 workspace의 이름이고(project 이름, 앱 slug, `home`), agent 층이면 handle이다. 전역과 harness는 없다.
  at: z.string().nullable(),
});
export type SkillDeploymentRow = z.infer<typeof deploymentRowSchema>;

export const skillsDeployments = defineMemory({
  resource: "skills",
  method: "deployments",
  name: "ListSkillDeployments",
  input: z.strictObject({ app: slugSchema.optional() }),
  output: z.object({ deployments: z.array(deploymentRowSchema) }),
  actors: ["user", "agent"],
  errors: [...deployErrors],
});
