import { z } from "zod";
import { defineRead } from "../../base/route.ts";
import { jsonValueSchema } from "../../base/json-values.ts";
import { sha256Schema } from "../../base/values.ts";
import { withReadCommon } from "../../base/envelope.ts";
import { appIdSchema } from "../../projects/values.ts";
import { appInputSchema, releaseIdSchema } from "../apps.ts";
import { permissionRequirementSchema } from "../permissions.ts";

// 앱 하나의 active release 고정 blueprint를 사람과 agent가 읽는 모양이다.
// 선언 전체가 아니라 app-api·화면의 설명과 근거 구분이다. 범위 밖·없는 앱·active release가
// 없는 앱은 같은 not_found로 답한다.
const appAppApiSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  effect: z.enum(["read", "write", "external"]),
  // 정규 InputSchema. 입력이 없는 app-api는 null이다.
  input: jsonValueSchema.nullable(),
  // true이면 project 범위 app-api다.
  project_scope: z.boolean(),
});
export type AppAppApi = z.infer<typeof appAppApiSchema>;

const appBlueprintScreenSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  path: z.string().min(1),
  sizes: z.array(z.enum(["full", "panel", "card"])).min(1),
});

// 설명·구조 검증·실제 test 통과는 서로 다른 근거다. 설명이 완성됐거나 구조가 맞다는 것만으로
// test 성공을 표시하지 않는다.
const appBlueprintEvidenceSchema = z.object({
  description: z.object({
    complete: z.boolean(),
    // 설명이 비었거나 없는 자리. 예 `app_api.add.input.title`.
    gaps: z.array(z.string().min(1)),
  }),
  structure: z.object({ validated: z.literal(true) }),
  test: z.object({
    passed: z.boolean(),
    verifications: z.array(z.string().min(1)),
  }),
});

// 현재 release의 선언 사실이다. 실행 범위(선언 ∩ active grant)를 계산하는 읽는 쪽이 쓴다.
// blueprint에 이미 있는 값을 계산에 쓰기 좋게 풀어 둔 것이고 새 사실이 아니다.
const appDeclarationsSchema = z.object({
  permissions: z.array(permissionRequirementSchema),
  app_connections: z.array(z.object({
    app: appIdSchema,
    app_api: z.array(z.string().min(1)),
  })),
  app_api: z.array(z.string().min(1)),
});

const appBlueprintOutputSchema = withReadCommon(z.object({
  app: appIdSchema,
  release: releaseIdSchema,
  blueprint_hash: sha256Schema,
  name: z.string().min(1),
  description: z.string().min(1),
  app_api: z.array(appAppApiSchema),
  screens: z.array(appBlueprintScreenSchema),
  declarations: appDeclarationsSchema,
  evidence: appBlueprintEvidenceSchema,
}));

export const appAppApi = defineRead({
  resource: "apps",
  method: "app_api",
  name: "app.app_api",
  input: appInputSchema.extend({ release: releaseIdSchema.optional() }),
  output: appBlueprintOutputSchema,
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});

// `app.app_api_index`. 모든 앱의 이름·설명과 app-api 목록이다. 앱 범위 판정을 하지 않는 대신
// 돌려주는 칸이 이것뿐이라 source 경로, problem, ticket은 새지 않는다. 호출 모양(input)은 앱 하나를
// 볼 때만 싣는다. 목록이 앱 수에 비례해 커지는 것을 줄이기 위해서다.
const appApiIndexEntrySchema = z.object({
  app: appIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  app_api: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    description: z.string().min(1),
    effect: z.enum(["read", "write", "external"]),
    input: jsonValueSchema.nullable(),
  })),
});
export type AppApiIndexEntry = z.infer<typeof appApiIndexEntrySchema>;

export const appAppApiIndex = defineRead({
  resource: "apps",
  method: "app_api_index",
  name: "app.app_api_index",
  input: z.strictObject({ app: appIdSchema.optional() }),
  output: withReadCommon(z.object({ apps: z.array(appApiIndexEntrySchema) })),
  actors: ["agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});
