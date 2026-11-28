import { z } from "zod";
import { defineRead } from "../../base/route.ts";
import { iconImageSchema } from "../../base/icon.ts";
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
  // 다른 앱의 agent에 보이는지.
  public: z.boolean(),
});
export type AppCommand = z.infer<typeof appCommandSchema>;

// 화면이 부르는 앱 안의 operation. 화면 허용 목록의 재료이고 agent의 도구 목록에는 오르지 않는다.
const appOperationSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  effect: z.enum(["read", "write", "external"]),
});
export type AppOperation = z.infer<typeof appOperationSchema>;

// 숫자면 고정, 범위면 화면 내용에 맞춘다.
const traySideSchema = z.union([
  z.number().int(),
  z.object({
    min: z.number().int().optional(),
    max: z.number().int().optional(),
  }),
]);

const appDeclarationScreenSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  path: z.string().min(1),
  places: z
    .array(z.enum(["tab", "panel", "card", "sidebar", "tray", "phone"]))
    .min(1),
  // 정규 InputSchema. 없으면 인자가 없는 화면이다.
  params: jsonValueSchema.optional(),
  // tray popup의 크기(px). 없는 쪽은 lophn 기본값이다.
  tray: z
    .object({
      width: traySideSchema.optional(),
      height: traySideSchema.optional(),
    })
    .optional(),
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

// 앱이 낸 key. 칸이 없는 선언은 없다. shell이 Settings 줄과 앱 page의 key 글을 만든다.
const appKeySchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  key: z.object({
    mac: z.string().min(1).optional(),
    other: z.string().min(1),
  }),
  context: z.string().min(1).optional(),
});

// 앱이 내는 event와 듣는 event. 칸이 없는 선언은 없다.
const appEventSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  // 정규 InputSchema(root는 object).
  payloadSchema: jsonValueSchema,
  across_machines: z.boolean().optional(),
});
const appSubscriptionSchema = z.object({
  // 다른 앱의 slug이거나 `lophn`.
  source: z.string().min(1),
  event: z.string().min(1),
  // 다른 컴퓨터의 앱 event를 받을 때 그 컴퓨터의 이름.
  machine: z.string().min(1).optional(),
});

// 앱이 폰 widget 목록에 낸 줄. 칸이 없는 선언은 없다. 규칙은 선언 검사가 정하므로 여기서는 값만 본다.
const appWidgetSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  screen: z.string().min(1).optional(),
});

const appDeclarationOutputSchema = withReadCommon(
  z.object({
    app: appIdSchema,
    // command 명령줄의 첫 낱말이다: `lophn <slug> <command>`.
    slug: slugSchema,
    release: releaseIdSchema,
    declaration_hash: sha256Schema,
    name: z.string().min(1),
    description: z.string().min(1),
    // 바깥 명령. 이름은 route 이름(`app.tools`)을 따른다.
    tools: z.array(appCommandSchema),
    // active release 선언의 public skill 이름이다. 배포가 앱에 닿는지(public skill 하나가 배포됨)를 판정하는 쪽이 읽는다. 다른 기계가 준 답에는 없을 수 있다.
    public_skills: z.array(z.string().min(1)).optional(),
    operations: z.array(appOperationSchema),
    screens: z.array(appDeclarationScreenSchema),
    keys: z.array(appKeySchema).optional(),
    events: z.array(appEventSchema).optional(),
    subscriptions: z.array(appSubscriptionSchema).optional(),
    widgets: z.array(appWidgetSchema).optional(),
    runs_on: z.array(z.enum(["computer", "phone"])).optional(),
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
  reads: [{ name: "releases", id: (input) => input.app }],
  actors: ["user", "agent", "app", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

// 앱 icon은 이미지(base64)이거나 선언한 lucide 이름이다. 이름은 화면이 lucide로 그려 theme 색을 따른다.
const appIconSchema = z.union([
  iconImageSchema,
  z.strictObject({ lucide: z.string().min(1) }),
]);

// `app.icon`. 사람이 올린 icon이 있으면 그것, 없으면 active release 선언의 icon(이미지 파일 하나나 lucide 이름)이다.
// 올린 icon도 선언도 없거나 파일이 없거나 크거나 bundle 밖을 가리키면 icon이 null이다(오류가 아니다. 앱은 기본 모양으로 보인다).
export const appIcon = defineRead({
  resource: "apps",
  method: "icon",
  name: "app.icon",
  input: appInputSchema,
  output: z.object({ icon: appIconSchema.nullable(), uploaded: z.boolean() }),
  reads: [
    { name: "apps", id: (input) => input.app },
    { name: "releases", id: (input) => input.app },
  ],
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

// `app.skills`. 앱(id)마다 active release bundle의 public skill(선언 `skills[].public`)이다. SKILL.md 전체와 옆에 딸린
// `.md` 파일 본문을 싣는다. 없는 앱, 보관한 앱, active release가 없는 앱, 읽을 수 없는 skill은 오류 없이 뺀다.
// agent의 공유 skill 받기와 coding agent harness 사본이 같은 것을 읽는다.
export const appSkills = defineRead({
  resource: "apps",
  method: "skills",
  name: "app.skills",
  input: z.strictObject({ apps: z.array(appIdSchema).max(64) }),
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
  reads: ["releases"],
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
  reads: [{ name: "releases", id: (input) => input.app ?? null }],
  actors: ["user", "agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});
export type AppIcon = z.infer<typeof appIconSchema>;
