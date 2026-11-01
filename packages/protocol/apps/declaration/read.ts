import { z } from "zod";
import { defineRead } from "../../base/route.ts";
import { iconReadOutputSchema, type IconImage } from "../../base/icon.ts";
import { jsonValueSchema } from "../../base/json-values.ts";
import { sha256Schema } from "../../base/values.ts";
import { withReadCommon } from "../../base/envelope.ts";
import { appIdSchema, slugSchema } from "../../projects/values.ts";
import { appInputSchema, releaseIdSchema } from "../apps.ts";
import { permissionRequirementSchema } from "../permissions.ts";

// 앱 하나의 active release 고정 선언을 사람과 agent가 읽는 모양이다.
// 선언 전체가 아니라 바깥 명령(`tools`)과 화면·operation의 설명과 근거 구분이다. 범위 밖·없는 앱·active release가
// 없는 앱은 같은 not_found로 답한다.
const appCommandSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  // 정규 InputSchema. 인자가 없는 command는 null이다.
  inputSchema: jsonValueSchema.nullable(),
  effect: z.enum(["read", "write", "external"]),
  // 다른 domain에 보이는지.
  public: z.boolean(),
  // command가 다루는 객체의 domain.
  domain: z.string().min(1),
});
export type AppCommand = z.infer<typeof appCommandSchema>;

// 화면이 부르는 앱 안의 operation. 화면 허용 목록의 재료이고 agent의 도구 목록에는 오르지 않는다.
const appOperationSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  effect: z.enum(["read", "write", "external"]),
});
export type AppOperation = z.infer<typeof appOperationSchema>;

const appDeclarationScreenSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  path: z.string().min(1),
  sizes: z.array(z.enum(["full", "panel", "card"])).min(1),
});

// 설명과 구조 검증은 서로 다른 근거다. 설명이 완성됐다는 것만으로 구조가 맞다고 표시하지 않는다.
const appDeclarationEvidenceSchema = z.object({
  description: z.object({
    complete: z.boolean(),
    // 설명이 비었거나 없는 자리. 예 `commands.add.inputSchema.title`.
    gaps: z.array(z.string().min(1)),
  }),
  structure: z.object({ validated: z.literal(true) }),
});

// 현재 release의 선언 사실이다. 실행 범위(선언 ∩ active grant)를 계산하는 읽는 쪽이 쓴다.
// 선언에 이미 있는 값을 계산에 쓰기 좋게 풀어 둔 것이고 새 사실이 아니다.
const appFactsSchema = z.object({
  permissions: z.array(permissionRequirementSchema),
  app_connections: z.array(
    z.object({
      app: appIdSchema,
      tools: z.array(z.string().min(1)),
    }),
  ),
  // operation과 command의 handler 이름 전부.
  tools: z.array(z.string().min(1)),
});

const appDeclarationOutputSchema = withReadCommon(
  z.object({
    app: appIdSchema,
    release: releaseIdSchema,
    declaration_hash: sha256Schema,
    name: z.string().min(1),
    description: z.string().min(1),
    // 바깥 명령. 이름은 route 이름(`app.tools`)을 따른다.
    tools: z.array(appCommandSchema),
    operations: z.array(appOperationSchema),
    screens: z.array(appDeclarationScreenSchema),
    facts: appFactsSchema,
    evidence: appDeclarationEvidenceSchema,
  }),
);

export const appTools = defineRead({
  resource: "apps",
  method: "tools",
  name: "app.tools",
  input: appInputSchema.extend({ release: releaseIdSchema.optional() }),
  output: appDeclarationOutputSchema,
  actors: ["user", "agent", "app", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

// `app.icon`. 사람이 올린 icon이 있으면 그것, 없으면 active release 선언의 icon 파일 하나다. data는 base64다.
// 올린 icon도 선언도 없거나 파일이 없거나 크거나 bundle 밖을 가리키면 icon이 null이다(오류가 아니다. 앱은 기본 모양으로 보인다).
export const appIcon = defineRead({
  resource: "apps",
  method: "icon",
  name: "app.icon",
  input: appInputSchema,
  output: iconReadOutputSchema,
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

// `app.skills`. 앱 slug마다 active release bundle의 public skill(선언 `skills[].public`)이다. SKILL.md 전체와 옆에 딸린
// `.md` 파일 본문을 싣는다. 없는 slug, 보관한 앱, active release가 없는 앱, 읽을 수 없는 skill은 오류 없이 뺀다.
// agent의 공유 skill 받기와 coding agent harness 사본이 같은 것을 읽는다.
export const appSkills = defineRead({
  resource: "apps",
  method: "skills",
  name: "app.skills",
  input: z.strictObject({ apps: z.array(slugSchema).max(64) }),
  output: z.object({
    skills: z.array(
      z.object({
        app: appIdSchema,
        slug: slugSchema,
        release: releaseIdSchema,
        name: z.string().min(1),
        description: z.string().min(1),
        skill_md: z.string(),
        files: z.array(z.object({ name: z.string(), text: z.string() })),
      }),
    ),
  }),
  actors: ["user", "machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

// `app.tool_index`. 모든 앱의 이름·설명과 바깥 command 목록이다. 앱 범위 판정을 하지 않는 대신
// 돌려주는 칸이 이것뿐이라 source 경로, 앱 log, 호출 기록은 새지 않는다. 호출 모양(inputSchema)은
// 입력에 app이 있을 때만 싣는다(전체 목록에서는 칸이 없다). 목록이 앱 수에 비례해 커지는 것을 줄이기 위해서다.
// inputSchema는 인자가 없으면 null이다.
const appToolIndexEntrySchema = z.object({
  app: appIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  tools: z.array(
    z.object({
      name: z.string().min(1),
      description: z.string().min(1),
      effect: z.enum(["read", "write", "external"]),
      public: z.boolean(),
      domain: z.string().min(1),
      inputSchema: jsonValueSchema.nullable().optional(),
    }),
  ),
});
export type AppToolIndexEntry = z.infer<typeof appToolIndexEntrySchema>;

export const appToolIndex = defineRead({
  resource: "apps",
  method: "tool_index",
  name: "app.tool_index",
  input: z.strictObject({ app: appIdSchema.optional() }),
  output: withReadCommon(z.object({ apps: z.array(appToolIndexEntrySchema) })),
  actors: ["user", "agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});
export type AppIcon = IconImage;
