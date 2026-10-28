import { z } from "zod";
import { defineRead } from "../../base/route.ts";
import { jsonValueSchema } from "../../base/json-values.ts";
import { sha256Schema } from "../../base/values.ts";
import { withReadCommon } from "../../base/envelope.ts";
import { appIdSchema } from "../../projects/values.ts";
import { appInputSchema, releaseIdSchema } from "../apps.ts";
import { permissionRequirementSchema } from "../permissions.ts";

// 앱 하나의 active release 고정 선언을 사람과 agent가 읽는 모양이다.
// 선언 전체가 아니라 tool·화면의 설명과 근거 구분이다. 범위 밖·없는 앱·active release가
// 없는 앱은 같은 not_found로 답한다.
const appToolSchema = z.object({
  name: z.string().min(1),
  title: z.string().min(1),
  description: z.string().min(1),
  // 정규 InputSchema. 인자가 없는 tool은 null이다.
  inputSchema: jsonValueSchema.nullable(),
  outputSchema: jsonValueSchema.optional(),
  effect: z.enum(["read", "write", "external"]),
  // 다른 domain에 보이는지.
  public: z.boolean(),
  // tool이 다루는 객체의 domain.
  domain: z.string().min(1),
});
export type AppTool = z.infer<typeof appToolSchema>;

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
    // 설명이 비었거나 없는 자리. 예 `tools.add.inputSchema.title`.
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
  tools: z.array(z.string().min(1)),
});

const appDeclarationOutputSchema = withReadCommon(
  z.object({
    app: appIdSchema,
    release: releaseIdSchema,
    declaration_hash: sha256Schema,
    name: z.string().min(1),
    description: z.string().min(1),
    tools: z.array(appToolSchema),
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

// `app.tool_index`. 모든 앱의 이름·설명과 tool 목록이다. 앱 범위 판정을 하지 않는 대신
// 돌려주는 칸이 이것뿐이라 source 경로, 앱 log, 호출 기록은 새지 않는다. 호출 모양(inputSchema, outputSchema)은
// 입력에 app이 있을 때만 싣는다(전체 목록에서는 칸이 없다). 목록이 앱 수에 비례해 커지는 것을 줄이기 위해서다.
// inputSchema는 인자가 없으면 null, outputSchema는 선언했을 때만 있다.
const appToolIndexEntrySchema = z.object({
  app: appIdSchema,
  name: z.string().min(1),
  description: z.string().min(1),
  tools: z.array(
    z.object({
      name: z.string().min(1),
      title: z.string().min(1),
      description: z.string().min(1),
      effect: z.enum(["read", "write", "external"]),
      public: z.boolean(),
      domain: z.string().min(1),
      inputSchema: jsonValueSchema.nullable().optional(),
      outputSchema: jsonValueSchema.optional(),
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
  actors: ["agent"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
});
