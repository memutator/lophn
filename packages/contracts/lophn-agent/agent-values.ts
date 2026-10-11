import { z } from "zod";
import { idSchema, sha256Schema } from "../platform/mod.ts";
import {
  INSTRUCTION_FILE_MAX_BYTES,
  modelChoiceOutputSchema,
  modelChoiceSchema,
} from "./models.ts";
import { agentRoleSchema, appCommandKeySchema } from "./scope.ts";
import type { AgentRole } from "./scope.ts";

// agent 정의(lophn-agent/agents domain model)의 값. 정의와 자리 설정은 app data의 Markdown 파일이고,
// 파일에는 사람이 바꾼 칸만 있다. 그래서 칸은 모두 optional(없음 = 아래 층을 따름)이고 null을 받지 않는다.

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});

function unique<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

// 제품이 이름을 고정하는 built-in. Operator는 이 이름을 쓰지 못한다(R2, R5).
export const BUILTIN_AGENT_NAMES = {
  lophn: "lophn",
  context_engineer: "Context Engineer",
  app_engineer: "App Engineer",
} as const;

// 같은 자리 Operator 사이의 이름 중복과 built-in 이름 충돌을 가리는 열쇠다: 앞뒤 공백과 영문 대소문자를 무시한다(R5).
export function agentNameKey(name: string): string {
  return name.trim().toLowerCase();
}

export function isBuiltinAgentName(name: string): boolean {
  const key = agentNameKey(name);
  return Object.values(BUILTIN_AGENT_NAMES).some((builtin) =>
    agentNameKey(builtin) === key
  );
}

// 지침 파일 하나(agent 정의 본문 포함)의 상한이다(instructions R7).
export const AGENT_BODY_MAX_BYTES = INSTRUCTION_FILE_MAX_BYTES;

export const AGENT_KINDS = ["built_in", "operator"] as const;
export const agentKindSchema = z.enum(AGENT_KINDS);

export function agentKindOf(role: AgentRole): (typeof AGENT_KINDS)[number] {
  return role === "operator" ? "operator" : "built_in";
}

export const AGENT_PLACE_KINDS = ["project", "app"] as const;

// 정의와 자리 설정이 놓이는 자리. 전역(global)은 자리가 아니다: built-in도 파일은 project나 앱 아래에 있다.
export const agentPlaceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project"), id: idSchema("prj") }),
  z.strictObject({ kind: z.literal("app"), id: idSchema("app") }),
]);
export const agentPlaceOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), id: idSchema("prj") }),
  z.object({ kind: z.literal("app"), id: idSchema("app") }),
]);
export type AgentPlace = z.infer<typeof agentPlaceSchema>;
export type AgentPlaceKind = AgentPlace["kind"];

// Context Engineer는 project에서만, App Engineer는 앱에서만 부른다. lophn와 Operator는 두 자리 모두다(R7).
export function agentPlaceAllowsRole(
  role: AgentRole,
  place: { kind: AgentPlaceKind },
): boolean {
  if (role === "context_engineer") return place.kind === "project";
  if (role === "app_engineer") return place.kind === "app";
  return true;
}

// Profile: design system의 icon 하나이거나 사람이 올린 이미지(R13). icon id의 존재는 design system이 판정하고
// 여기서는 모양만 본다. 이미지 이름은 `avatar.<ext>` 하나뿐이라 경로를 실을 수 없고 svg는 받지 않는다.
export const AGENT_PROFILE_IMAGE_MAX_BYTES = 1_048_576;
export const AGENT_PROFILE_IMAGE_TYPES = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
} as const;
export const agentProfileImageTypeSchema = z.enum(
  Object.keys(AGENT_PROFILE_IMAGE_TYPES) as [
    keyof typeof AGENT_PROFILE_IMAGE_TYPES,
    ...(keyof typeof AGENT_PROFILE_IMAGE_TYPES)[],
  ],
);

const iconIdSchema = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/);
const imageNameSchema = z.string().regex(/^avatar\.(png|jpg|webp)$/);

const profileIconSchema = z.strictObject({
  kind: z.literal("icon"),
  icon: iconIdSchema,
});
const profileIconOutputSchema = z.object({
  kind: z.literal("icon"),
  icon: iconIdSchema,
});
export const profileImageSchema = z.strictObject({
  kind: z.literal("image"),
  image: imageNameSchema,
});
export const profileImageOutputSchema = z.object({
  kind: z.literal("image"),
  image: imageNameSchema,
});

export const profileSchema = z.discriminatedUnion("kind", [
  profileIconSchema,
  profileImageSchema,
]);
export const profileOutputSchema = z.discriminatedUnion("kind", [
  profileIconOutputSchema,
  profileImageOutputSchema,
]);
export type Profile = z.infer<typeof profileSchema>;

// 앱 Operator가 읽을 (앱, command) 이름 쌍. 이름만 고르고, 호출할 때마다 현재 blueprint와 허락을 다시 본다(R17).
const appReadFields = { app: idSchema("app"), command: appCommandKeySchema };
export const appReadSchema = z.strictObject(appReadFields);
export const appReadOutputSchema = z.object(appReadFields);
export type AppRead = z.infer<typeof appReadSchema>;

// 끈 MCP. original_tool을 생략하면 그 서버 전체다(R18).
const mcpOffFields = {
  server_name: nonblankSchema,
  original_tool: nonblankSchema.optional(),
};
export const mcpOffSchema = z.strictObject(mcpOffFields);
export const mcpOffOutputSchema = z.object(mcpOffFields);
export type McpOff = z.infer<typeof mcpOffSchema>;

// 외부 MCP tool 하나. 안전 표시와 resolved agent의 켜진 MCP가 같은 모양을 쓴다(R19).
const mcpToolFields = {
  server_name: nonblankSchema,
  original_tool: nonblankSchema,
};
export const mcpToolSchema = z.strictObject(mcpToolFields);
export const mcpToolOutputSchema = z.object(mcpToolFields);
export type McpTool = z.infer<typeof mcpToolSchema>;

// 권한은 개별 동작 이름(`<영역>.<동작>`)으로만 저장한다. 묶음 이름과 wildcard는 점 표기가 아니거나 `*`라 모양에서 걸린다(R22).
export const agentToolNameSchema = z.string().max(64).regex(
  /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/,
);

const toolListSchema = z.array(agentToolNameSchema).refine(unique, {
  message: "duplicate tool",
});
export const agentPermissionsSchema = z.strictObject({ tools: toolListSchema });
export const agentPermissionsOutputSchema = z.object({ tools: toolListSchema });
export type AgentPermissions = z.infer<typeof agentPermissionsSchema>;

export const agentNameSchema = nonblankSchema;
const bodySchema = z.string().refine(
  (value) => utf8Bytes(value) <= AGENT_BODY_MAX_BYTES,
  { message: "body is over the instruction file limit" },
);

const contextsSchema = z.array(idSchema("ctx")).refine(unique, {
  message: "duplicate context",
});

function appReadKey(read: AppRead): string {
  return `${read.app}\0${read.command}`;
}

const appReadsSchema = z.array(appReadSchema).refine(
  (reads) => unique(reads.map(appReadKey)),
  { message: "duplicate app read" },
);
const appReadsOutputSchema = z.array(appReadOutputSchema).refine(
  (reads) => unique(reads.map(appReadKey)),
  { message: "duplicate app read" },
);

function mcpKey(entry: { server_name: string; original_tool?: string }) {
  return `${entry.server_name}\0${entry.original_tool ?? ""}`;
}

const skillsOffSchema = z.array(nonblankSchema).refine(unique, {
  message: "duplicate skill",
});
const mcpOffListSchema = z.array(mcpOffSchema).refine(
  (entries) => unique(entries.map(mcpKey)),
  { message: "duplicate mcp entry" },
);
const mcpOffListOutputSchema = z.array(mcpOffOutputSchema).refine(
  (entries) => unique(entries.map(mcpKey)),
  { message: "duplicate mcp entry" },
);
const mcpToolListSchema = z.array(mcpToolSchema).refine(
  (entries) => unique(entries.map(mcpKey)),
  { message: "duplicate mcp tool" },
);
const mcpToolListOutputSchema = z.array(mcpToolOutputSchema).refine(
  (entries) => unique(entries.map(mcpKey)),
  { message: "duplicate mcp tool" },
);

// 설정 칸. 어느 칸이 어느 agent에 있을 수 있는지(built-in은 name·contexts·app_reads 없음, contexts는 project
// Operator만, app_reads는 앱 Operator만)는 역할과 자리를 알아야 하므로 파일을 읽고 쓰는 쪽이 검사한다.
const frontmatterFields = {
  name: agentNameSchema.optional(),
  profile: profileSchema.optional(),
  model: modelChoiceSchema.optional(),
  contexts: contextsSchema.optional(),
  app_reads: appReadsSchema.optional(),
  skills_off: skillsOffSchema.optional(),
  mcp_off: mcpOffListSchema.optional(),
  safe_tools: mcpToolListSchema.optional(),
  permissions: agentPermissionsSchema.optional(),
};
const frontmatterOutputFields = {
  name: agentNameSchema.optional(),
  profile: profileOutputSchema.optional(),
  model: modelChoiceOutputSchema.optional(),
  contexts: contextsSchema.optional(),
  app_reads: appReadsOutputSchema.optional(),
  skills_off: skillsOffSchema.optional(),
  mcp_off: mcpOffListOutputSchema.optional(),
  safe_tools: mcpToolListOutputSchema.optional(),
  permissions: agentPermissionsOutputSchema.optional(),
};

// 정의 파일의 앞부분(frontmatter). 모르는 칸은 거절한다.
export const agentFrontmatterSchema = z.strictObject(frontmatterFields);
export type AgentFrontmatter = z.infer<typeof agentFrontmatterSchema>;

// AgentDefinition: 정의 파일 하나의 값. 본문이 그 agent의 지침이다(R6).
export const agentDefinitionSchema = z.strictObject({
  ...frontmatterFields,
  body: bodySchema,
});
export const agentDefinitionOutputSchema = z.object({
  ...frontmatterOutputFields,
  body: bodySchema,
});
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

// 자리 층 설정(`settings.md`): 역할별 model과 권한. Workspace 층의 같은 모양 값(역할별 기본 model은
// `agent-model-defaults`, 기본 권한은 platform/settings)은 이 route들이 아니라 resolve하는 쪽이 이 모양으로 넘긴다.
const settingsFields = {
  models: z.partialRecord(agentRoleSchema, modelChoiceSchema).optional(),
  permissions: agentPermissionsSchema.optional(),
};
const settingsOutputFields = {
  models: z.partialRecord(agentRoleSchema, modelChoiceOutputSchema).optional(),
  permissions: agentPermissionsOutputSchema.optional(),
};
export const agentSettingsSchema = z.strictObject(settingsFields);
export const agentSettingsOutputSchema = z.object(settingsOutputFields);
export type AgentSettings = z.infer<typeof agentSettingsSchema>;

// 값이 어느 층에서 왔나(R12). place와 definition은 그 층의 자리를 함께 적는다.
export const VALUE_LAYERS = [
  "default",
  "workspace",
  "place",
  "definition",
  "session",
] as const;
export const valueLayerSchema = z.enum(VALUE_LAYERS);
export type ValueLayer = z.infer<typeof valueLayerSchema>;

export const valueSourceSchema = z.object({
  layer: valueLayerSchema,
  place: agentPlaceOutputSchema.nullable(),
}).refine(
  (value) =>
    (value.place !== null) ===
      (value.layer === "place" || value.layer === "definition"),
  { message: "place is set exactly for the place and definition layers" },
);
export type ValueSource = z.infer<typeof valueSourceSchema>;

export function sourced<T extends z.ZodType>(value: T) {
  return z.object({ value, source: valueSourceSchema });
}

// 저장과 읽기의 전체 검사가 항목별로 알리는 이유다(R24). field는 점 경로(`contexts.1`, `model.api_key`)이고
// 파일 자체가 깨졌으면 `frontmatter`다.
export const AGENT_ISSUE_CODES = [
  "malformed",
  "unknown_field",
  "invalid_value",
  "required",
  "not_allowed",
  "reserved_name",
  "duplicate",
  "too_large",
  "missing_reference",
  "over_cap",
] as const;
export const agentIssueCodeSchema = z.enum(AGENT_ISSUE_CODES);

export const agentIssueSchema = z.object({
  field: z.string().min(1),
  code: agentIssueCodeSchema,
});
export type AgentIssue = z.infer<typeof agentIssueSchema>;

// 오류 details에 싣는 항목별 이유의 모양이다. 저장 거절(invalid_input)의 details가 이것이다.
export const agentIssuesDetailsSchema = z.object({
  issues: z.array(agentIssueSchema).min(1),
});

export const RESOLVED_FIELDS = [
  "name",
  "profile",
  "agent_instructions",
  "model",
  "tools",
  "skills",
  "mcp",
  "contexts",
  "app_reads",
  "safe_tools",
] as const;
export type ResolvedField = (typeof RESOLVED_FIELDS)[number];

// 앱 자리의 built-in은 project가 없어 context 자료가 0개이고, 그 이유를 밝힌다(R16).
export const CONTEXTS_EMPTY_REASONS = ["no_project"] as const;

const sourcesSchema = z.strictObject(
  Object.fromEntries(
    RESOLVED_FIELDS.map((field) => [field, valueSourceSchema]),
  ) as Record<ResolvedField, typeof valueSourceSchema>,
);

const resolvedFields = {
  assignment: idSchema("asg"),
  role: agentRoleSchema,
  place: agentPlaceOutputSchema,
  name: agentNameSchema,
  profile: profileOutputSchema,
  agent_instructions: sha256Schema,
  model: modelChoiceOutputSchema,
  tools: toolListSchema,
  skills: z.array(nonblankSchema).refine(unique, {
    message: "duplicate skill",
  }),
  mcp: mcpToolListOutputSchema,
  contexts: contextsSchema,
  contexts_reason: z.enum(CONTEXTS_EMPTY_REASONS).nullable(),
  app_reads: appReadsOutputSchema,
  safe_tools: mcpToolListOutputSchema,
  sources: sourcesSchema,
  hash: sha256Schema,
};

function resolvedShape(value: {
  role: AgentRole;
  place: { kind: AgentPlaceKind };
  contexts: readonly string[];
  contexts_reason: string | null;
  app_reads: readonly unknown[];
}): boolean {
  if (!agentPlaceAllowsRole(value.role, value.place)) return false;
  if (value.contexts_reason !== null && value.contexts.length !== 0) {
    return false;
  }
  return value.role === "operator" || value.app_reads.length === 0;
}

// run을 준비할 때 한 번 만들어 run 기준에 고정하는 값이다. 같은 파일과 설정이면 같은 값과 hash가 나오고
// hash는 hash를 뺀 나머지 값의 canonical JSON의 sha256이다(R25).
export const resolvedAgentSchema = z.object(resolvedFields).refine(
  resolvedShape,
  { message: "resolved agent shape is not coupled" },
);
export type ResolvedAgent = z.infer<typeof resolvedAgentSchema>;

// 목록 한 줄의 model 요약. 어느 층에서 왔는지도 함께 읽는다(R12).
export const modelSummarySchema = z.object({
  provider: idSchema("pvd"),
  model_name: nonblankSchema,
  source: valueSourceSchema,
});

export const AGENT_LIST_STATES = ["enabled", "paused"] as const;

// 목록의 정본은 assignment다. issues가 비어 있지 않으면 파일이 틀려 그 agent만 시작하지 않는다(R24).
export const agentListRowSchema = z.object({
  assignment: idSchema("asg"),
  role: agentRoleSchema,
  kind: agentKindSchema,
  name: agentNameSchema,
  profile: profileOutputSchema,
  model: modelSummarySchema.nullable(),
  state: z.enum(AGENT_LIST_STATES),
  issues: z.array(agentIssueSchema),
}).refine((row) => row.kind === agentKindOf(row.role), {
  message: "kind does not match role",
});
export type AgentListRow = z.infer<typeof agentListRowSchema>;
