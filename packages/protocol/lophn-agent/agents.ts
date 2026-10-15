import { z } from "zod";
import {
  defineCommand,
  defineFile,
  defineRead,
  defineUpload,
} from "../base/route.ts";
import { defineEvent } from "../base/event.ts";
import { idSchema } from "../base/ids.ts";
import { sha256Schema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import {
  AGENT_PROFILE_IMAGE_MAX_BYTES,
  agentDefinitionOutputSchema,
  agentDefinitionSchema,
  agentIssueSchema,
  agentKindSchema,
  agentListRowSchema,
  agentNameSchema,
  agentPermissionsOutputSchema,
  agentPlaceOutputSchema,
  agentPlaceSchema,
  agentProfileImageTypeSchema,
  agentSettingsOutputSchema,
  agentSettingsSchema,
  profileImageOutputSchema,
  profileOutputSchema,
  sourced,
} from "./agent-values.ts";
import { modelChoiceOutputSchema } from "./models.ts";
import { agentRoleSchema } from "./scope.ts";

// 옛 모델(assignment 기준, 곧 지움): 새 route는 `agent-definitions.ts`가 AgentRef 기준으로 대신한다. core agents가
// 이 모양을 쓰는 동안만 남긴다.
// 읽기·쓰기 route는 사람(editor)이 쓴다. 정의를 쓰고 지우는 길은 agent에게 열지 않는다.
// invalid_input의 details는 항목별 이유(`agentIssuesDetailsSchema`)다.
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

const readActors = ["user", "machine"] as const;

// 저장·삭제가 비교하는 파일 hash다. 새 Operator나 파일이 아직 없는 built-in은 null이다.
const saveCompareSchema = z.strictObject({ hash: sha256Schema.nullable() });
const deleteCompareSchema = z.strictObject({ hash: sha256Schema });

export const listAgentsInputSchema = z.strictObject({
  place: agentPlaceSchema,
});
export const readAgentInputSchema = z.strictObject({
  place: agentPlaceSchema,
  assignment: idSchema("asg"),
});

// assignment를 생략하면 새 Operator다. built-in은 전역 assignment ID를 싣는다.
// definition은 파일 전체의 새 내용이다: 없는 칸은 지워진다.
export const saveAgentInputSchema = z.strictObject({
  place: agentPlaceSchema,
  assignment: idSchema("asg").optional(),
  definition: agentDefinitionSchema,
});

export const deleteAgentInputSchema = z.strictObject({
  assignment: idSchema("asg"),
});

export const uploadAgentProfileInputSchema = z.strictObject({
  place: agentPlaceSchema,
  assignment: idSchema("asg"),
  content_type: agentProfileImageTypeSchema,
  bytes: z.number().int().min(1).max(AGENT_PROFILE_IMAGE_MAX_BYTES),
});

export const readAgentProfileInputSchema = readAgentInputSchema;

export const readPlaceAgentSettingsInputSchema = z.strictObject({
  place: agentPlaceSchema,
});

export const changePlaceAgentSettingsInputSchema = z.strictObject({
  place: agentPlaceSchema,
  settings: agentSettingsSchema,
});

export const agentsList = defineRead({
  resource: "agents",
  method: "list",
  name: "ListAgents",
  input: listAgentsInputSchema,
  output: withReadCommon(z.object({ agents: z.array(agentListRowSchema) })),
  actors: readActors,
  errors: [...readErrors],
});

// 정의와 칸별 값·출처를 돌려준다. 파일이 없으면 definition과 hash가 null이고, 파일이 틀렸으면 definition은
// null, hash는 그 파일의 hash, issues는 이유다.
export const agentsRead = defineRead({
  resource: "agents",
  method: "read",
  name: "ReadAgent",
  input: readAgentInputSchema,
  output: withReadCommon(z.object({
    assignment: idSchema("asg"),
    role: agentRoleSchema,
    kind: agentKindSchema,
    place: agentPlaceOutputSchema,
    definition: agentDefinitionOutputSchema.nullable(),
    hash: sha256Schema.nullable(),
    effective: z.object({
      name: sourced(agentNameSchema),
      profile: sourced(profileOutputSchema),
      model: sourced(modelChoiceOutputSchema).nullable(),
      permissions: sourced(agentPermissionsOutputSchema),
    }),
    issues: z.array(agentIssueSchema),
  })),
  actors: readActors,
  errors: [...readErrors],
});

export const agentsSave = defineCommand({
  resource: "agents",
  method: "save",
  name: "SaveAgent",
  input: saveAgentInputSchema,
  output: z.object({
    assignment: idSchema("asg"),
    role: agentRoleSchema,
    hash: sha256Schema,
  }),
  compare: saveCompareSchema,
  actors: ["user"],
  errors: [...writeErrors],
});

export const agentsDelete = defineCommand({
  resource: "agents",
  method: "delete",
  name: "DeleteAgent",
  input: deleteAgentInputSchema,
  output: z.object({ assignment: idSchema("asg"), hash: sha256Schema }),
  compare: deleteCompareSchema,
  actors: ["user"],
  errors: [...writeErrors],
});

// 이미지 바이트는 body이고 input은 header로 온다. 저장 때 정의의 profile로 연결한다(이 route는 event가 없다).
export const agentProfilesUpload = defineUpload({
  resource: "agent-profiles",
  method: "upload",
  name: "UploadAgentProfileImage",
  input: uploadAgentProfileInputSchema,
  output: z.object({ profile: profileImageOutputSchema }),
  actors: ["user"],
  // 이미지 파일을 쓰지 못하면 unavailable이다. 옛 확장자의 정리는 SaveAgent가 맡는다.
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "unavailable",
  ],
  max_bytes: AGENT_PROFILE_IMAGE_MAX_BYTES,
});

export const agentProfilesRead = defineFile({
  resource: "agent-profiles",
  method: "read",
  name: "ReadAgentProfileImage",
  input: readAgentProfileInputSchema,
  // 실제 Content-Type은 올린 파일의 형식이다. 선언은 fallback이다.
  contentType: "application/octet-stream",
  actors: readActors,
  errors: [...readErrors],
});

// 자리 층만 다룬다. 전역의 역할별 기본 model은 `agent-model-defaults`, 기본 권한은 platform/settings가 맡는다.
// 이 자리가 가진 칸과, 칸을 비운 role의 실제 model과 그 출처(자리·전역·기본값)를 돌려준다.
// hash는 이 파일의 내용 hash이고 파일이 없으면 null이다.
export const placeAgentSettingsRead = defineRead({
  resource: "place-agent-settings",
  method: "read",
  name: "ReadPlaceAgentSettings",
  input: readPlaceAgentSettingsInputSchema,
  output: withReadCommon(z.object({
    place: agentPlaceOutputSchema,
    settings: agentSettingsOutputSchema,
    hash: sha256Schema.nullable(),
    effective_models: z.partialRecord(
      agentRoleSchema,
      sourced(modelChoiceOutputSchema),
    ),
  })),
  actors: readActors,
  errors: [...readErrors],
});

// settings는 이 자리 파일의 새 내용 전체다: 없는 칸은 지워진다.
export const placeAgentSettingsChange = defineCommand({
  resource: "place-agent-settings",
  method: "change",
  name: "ChangePlaceAgentSettings",
  input: changePlaceAgentSettingsInputSchema,
  output: z.object({
    place: agentPlaceOutputSchema,
    hash: sha256Schema,
  }),
  compare: saveCompareSchema,
  actors: ["user"],
  errors: [...writeErrors],
});

// 저장·삭제는 누가(envelope actor) 언제 어느 자리의 어느 agent에서 했는지만 남기고 내용의 전후는 hash뿐이다.
export const agentSaved = defineEvent("AgentSaved", {
  subject: idSchema("asg"),
  payload: z.object({
    place: agentPlaceOutputSchema,
    role: agentRoleSchema,
    before_hash: sha256Schema.nullable(),
    after_hash: sha256Schema,
  }),
});

export const agentDeleted = defineEvent("AgentDeleted", {
  subject: idSchema("asg"),
  payload: z.object({
    place: agentPlaceOutputSchema,
    role: agentRoleSchema,
    hash: sha256Schema,
  }),
});

export const placeAgentSettingsChanged = defineEvent(
  "PlaceAgentSettingsChanged",
  {
    subject: z.union([idSchema("prj"), idSchema("app")]),
    payload: z.object({
      place: agentPlaceOutputSchema,
      before_hash: sha256Schema.nullable(),
      after_hash: sha256Schema,
    }),
  },
);

export const AGENT_ROUTES = [
  agentsList,
  agentsRead,
  agentsSave,
  agentsDelete,
  agentProfilesUpload,
  agentProfilesRead,
  placeAgentSettingsRead,
  placeAgentSettingsChange,
] as const;

export const AGENT_EVENTS = [
  agentSaved,
  agentDeleted,
  placeAgentSettingsChanged,
] as const;
