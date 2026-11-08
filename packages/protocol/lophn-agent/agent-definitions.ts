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
  agentDefinitionOutputSchema,
  agentDefinitionSchema,
  agentHandleSchema,
  agentNameSchema,
  agentWorkspaceOutputSchema,
  agentProfileImageTypeSchema,
  agentRuntimeSchema,
  modalitySchema,
  profileImageOutputSchema,
  profileOutputSchema,
} from "./agent-values.ts";
import { modelChoiceOutputSchema } from "./models.ts";
import { agentIdSchema, workspaceSchema } from "./workspaces.ts";

// 사람(editor)과 agent가 전역 agent 정의를 읽고 저장하는 route다. agent를 가리키는 것은 `AgentId`다.
// - 정의는 파일 전체의 새 내용이다: 없는 칸은 지워진다. invalid_input의 details는 항목별 이유다.
// - 할당은 approvals의 `assignmentGet`·`assignmentSet`이 맡는다.

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
// "project"는 workspace 층(Home, project, 앱)을 가리킨다. 이름을 바꾸지 않는 것은 공개 ACP SDK type(`AcpSessionMeta.layer`)에 있기 때문이다.
const AGENT_VALUE_LAYERS = ["global", "project", "agent", "session"] as const;
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

// ---------- 전역 agent 정의 ----------

// 정의 file 이름은 id이고 주소는 handle(만들 때 정해 바뀌지 않는다)이다. 정의는 전역이거나 `workspace` 하나에 범위가 있다.
// agent 자격은 목록, 읽기, 만들기, 고치기만 한다. lophn의 profile·handle을 바꾸거나 lophn을 지우면 `forbidden`이다.
// 할당(`apps`, `extensions`, `permissions`), `mcp_servers`, `skip`은 사람만 정하고 agent가 주면 core가 거절한다.

export const agentRowSchema = z.object({
  agent: agentIdSchema,
  handle: agentHandleSchema,
  name: agentNameSchema,
  // 범위가 없으면 전역이다.
  workspace: agentWorkspaceOutputSchema.nullable(),
  profile: profileOutputSchema,
  description: z.string().optional(),
  model: z
    .object({
      provider: idSchema("pvd"),
      model_name: z.string().min(1),
      source: agentValueLayerSchema,
    })
    .nullable(),
  issues: z.array(agentDefinitionIssueSchema),
  counts: agentCountsSchema,
});
export type AgentRow = z.infer<typeof agentRowSchema>;

// 사람(editor)은 전부 읽는다. workspace를 주면 전역과 그 workspace의 범위 agent만 낸다.
// agent 자격은 주지 않아도 자기 session의 workspace로 같이 좁혀진다(home이면 전역만).
export const agentList = defineRead({
  resource: "agents",
  method: "list",
  name: "ListAgents",
  input: z.strictObject({ workspace: workspaceSchema.optional() }),
  output: withReadCommon(z.object({ agents: z.array(agentRowSchema) })),
  actors: readActors,
  errors: [...readErrors],
});

export const agentRead = defineRead({
  resource: "agents",
  method: "read",
  name: "ReadAgent",
  input: z.strictObject({
    agent: agentIdSchema,
    workspace: workspaceSchema.optional(),
  }),
  output: withReadCommon(
    z.object({
      agent: agentIdSchema,
      definition: agentDefinitionOutputSchema.nullable(),
      hash: sha256Schema.nullable(),
      effective: z.object({
        name: agentSourced(agentNameSchema),
        profile: agentSourced(profileOutputSchema),
        model: agentSourced(modelChoiceOutputSchema).nullable(),
      }),
      issues: z.array(agentDefinitionIssueSchema),
    }),
  ),
  actors: readActors,
  errors: [...readErrors],
});

// 명함: 다른 agent와 사람이 agent를 고를 때 읽는 요약이다. program이 정의와 할당에서 계산하고 prompt 원문은 싣지 않는다.
// diff는 기본 lophn agent와 다른 점이다(그 agent의 정의로 계산하고, lophn이면 그 workspace의 lophn 정의다): plus는 더 가진 것, minus는 덜 가진 것.
export const AGENT_REPLIES = ["none", "result", "conversation"] as const;
export const agentCardSchema = z.object({
  handle: agentHandleSchema,
  name: agentNameSchema,
  workspace: agentWorkspaceOutputSchema.nullable(),
  description: z.string().optional(),
  runtime: agentRuntimeSchema,
  modality: z.object({
    input: z.array(modalitySchema),
    output: z.array(modalitySchema),
  }),
  replies: z.array(z.enum(AGENT_REPLIES)),
  diff: z.object({ plus: z.array(z.string()), minus: z.array(z.string()) }),
  notes: z.array(z.string()),
  // 읽는 agent session이 이 agent를 부를 수 있는가(call 정책). agent session이 읽을 때만 있다.
  // workspace를 빼고 부르면 home에 열리므로 home과 자기 workspace(here) 둘을 싣는다. 다른 workspace는 보낼 때 Router가 정한다.
  callable: z.object({ home: z.boolean(), here: z.boolean() }).optional(),
});
export type AgentCard = z.infer<typeof agentCardSchema>;

export const agentCard = defineRead({
  resource: "agents",
  method: "card",
  name: "ReadAgentCard",
  // workspace는 handle이 lophn일 때 어느 workspace의 lophn인지 고른다. 없으면 agent session은 자기 workspace, 사람은 Home이다.
  input: z.strictObject({
    handle: agentHandleSchema,
    workspace: workspaceSchema.optional(),
  }),
  output: withReadCommon(z.object({ card: agentCardSchema })),
  actors: readActors,
  errors: [...readErrors],
});

export const agentCreate = defineCommand({
  resource: "agents",
  method: "create",
  name: "CreateAgent",
  input: z.strictObject({
    // 생략하면 core가 새로 정한다(명령 표의 `agent create`).
    id: idSchema("agt").optional(),
    definition: agentDefinitionSchema,
  }),
  output: z.object({ agent: agentIdSchema, hash: sha256Schema }),
  actors: ["user", "agent"],
  errors: [...writeErrors],
});

export const agentChange = defineCommand({
  resource: "agents",
  method: "change",
  name: "ChangeAgent",
  input: z.strictObject({
    agent: agentIdSchema,
    definition: agentDefinitionSchema,
  }),
  output: z.object({ agent: agentIdSchema, hash: sha256Schema }),
  compare: saveCompareSchema,
  actors: ["user", "agent"],
  errors: [...writeErrors],
});

export const agentDelete = defineCommand({
  resource: "agents",
  method: "delete",
  name: "DeleteAgent",
  input: z.strictObject({ agent: agentIdSchema }),
  output: z.object({ agent: agentIdSchema, hash: sha256Schema }),
  compare: existingCompareSchema,
  actors: ["user"],
  errors: [...writeErrors],
});

// 이미지 바이트는 body이고 input은 header로 온다. 저장 때 정의의 profile로 연결한다(이 route는 event가 없다).
export const agentProfileImageUpload = defineUpload({
  resource: "profile-images",
  method: "upload",
  name: "UploadProfileImage",
  input: z.strictObject({
    agent: agentIdSchema,
    content_type: agentProfileImageTypeSchema,
    bytes: z.number().int().min(1).max(AGENT_PROFILE_IMAGE_MAX_BYTES),
  }),
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

export const agentProfileImageRead = defineFile({
  resource: "profile-images",
  method: "read",
  name: "ReadProfileImage",
  input: z.strictObject({ agent: agentIdSchema }),
  contentType: "application/octet-stream",
  actors: readActors,
  errors: [...readErrors],
});

export const AGENT_ROUTES = [
  agentList,
  agentRead,
  agentCard,
  agentCreate,
  agentChange,
  agentDelete,
  agentProfileImageUpload,
  agentProfileImageRead,
] as const;
