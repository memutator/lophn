import { z } from "zod";
import { defineCommand, defineMemory, defineRead } from "../base/route.ts";
import { idSchema } from "../base/ids.ts";
import { sha256Schema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import { secretNameSchema } from "../secrets/secrets.ts";
import { agentPlaceOutputSchema, agentPlaceSchema } from "./agent-values.ts";
import { skillNameSchema, SKILLS_OFF_MAX } from "./skill-settings.ts";

const nonempty = z.string().regex(/\S/);
const nameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
const effectSchema = z.enum(["read", "write", "external"]);
const headerName = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);
const absolutePath = z.string().regex(/^(\/|[A-Za-z]:\\).+/);

// 층(전역, project, agent)에 두는 서버 한 칸이다. tool 분류는 없다: tool의 효과는 readOnlyHint가 참이면 read,
// 아니면 external이다. credential은 `secrets.json`의 이름 참조다: 값은 보호 입력 창을 거쳐 `secrets/put`으로만 들어오고
// 설정 파일에는 이름만 남는다. 이름은 `mcp.`로 시작해야 한다(보통 `mcp.<global 또는 project id>.<서버>`). 설정이
// `provider.`나 OAuth token(`mcp-oauth.`)을 가리켜 그 값이 MCP URL로 가지 않게 한다. OAuth token은 core가 서버
// 자리와 이름으로 정한 `mcp-oauth.` 이름에 둔다.
const secretCredentialSchema = z.strictObject({
  secret: secretNameSchema.startsWith("mcp."),
});
const valueOrSecret = z.union([
  z.strictObject({ value: z.string() }),
  secretCredentialSchema,
]);

const layerAuthSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({
    kind: z.literal("bearer"),
    credential: secretCredentialSchema,
  }),
  z.strictObject({
    kind: z.literal("api_key"),
    credential: secretCredentialSchema,
    header_name: headerName,
  }),
  z.strictObject({
    kind: z.literal("oauth2"),
    issuer: z.string().regex(/^https:\/\/\S+$/),
    client_id: nonempty.max(200),
    client_credential: secretCredentialSchema.nullable(),
    scopes: z.array(nonempty.max(128)).max(32),
  }),
]);

// stdio env는 값만 받는다. secret을 실행 파일에 넘길 때 대조할 목적지가 없다.
const layerStdioSchema = z.strictObject({
  executable: absolutePath,
  args: z.array(z.string()).max(64),
  cwd: absolutePath.nullable(),
  env: z.record(
    z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/),
    z.strictObject({ value: z.string() }),
  ),
});

const layerHttpSchema = z.strictObject({
  url: z
    .string()
    .regex(/^(https:\/\/\S+|http:\/\/(127\.0\.0\.1|\[::1\])(:\d+)?(\/\S*)?)$/),
  headers: z.record(headerName, valueOrSecret),
  auth: layerAuthSchema,
});

const layerServerFields = {
  name: nameSchema,
  enabled: z.boolean(),
  call_timeout_ms: z.number().int().min(1000).max(600_000),
};
export const mcpServerSchema = z.discriminatedUnion("transport", [
  z.strictObject({
    ...layerServerFields,
    transport: z.literal("stdio"),
    stdio: layerStdioSchema,
  }),
  z.strictObject({
    ...layerServerFields,
    transport: z.literal("http"),
    http: layerHttpSchema,
  }),
]);
export type McpServer = z.infer<typeof mcpServerSchema>;

const mcpAuthPlaceSchema = agentPlaceSchema.nullable();

// MCP OAuth 2.1의 시작 입구다.
// 사람이 서버 이름을 정하고 lophn이 S256 PKCE verifier·challenge와 무작위 state를 만들어
// 사람이 OS browser에서 열 authorization 주소와 callback port를 돌려준다. verifier·state는
// 값이므로 응답 어디에도 옮기지 않고 core의 작업 메모리(packages/core/lophn-agent/extensions/
// mcp-oauth.ts)에만 산다. 기다리는 시한은 5분이다. ledger queue를 거치지 않는다(작업 메모리가
// 곧 상태다). 진행 중인 로그인을 그만두려면 `CancelMcpAuth`다.
//
// 서버는 이름만으로 하나가 정해지지 않는다: 서로 다른 자리가 같은 이름의 서버를 따로 둘 수 있다.
// 그래서 시작·완료 입력은 서버가 등록된 자리를 함께 받는다.
export const mcpAuthBeginInputSchema = z.strictObject({
  // 등록한 서버 이름이다. 위 nameSchema와 같은 규칙이다.
  name: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  // 서버가 등록된 자리다. 전역 서버는 자리가 아니므로 null이다(이웃 route는 전역을 다른
  // 설정이 맡아 자리만 받지만, 이 입구는 전역 서버의 로그인도 열어야 해서 null을 둔다).
  place: mcpAuthPlaceSchema,
  // 사람이 등록한 client_id다(동적 등록을 지원하지 않는 서버도 이 하나로 진행한다).
  client_id: z.string().min(1).max(200),
  scopes: z.array(z.string().min(1).max(128)).max(32),
});
const mcpAuthBeginOutputSchema = z.object({
  // 사람이 OS browser에서 열 주소다(shell이 크롬 링크로 연다). 값 없는 안내라
  // secret이 아니다.
  url: z.string(),
  // 사람 credential의 loopback callback port다(127.0.0.1).
  callback_port: z.number().int().positive(),
});

export const mcpAuthBegin = defineMemory({
  resource: "agent-mcp-auth",
  method: "begin",
  name: "BeginMcpAuth",
  input: mcpAuthBeginInputSchema,
  output: mcpAuthBeginOutputSchema,
  actors: ["user"],
  errors: [
    "unauthorized",
    "forbidden",
    "invalid_input",
    "conflict",
    "unavailable",
  ],
});

// MCP OAuth 2.1의 완료 입구다. 사람이 돌아온 callback의 code·state를
// 받아 lophn이 token 교환을 마친다. state는 시작이 만든 무작위 값과 같아야 하고(잘못된
// 반환 검증 값은 거절이다), 교환한 token은 `secrets.json`의 서버 몫 `mcp-oauth.` 이름에만 보관한다. 설정에는
// 쓰지 않는다. 성공·실패의 상태는 `/agent-mcp-auth/state` read로만 보인다: token·verifier·state 값은 응답
// 어디에도 없다.
export const mcpAuthCompleteInputSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  // 시작이 받은 자리와 같다: 서버가 등록된 자리이고 전역 서버는 null이다.
  place: mcpAuthPlaceSchema,
  // 사람 credential의 loopback callback port다.
  callback_port: z.number().int().positive(),
});
const mcpAuthCompleteOutputSchema = z.object({
  // 잘못된 state는 거절이다. complete이 결과 코드만 남기고 값은 없다.
  completed: z.boolean(),
});

export const mcpAuthComplete = defineMemory({
  resource: "agent-mcp-auth",
  method: "complete",
  name: "CompleteMcpAuth",
  input: mcpAuthCompleteInputSchema,
  output: mcpAuthCompleteOutputSchema,
  actors: ["user"],
  errors: [
    "unauthorized",
    "forbidden",
    "invalid_input",
    "conflict",
    "unavailable",
  ],
});

// 로그인 상태 read다. 서버(이름+자리)마다 지금 상태와 실패 이유 코드만 돌려준다.
// 상태는 끝난 세션의 기억이 아니라 core가 지금 쥔 것이다: 진행 중인 로그인(작업 메모리), 마지막 실패,
// 그리고 보관한 token이 지금 설정(발급자·URL·client)과 맞는지다.
// - none: 로그인하지 않았거나 설정이 바뀌어 옛 token을 쓰지 않는다.
// - in_progress: 사람이 browser에서 돌아오기를 기다린다(시한 안).
// - signed_in: 쓸 수 있는 token이 있다.
// - failed: 마지막 시도나 갱신이 실패했고 reason이 이유다. 새로 시작하면 지워진다.
// 등록하지 않은 서버나 OAuth가 아닌 서버는 none이다. token·verifier·state·code 값이 들어갈 칸은 없다.
const MCP_AUTH_STATES = ["none", "in_progress", "signed_in", "failed"] as const;
const MCP_AUTH_FAILURES = [
  "callback_timeout",
  "state_mismatch",
  "exchange_failed",
  "refresh_rejected",
  "expired",
  "store_failed",
] as const;
const mcpAuthStateSchema = z.enum(MCP_AUTH_STATES);
const mcpAuthFailureSchema = z.enum(MCP_AUTH_FAILURES);
export type McpAuthStateName = z.infer<typeof mcpAuthStateSchema>;
export type McpAuthFailure = z.infer<typeof mcpAuthFailureSchema>;

const mcpAuthServerName = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);

export const mcpAuthStateInputSchema = z.strictObject({
  servers: z
    .array(
      z.strictObject({ name: mcpAuthServerName, place: mcpAuthPlaceSchema }),
    )
    .max(64),
});
const mcpAuthStateOutputSchema = z.strictObject({
  servers: z.array(
    z.strictObject({
      name: mcpAuthServerName,
      place: agentPlaceOutputSchema.nullable(),
      state: mcpAuthStateSchema,
      reason: mcpAuthFailureSchema.nullable(),
    }),
  ),
});

export const mcpAuthState = defineMemory({
  resource: "agent-mcp-auth",
  method: "state",
  name: "ReadMcpAuthState",
  input: mcpAuthStateInputSchema,
  output: mcpAuthStateOutputSchema,
  actors: ["user"],
  errors: ["unauthorized", "forbidden", "invalid_input", "unavailable"],
});

// 기다리는 로그인을 사람이 그만둔다. browser를 닫았거나 주소를 열지 못한 로그인이
// 작업 메모리에 남아 다시 시작할 때 conflict가 나지 않게 한다. 진행 중인 것이 없으면 아무것도 바꾸지
// 않고 cancelled가 false다. 이미 보관한 token은 건드리지 않는다.
export const mcpAuthCancelInputSchema = z.strictObject({
  name: mcpAuthServerName,
  place: mcpAuthPlaceSchema,
});
const mcpAuthCancelOutputSchema = z.object({
  cancelled: z.boolean(),
});

export const mcpAuthCancel = defineMemory({
  resource: "agent-mcp-auth",
  method: "cancel",
  name: "CancelMcpAuth",
  input: mcpAuthCancelInputSchema,
  output: mcpAuthCancelOutputSchema,
  actors: ["user"],
  errors: ["unauthorized", "forbidden", "invalid_input", "unavailable"],
});

// Grants 화면이 서버별 MCP tool 목록(원래 이름, 설명, effect)을 읽는 입구다. 부르는 쪽은 사람이다.
// MCP 연결은 agent runtime child가 쥐고 core module graph에는 외부 연결이 없어서, core는 요청을 대기열에 놓고
// runtime이 `request-take`·`request-done`으로 가져가 답한다(발급자 요청 `issuer-requests.ts`와 같은 길). 그 대기열 상태를 쥔 memory
// route라서 reader Worker의 read로는 못 한다. place는 Grants를 여는 agent의 자리다: project면 전역 서버에 그 project
// 층을 더한 목록이고 app이거나 null이면 전역 서버만이다. agent는 Grants를 여는 Operator의 id다: 그 Operator 정의 층의
// 서버를 마지막 층으로 더한다. Operator가 아니면 null이다.
//
// 서버마다 reason이 목록을 못 읽은 이유다. null이면 읽었다. 아니면 tools는 빈 배열이다.
// - disabled: 설정에서 꺼진 서버.
// - sign_in: OAuth 로그인이 필요한 서버.
// - unreachable: 그 밖에 연결이나 목록 읽기가 실패한 서버.
// effect는 서버가 알린 readOnlyHint가 참이면 read, 아니면 external이라 write는 나오지 않는다(선언을 믿는다).
// tool은 서버가 알린 원래 이름이고 grant의 mcp_tool entry의 tool과 같은 값이다. 응답에는 이름, 설명, effect뿐이고
// 서버 설정(주소, 실행 파일, header, env)이나 credential은 들어가지 않는다.
const mcpToolSchema = z.strictObject({
  tool: z.string().min(1),
  description: z.string().max(500),
  effect: effectSchema,
});
const mcpToolServerSchema = z.strictObject({
  name: nameSchema,
  tools: z.array(mcpToolSchema).max(2048),
  reason: z.enum(["disabled", "sign_in", "unreachable"]).nullable(),
});
export type McpToolServer = z.infer<typeof mcpToolServerSchema>;

export const mcpToolsList = defineMemory({
  resource: "agent-mcp-tools",
  method: "list",
  name: "ListMcpTools",
  input: z.strictObject({
    place: mcpAuthPlaceSchema,
    agent: idSchema("agt").nullable(),
  }),
  output: z.strictObject({ servers: z.array(mcpToolServerSchema) }),
  actors: ["user"],
  errors: ["unauthorized", "forbidden", "invalid_input", "unavailable"],
});

// runtime이 core 대신 서버에 연결해 tool 목록을 읽는 machine 입구다. 사람이 `ListMcpTools`를 부르면 core가 요청을
// 작업 메모리 대기열에 놓고, runtime이 가져가 place가 정하는 서버 집합을 읽은 뒤 `FinishMcpToolsRequest`로 답한다.
// 보낼 요청이 없으면 null이다.
export const mcpToolsRequestTake = defineMemory({
  resource: "agent-mcp-tools",
  method: "request-take",
  name: "TakeMcpToolsRequest",
  input: z.strictObject({}),
  output: z.strictObject({
    request: z
      .strictObject({
        id: z.string().min(1).max(64),
        place: mcpAuthPlaceSchema,
        agent: idSchema("agt").nullable(),
      })
      .nullable(),
  }),
  actors: ["machine"],
  errors: ["unauthorized", "forbidden", "invalid_input", "unavailable"],
});

export const mcpToolsRequestDone = defineMemory({
  resource: "agent-mcp-tools",
  method: "request-done",
  name: "FinishMcpToolsRequest",
  input: z.strictObject({
    id: z.string().min(1).max(64),
    servers: z.array(mcpToolServerSchema).max(64),
  }),
  // 이미 기한이 지났거나 모르는 요청이면 accepted가 false다.
  output: z.strictObject({ accepted: z.boolean() }),
  actors: ["machine"],
  errors: ["unauthorized", "forbidden", "invalid_input", "unavailable"],
});

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

const projectServersSchema = z
  .array(mcpServerSchema)
  .max(32)
  .refine(
    (servers) =>
      new Set(servers.map((server) => server.name)).size === servers.length,
    { message: "mcp server names must be unique" },
  );

// project 층의 설정이다. 같은 이름의 MCP 서버는 마지막 층(agent)이 덮고 이름이 다르면 모두 쓴다.
// skills_off는 이 project에서 끈 skill 이름이고 mcp_off는 이 project에서 끈 전역 MCP 서버 이름이다.
// 지금 없는 이름도 지우지 않는다. 모두 새 내용 전체다.
const projectSkillsOffSchema = z.array(skillNameSchema).max(SKILLS_OFF_MAX);
const projectMcpOffSchema = z.array(nameSchema).max(32);

export const projectExtensionSettingsRead = defineRead({
  resource: "project-extension-settings",
  method: "read",
  name: "ReadProjectExtensionSettings",
  input: z.strictObject({ project: idSchema("prj") }),
  output: withReadCommon(
    z.object({
      project: idSchema("prj"),
      mcp_servers: z.array(mcpServerSchema),
      skills_off: projectSkillsOffSchema,
      mcp_off: projectMcpOffSchema,
      hash: sha256Schema.nullable(),
    }),
  ),
  actors: ["user", "machine"],
  errors: [...readErrors],
});

export const projectExtensionSettingsChange = defineCommand({
  resource: "project-extension-settings",
  method: "change",
  name: "ChangeProjectExtensionSettings",
  input: z.strictObject({
    project: idSchema("prj"),
    mcp_servers: projectServersSchema,
    skills_off: projectSkillsOffSchema,
    mcp_off: projectMcpOffSchema,
  }),
  output: z.object({
    project: idSchema("prj"),
    hash: sha256Schema,
  }),
  compare: z.strictObject({ hash: sha256Schema.nullable() }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "not_found",
    "conflict",
  ],
});

export const EXTENSION_ROUTES = [
  projectExtensionSettingsRead,
  projectExtensionSettingsChange,
] as const;
