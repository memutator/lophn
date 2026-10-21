import { z } from "zod";
import {
  defineCommand,
  defineFile,
  defineRead,
  defineUpload,
} from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { sha256Schema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import {
  AGENT_PROFILE_IMAGE_MAX_BYTES,
  agentCountsSchema,
  agentKindSchema,
  agentNameSchema,
  agentProfileImageTypeSchema,
  profileImageOutputSchema,
  profileOutputSchema,
} from "./agent-values.ts";
import { modelChoiceOutputSchema } from "./models.ts";
import {
  agentRefOutputSchema,
  agentRefSchema,
  placeOutputSchema,
  placeSchema,
  roleSchema,
} from "./places.ts";
import {
  builtinDefinitionOutputSchema,
  builtinDefinitionSchema,
  operatorDefinitionOutputSchema,
  operatorDefinitionSchema,
} from "./operators.ts";

// 사람(editor)이 agent 정의를 읽고 저장하는 route다. agent를 가리키는 것은 `AgentRef`다.
// agent는 정의 읽기와 Operator 만들기·고치기만 하고 지우거나 built-in을 고치지 못한다. agent가 부르면 core가
// 호출 session의 role·place로 범위를 본다: 자기 place의 정의와 Operator뿐이다(agent의 operator.create·update는 tool이다).
// - 내장 role(lophn, Project Manager, App Engineer)은 만들고 지울 수 없고, 사람이 고치는 것은 지침·model·skill·MCP 끄기다.
// - Operator는 `operatorDefinitionSchema`로 만들고 고치고 지운다.
// - tool 목록은 role이 정하고 사람이 바꾸지 않는다. 할당은 approvals의 `agentAssignmentGet`·`agentAssignmentSet`이 맡는다.
// - 정의는 파일 전체의 새 내용이다: 없는 칸은 지워진다. invalid_input의 details는 항목별 이유다.

const builtinAgentRefBranches = [
  z.strictObject({ role: z.literal("lophn") }),
  z.strictObject({
    role: z.literal("project_manager"),
    project: idSchema("prj"),
  }),
  z.strictObject({ role: z.literal("app_engineer"), app: idSchema("app") }),
] as const;
const builtinAgentRefSchema = z.discriminatedUnion(
  "role",
  builtinAgentRefBranches,
);

const operatorIdSchema = idSchema("agt");

const writeErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "conflict",
] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;
const readActors = ["user", "machine", "agent"] as const;

// 저장·삭제가 비교하는 파일 hash다. 파일이 아직 없는 내장 agent는 null이다.
const saveCompareSchema = z.strictObject({ hash: sha256Schema.nullable() });
const existingCompareSchema = z.strictObject({ hash: sha256Schema });

// 값을 준 층. 설정의 층은 전역, project, agent이고 composer가 session 하나만 고른 model이 session이다.
const AGENT_VALUE_LAYERS = [
  "global",
  "project",
  "agent",
  "session",
] as const;
const agentValueLayerSchema = z.enum(AGENT_VALUE_LAYERS);
export type AgentValueLayer = z.infer<typeof agentValueLayerSchema>;

function agentSourced<T extends z.ZodType>(value: T) {
  return z.object({ value, source: agentValueLayerSchema });
}

// 저장과 읽기의 전체 검사가 항목별로 알리는 이유다. field는 점 경로(`skills.1`, `mcp_servers.0.name`)이고
// 파일 자체가 깨졌으면 `frontmatter`다.
const AGENT_DEFINITION_ISSUE_CODES = [
  "malformed",
  "unknown_field",
  "invalid_value",
  "required",
  "not_allowed",
  "reserved_name",
  "duplicate",
  "too_large",
  "unknown",
] as const;
const agentDefinitionIssueSchema = z.object({
  field: z.string().min(1),
  code: z.enum(AGENT_DEFINITION_ISSUE_CODES),
});
export type AgentDefinitionIssue = z.infer<typeof agentDefinitionIssueSchema>;

// ---------- 읽기 ----------

// lophn는 place가 없어 place를 주어도 첫 줄로 늘 있다. place를 주면 그 자리의 Project Manager·App Engineer·Operator만
// 더하고, 주지 않으면 모든 자리의 agent다.
const listAgentDefinitionsInputSchema = z.strictObject({
  place: placeSchema.optional(),
});

// issues가 비어 있지 않으면 파일이 틀려 그 agent만 시작하지 않는다.
const agentDefinitionRowSchema = z.object({
  agent: agentRefOutputSchema,
  kind: agentKindSchema,
  place: placeOutputSchema.nullable(),
  name: agentNameSchema,
  profile: profileOutputSchema,
  model: z.object({
    provider: idSchema("pvd"),
    model_name: z.string().min(1),
    source: agentValueLayerSchema,
  }).nullable(),
  issues: z.array(agentDefinitionIssueSchema),
  counts: agentCountsSchema,
});
export type AgentDefinitionRow = z.infer<typeof agentDefinitionRowSchema>;

export const agentDefinitionList = defineRead({
  resource: "agent-definitions",
  method: "list",
  name: "ListAgentDefinitions",
  input: listAgentDefinitionsInputSchema,
  output: withReadCommon(
    z.object({ agents: z.array(agentDefinitionRowSchema) }),
  ),
  actors: readActors,
  errors: [...readErrors],
});

export const readAgentDefinitionInputSchema = z.strictObject({
  agent: agentRefSchema,
});

// 정의와 칸별 값·출처를 돌려준다. 파일이 없으면 definition과 hash가 null이고, 파일이 틀렸으면 definition은
// null, hash는 그 파일의 hash, issues는 이유다. 내장 agent의 definition은 내장 칸만 있다.
export const agentDefinitionRead = defineRead({
  resource: "agent-definitions",
  method: "read",
  name: "ReadAgentDefinition",
  input: readAgentDefinitionInputSchema,
  output: withReadCommon(z.object({
    agent: agentRefOutputSchema,
    role: roleSchema,
    place: placeOutputSchema.nullable(),
    definition: z.union([
      operatorDefinitionOutputSchema,
      builtinDefinitionOutputSchema,
    ]).nullable(),
    hash: sha256Schema.nullable(),
    effective: z.object({
      name: agentSourced(agentNameSchema),
      profile: agentSourced(profileOutputSchema),
      model: agentSourced(modelChoiceOutputSchema).nullable(),
      // agent가 일하는 domain id다. 정의가 고른 것과 그 place 그릇의 active domain의 교집합이고, 고르지 않았으면
      // 그릇의 active domain 전부다(id 순). lophn은 place가 없어 빈 목록이다.
      domains: z.array(idSchema("dom")),
    }),
    issues: z.array(agentDefinitionIssueSchema),
  })),
  actors: readActors,
  errors: [...readErrors],
});

// ---------- 쓰기 ----------

const createOperatorInputSchema = z.strictObject({
  id: operatorIdSchema,
  place: placeSchema,
  definition: operatorDefinitionSchema,
});
export const operatorCreate = defineCommand({
  resource: "operators",
  method: "create",
  name: "CreateOperator",
  input: createOperatorInputSchema,
  output: z.object({ agent: operatorIdSchema, hash: sha256Schema }),
  actors: ["user", "agent"],
  errors: [...writeErrors],
});

const changeOperatorInputSchema = z.strictObject({
  agent: operatorIdSchema,
  definition: operatorDefinitionSchema,
});
export const operatorChange = defineCommand({
  resource: "operators",
  method: "change",
  name: "ChangeOperator",
  input: changeOperatorInputSchema,
  output: z.object({ agent: operatorIdSchema, hash: sha256Schema }),
  compare: existingCompareSchema,
  actors: ["user", "agent"],
  errors: [...writeErrors],
});

const deleteOperatorInputSchema = z.strictObject({
  agent: operatorIdSchema,
});
export const operatorDelete = defineCommand({
  resource: "operators",
  method: "delete",
  name: "DeleteOperator",
  input: deleteOperatorInputSchema,
  output: z.object({ agent: operatorIdSchema, hash: sha256Schema }),
  compare: existingCompareSchema,
  actors: ["user"],
  errors: [...writeErrors],
});

const changeBuiltinAgentInputSchema = z.strictObject({
  agent: builtinAgentRefSchema,
  definition: builtinDefinitionSchema,
});
export const builtinAgentChange = defineCommand({
  resource: "builtin-agents",
  method: "change",
  name: "ChangeBuiltinAgent",
  input: changeBuiltinAgentInputSchema,
  output: z.object({ agent: builtinAgentRefSchema, hash: sha256Schema }),
  compare: saveCompareSchema,
  actors: ["user"],
  errors: [...writeErrors],
});

// ---------- profile 이미지 ----------

// 이미지 바이트는 body이고 input은 header로 온다. 저장 때 정의의 profile로 연결한다(이 route는 event가 없다).
export const uploadProfileImageInputSchema = z.strictObject({
  agent: agentRefSchema,
  content_type: agentProfileImageTypeSchema,
  bytes: z.number().int().min(1).max(AGENT_PROFILE_IMAGE_MAX_BYTES),
});
export const profileImageUpload = defineUpload({
  resource: "profile-images",
  method: "upload",
  name: "UploadProfileImage",
  input: uploadProfileImageInputSchema,
  output: z.object({ profile: profileImageOutputSchema }),
  actors: ["user"],
  // 이미지 파일을 쓰지 못하면 unavailable이다. 옛 확장자의 정리는 정의 저장이 맡는다.
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
  max_bytes: AGENT_PROFILE_IMAGE_MAX_BYTES,
});

export const profileImageRead = defineFile({
  resource: "profile-images",
  method: "read",
  name: "ReadProfileImage",
  input: readAgentDefinitionInputSchema,
  // 실제 Content-Type은 올린 파일의 형식이다. 선언은 fallback이다.
  contentType: "application/octet-stream",
  actors: readActors,
  errors: [...readErrors],
});

// ---------- event ----------

export const AGENT_DEFINITION_ROUTES = [
  agentDefinitionList,
  agentDefinitionRead,
  operatorCreate,
  operatorChange,
  operatorDelete,
  builtinAgentChange,
  profileImageUpload,
  profileImageRead,
] as const;
