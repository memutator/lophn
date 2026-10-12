import { z } from "zod";
import {
  defineRead,
  jsonValueSchema,
  sha256Schema,
  withReadCommon,
} from "../server/mod.ts";
import { appIdSchema } from "../projects/values.ts";
import { appInputSchema, releaseIdSchema } from "./apps.ts";
import { permissionRequirementSchema } from "./permissions.ts";

// 앱 하나의 active release 고정 blueprint를 사람과 agent가 읽는 모양이다(apps/blueprint#R2·R3).
// 선언 전체가 아니라 command·화면·automation의 설명과 근거 구분이다. 범위 밖·없는 앱·active release가
// 없는 앱은 같은 not_found로 답한다.
export const appBlueprintCommandSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  description: z.string().min(1),
  effect: z.enum(["read", "write", "external"]),
  confirm: z.boolean(),
  // 정규 InputSchema. 입력이 없는 명령은 null이다.
  input: jsonValueSchema.nullable(),
  // 되돌리기 선언. 지원하면 대응 command 키가 있다. 이 필드를 모르는 옛 소비자는 무시하므로 additive다.
  revert: z.object({
    supported: z.boolean(),
    command: z.string().min(1).optional(),
  }).optional(),
});
export type AppBlueprintCommand = z.infer<typeof appBlueprintCommandSchema>;

export const appBlueprintScreenSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  path: z.string().min(1),
  sizes: z.array(z.enum(["full", "panel", "card"])).min(1),
});

export const appBlueprintAutomationSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  command: z.string().min(1),
  when: z.union([
    z.object({ kind: z.literal("on_start") }),
    z.object({ kind: z.literal("interval"), interval_ms: z.number().int() }),
  ]),
});

// 화면 context 선언의 읽는 모양이다(apps/agent-context#R1). 화면마다 상태를 읽는 command와 주석을 받는
// 자리·write command만 싣는다. 민감 칸 path는 앱 host의 제거 규칙이라 읽는 쪽에 싣지 않는다.
export const appBlueprintAgentContextSchema = z.object({
  screen: z.string().min(1),
  read_command: z.string().min(1),
  annotation_targets: z.array(z.object({
    key: z.string().min(1),
    label: z.string().min(1),
    write_command: z.string().min(1),
  })),
});
export type AppBlueprintAgentContext = z.infer<
  typeof appBlueprintAgentContextSchema
>;

// 설명·구조 검증·실제 test 통과는 서로 다른 근거다. 설명이 완성됐거나 구조가 맞다는 것만으로
// test 성공을 표시하지 않는다(apps/blueprint#R3).
export const appBlueprintEvidenceSchema = z.object({
  description: z.object({
    complete: z.boolean(),
    // 설명이 비었거나 없는 자리. 예 `commands.add.input.title`.
    gaps: z.array(z.string().min(1)),
  }),
  structure: z.object({ validated: z.literal(true) }),
  test: z.object({
    passed: z.boolean(),
    verifications: z.array(z.string().min(1)),
  }),
});

// 현재 release의 선언 사실이다. 실행 범위(선언 ∩ active grant)를 계산하는 읽는 쪽(supervisor의
// broker, 화면)이 쓴다. blueprint에 이미 있는 값을 계산에 쓰기 좋게 풀어 둔 것이고 새 사실이 아니다.
export const appDeclarationsSchema = z.object({
  permissions: z.array(permissionRequirementSchema),
  app_connections: z.array(z.object({
    app: appIdSchema,
    commands: z.array(z.string().min(1)),
  })),
  commands: z.array(z.string().min(1)),
  automations: z.array(z.object({
    key: z.string().min(1),
    command: z.string().min(1),
    // effect가 external인 command를 부른다.
    external: z.boolean(),
    // default를 채운 고정 입력의 정규 hash.
    input_hash: sha256Schema,
    when: appBlueprintAutomationSchema.shape.when,
  })),
  problem_codes: z.array(z.string().min(1)),
  documents: z.array(z.object({
    key: z.string().min(1),
    name: z.string().min(1),
    description: z.string().min(1),
    format: z.object({
      name: z.string().min(1),
      module_hash: sha256Schema,
      explicit: z.boolean(),
    }),
    document: z.string().min(1).optional(),
  })),
});
export type AppDeclarationsView = z.infer<typeof appDeclarationsSchema>;

export const appBlueprintOutputSchema = withReadCommon(z.object({
  app: appIdSchema,
  release: releaseIdSchema,
  blueprint_hash: sha256Schema,
  name: z.string().min(1),
  description: z.string().min(1),
  commands: z.array(appBlueprintCommandSchema),
  screens: z.array(appBlueprintScreenSchema),
  automations: z.array(appBlueprintAutomationSchema),
  // 이 필드를 모르는 옛 소비자는 무시하므로 additive다. 선언이 없으면 빈 배열이다.
  agent_context: z.array(appBlueprintAgentContextSchema).optional(),
  declarations: appDeclarationsSchema,
  evidence: appBlueprintEvidenceSchema,
}));

export const appBlueprint = defineRead({
  resource: "apps",
  method: "blueprint",
  name: "app.blueprint",
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
