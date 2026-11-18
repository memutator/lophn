import { z } from "zod";
import { idSchema } from "../base/ids.ts";
import { EXTENSION_ID } from "../extensions/manifest.ts";
import { slugSchema } from "../projects/values.ts";
import { profileOutputSchema, profileSchema } from "./agent-profile.ts";
import { mcpServerSchema } from "./mcp-settings.ts";
import { toolKeySchema } from "../apps/channel-values.ts";
import { CODING_BUILTINS } from "./workspaces.ts";
import {
  INSTRUCTION_FILE_MAX_BYTES,
  modelChoiceOutputSchema,
  modelChoiceSchema,
} from "./models.ts";

export * from "./agent-profile.ts";

// agent 정의의 값. 정의와 설정은 app data의 Markdown 파일이고,
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

// agent의 주소는 handle이다. 만들 때 정해 바뀌지 않고 범위 있는 agent를 포함해 전역에 하나다.
// 앞뒤 공백과 영문 대소문자를 무시해 견주는 열쇠다. `lophn`은 내장 agent의 handle이라 다른 agent가 쓸 수 없다.
// name은 보이는 이름이라 겹쳐도 된다(주소가 아니다).
export function agentHandleKey(handle: string): string {
  return handle.trim().toLowerCase();
}

// 새로 만드는 handle의 모양. 옛 정의는 name을 그대로 handle로 옮겨 이 모양이 아닐 수 있어 파일 schema는 더 넓게 받는다.
export const NEW_AGENT_HANDLE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

// 지침 파일 하나(agent 정의 본문 포함)의 상한이다.
export const AGENT_BODY_MAX_BYTES = INSTRUCTION_FILE_MAX_BYTES;

// 자리 설정이 놓이는 자리. 전역(global)은 자리가 아니다.
export const agentWorkspaceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("project"), id: idSchema("prj") }),
  z.strictObject({ kind: z.literal("app"), id: idSchema("app") }),
]);
export const agentWorkspaceOutputSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("project"), id: idSchema("prj") }),
  z.object({ kind: z.literal("app"), id: idSchema("app") }),
]);
export type AgentWorkspace = z.infer<typeof agentWorkspaceSchema>;

// 끈 MCP. original_tool을 생략하면 그 서버 전체다.
const mcpOffFields = {
  server_name: nonblankSchema,
  original_tool: nonblankSchema.optional(),
};
const mcpOffSchema = z.strictObject(mcpOffFields);
const mcpOffOutputSchema = z.object(mcpOffFields);
export type McpOff = z.infer<typeof mcpOffSchema>;

// 외부 MCP tool 하나다. resolved agent의 켜진 MCP가 이 모양을 쓴다.
const mcpToolFields = {
  server_name: nonblankSchema,
  original_tool: nonblankSchema,
};
const mcpToolSchema = z.strictObject(mcpToolFields);
export type McpTool = z.infer<typeof mcpToolSchema>;

export const agentNameSchema = nonblankSchema;
export const agentHandleSchema = nonblankSchema.refine(
  (value) => value === value.trim(),
  { message: "expected no surrounding whitespace" },
);
const bodySchema = z
  .string()
  .refine((value) => utf8Bytes(value) <= AGENT_BODY_MAX_BYTES, {
    message: "body is over the instruction file limit",
  });

function mcpKey(entry: { server_name: string; original_tool?: string }) {
  return `${entry.server_name}\0${entry.original_tool ?? ""}`;
}

const skillsSchema = z.array(nonblankSchema).refine(unique, {
  message: "duplicate skill",
});
// 할당한 앱의 slug. slug는 앱을 만들 때 정해지고 바뀌지 않아 사람이 손으로 읽고 고칠 수 있다.
// 할당은 그 앱의 command를 부르게 하고 그 앱의 public skill을 받게 한다.
const appsSchema = z.array(slugSchema).refine(unique, {
  message: "duplicate app",
});
// 할당한 다른 기계의 앱. 그 앱은 이 기계에 slug가 없어 id로 둔다. `name`은 꺼진 기계의 앱을 보이는 표시값이고 `removed`는 그 앱에서 뺀 command다.
// 사람만 쓰는 칸이다. 옛 파일에는 이 칸이 없다.
const remoteAppsSchema = z
  .array(
    z.strictObject({
      machine: idSchema("mch"),
      app: idSchema("app"),
      name: z.string().min(1).max(64),
      removed: z
        .array(toolKeySchema)
        .refine(unique, { message: "duplicate removed tool" }),
    }),
  )
  .refine(
    (entries) =>
      unique(entries.map((entry) => `${entry.machine}/${entry.app}`)),
    { message: "duplicate remote app" },
  );
// 할당한 shell extension의 id. 그 extension이 manifest로 선언한 tool 전부가 이 agent의 `tools[]`에 든다(custom은 `tools`가 고른 것만).
// 사람만 쓰는 칸이다. 꺼졌거나 없는 extension의 id를 적어도 저장은 되고, 그 tool은 목록에 서지 않는다.
const extensionsSchema = z
  .array(z.string().regex(EXTENSION_ID).max(64))
  .refine(unique, {
    message: "duplicate extension",
  });
// agent 층 권한 규칙. 지금은 할당한 앱에서 뺀 command(`lophn(<앱 slug> <command>)`)만 쓴다.
const permissionsSchema = z.strictObject({
  deny: z
    .array(nonblankSchema)
    .refine(unique, { message: "duplicate rule" })
    .optional(),
});
const mcpOffListSchema = z
  .array(mcpOffSchema)
  .refine((entries) => unique(entries.map(mcpKey)), {
    message: "duplicate mcp entry",
  });
const mcpOffListOutputSchema = z
  .array(mcpOffOutputSchema)
  .refine((entries) => unique(entries.map(mcpKey)), {
    message: "duplicate mcp entry",
  });

// agent 층 MCP 서버. 이름이 같은 서버는 둘 수 없다.
const mcpServersSchema = z
  .array(mcpServerSchema)
  .max(32)
  .refine(
    (servers) =>
      new Set(servers.map((server) => server.name)).size === servers.length,
    { message: "mcp server names must be unique" },
  );

// runtime: 없으면 lophn이다. custom은 정의 본문과 `tools`, `skills`가 고른 것만 싣는다. harness 값은 third-party harness의
// CLI를 extension host의 `harness` extension이 돌리는 agent다(run-loop는 돌리지 않는다).
export const HARNESS_RUNTIMES = ["claude-code", "codex", "opencode"] as const;
export type HarnessRuntime = (typeof HARNESS_RUNTIMES)[number];
export const AGENT_RUNTIMES = ["lophn", "custom", ...HARNESS_RUNTIMES] as const;
export const agentRuntimeSchema = z.enum(AGENT_RUNTIMES);
export type AgentRuntime = z.infer<typeof agentRuntimeSchema>;

export function isHarnessRuntime(
  runtime: AgentRuntime | undefined,
): runtime is HarnessRuntime {
  return (HARNESS_RUNTIMES as readonly string[]).includes(runtime ?? "");
}

// 편집기가 runtime 고르기에 내는 값. harness 값은 설정 `extensions.harness.enabled`가 켜졌을 때만 낸다.
export function selectableRuntimes(
  harnessEnabled: boolean,
): readonly AgentRuntime[] {
  return harnessEnabled ? AGENT_RUNTIMES : ["lophn", "custom"];
}

// 한 줄 목적. 목록 카드와 다른 agent가 읽는 한 줄이라 줄바꿈과 긴 글을 받지 않는다.
export const AGENT_DESCRIPTION_MAX_CHARS = 200;
const descriptionSchema = nonblankSchema.refine(
  (value) =>
    !/[\r\n]/.test(value) && value.length <= AGENT_DESCRIPTION_MAX_CHARS,
  { message: "expected one line within the description limit" },
);

// 받고(input) 내는(output) 내용 종류. 칸이나 값이 없으면 셋 다다.
export const MODALITIES = ["text", "image", "file"] as const;
export const modalitySchema = z.enum(MODALITIES);
export type Modality = z.infer<typeof modalitySchema>;
const modalityListSchema = z.array(modalitySchema).refine(unique, {
  message: "duplicate modality",
});
const modalityFieldSchema = z.strictObject({
  input: modalityListSchema.optional(),
  output: modalityListSchema.optional(),
});

// custom이 고른 tool 이름(내장 tool, lophn 명령, `<slug>.<command>`, `mcp__<server>__<tool>`). runtime이 custom일 때만 쓴다.
const toolPicksSchema = z.array(nonblankSchema).refine(unique, {
  message: "duplicate tool",
});

// 정의 칸. 모든 agent가 같은 칸을 갖는다. lophn의 name·profile·`runtime: custom` 잠금, `tools`·`skills`와 runtime의 짝, 사람만 쓰는 칸(`mcp_servers`, `apps`, `remote_apps`, `extensions`, `permissions`, `skip`)의
// 거절은 저장하는 쪽(core)이 본다.
const frontmatterFields = {
  handle: agentHandleSchema,
  name: agentNameSchema,
  workspace: agentWorkspaceSchema.optional(),
  profile: profileSchema.optional(),
  runtime: agentRuntimeSchema.optional(),
  description: descriptionSchema.optional(),
  tools: toolPicksSchema.optional(),
  skills: skillsSchema.optional(),
  modality: modalityFieldSchema.optional(),
  model: modelChoiceSchema.optional(),
  skills_off: skillsSchema.optional(),
  mcp_off: mcpOffListSchema.optional(),
  mcp_servers: mcpServersSchema.optional(),
  apps: appsSchema.optional(),
  remote_apps: remoteAppsSchema.optional(),
  extensions: extensionsSchema.optional(),
  permissions: permissionsSchema.optional(),
  skip: z.boolean().optional(),
};
const frontmatterOutputFields = {
  handle: agentHandleSchema,
  name: agentNameSchema,
  workspace: agentWorkspaceOutputSchema.optional(),
  profile: profileOutputSchema.optional(),
  runtime: agentRuntimeSchema.optional(),
  description: descriptionSchema.optional(),
  tools: toolPicksSchema.optional(),
  skills: skillsSchema.optional(),
  modality: modalityFieldSchema.optional(),
  model: modelChoiceOutputSchema.optional(),
  skills_off: skillsSchema.optional(),
  mcp_off: mcpOffListOutputSchema.optional(),
  mcp_servers: mcpServersSchema.optional(),
  apps: appsSchema.optional(),
  remote_apps: remoteAppsSchema.optional(),
  extensions: extensionsSchema.optional(),
  permissions: permissionsSchema.optional(),
  skip: z.boolean().optional(),
};

// AgentDefinition: 정의 파일 하나의 값. 본문이 그 agent의 지침이다.
export const agentDefinitionSchema = z.strictObject({
  ...frontmatterFields,
  body: bodySchema,
});
export const agentDefinitionOutputSchema = z.object({
  ...frontmatterOutputFields,
  body: bodySchema,
});
export type AgentDefinition = z.infer<typeof agentDefinitionSchema>;

// 값이 어느 층에서 왔나. workspace와 definition은 그 층의 자리를 함께 적는다.
// 저장과 읽기의 전체 검사가 항목별로 알리는 이유다. field는 점 경로(`skills.1`, `model.api_key`)이고
// 파일 자체가 깨졌으면 `frontmatter`다.

// 오류 details에 싣는 항목별 이유의 모양이다. 저장 거절(invalid_input)의 details가 이것이다.

// 칸마다 그 값을 준 층. resolved agent와 run 기준이 같은 모양을 쓴다.

// run을 준비할 때 한 번 만들어 run 기준에 고정하는 값이다. 같은 파일과 설정이면 같은 값과 hash가 나오고
// hash는 hash를 뺀 나머지 값의 canonical JSON의 sha256이다.

const countSchema = z.number().int().nonnegative();

// 카드의 "n skills · n MCP". resolve 결과의 켜진 개수다.
// 파일이 틀려 resolve하지 못한 행은 셀 수 없어 null이다.
export const agentCountsSchema = z.object({
  skills: countSchema.nullable(),
  mcp: countSchema.nullable(),
});
export type AgentCounts = z.infer<typeof agentCountsSchema>;

// 목록의 정본은 assignment다. issues가 비어 있지 않으면 파일이 틀려 그 agent만 시작하지 않는다.
// `lophn`은 workspace마다 있는 내장 lophn의 handle이고 사람이 만든 agent에게는 예약이다. 이름의 기본값도 `lophn`이며 사람이 workspace마다 바꿀 수 있다.
export const LOPHN_AGENT_HANDLE = "lophn";
export const LOPHN_AGENT_NAME = "lophn";

// 내장 coding agent의 handle(harness id)도 예약이다. 사람이나 agent가 새로 만드는 agent가 쓰지 못한다.
const RESERVED_HANDLE_KEYS = new Set([
  LOPHN_AGENT_HANDLE,
  ...CODING_BUILTINS.map((builtin) => builtin.harness),
]);
export function isReservedHandle(handle: string): boolean {
  return RESERVED_HANDLE_KEYS.has(agentHandleKey(handle));
}
