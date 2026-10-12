import { z } from "zod";
import { defineCommand, defineMemory, defineRead } from "../base/route.ts";
import { defineEvent } from "../events/events.ts";
import { defineSetting } from "../config/settings.ts";
import { idSchema } from "../base/ids.ts";
import { sha256Schema } from "../base/values.ts";
import { withReadCommon } from "../base/envelope.ts";
import { agentPlaceOutputSchema, agentPlaceSchema } from "./agent-values.ts";
import {
  globalSkillsRead,
  skillShadowSchema,
  skillSkippedSchema,
  skillSummarySchema,
} from "./skill-settings.ts";

const revision = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);
const nonempty = z.string().regex(/\S/);
const nameSchema = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);
const effectSchema = z.enum(["read", "write", "external"]);

const secretRef = z.string().regex(/^sec:[A-Za-z0-9_.:-]{1,200}$/);
const plainOrSecret = z.union([
  z.strictObject({ kind: z.literal("value"), value: z.string() }),
  z.strictObject({ kind: z.literal("secret_ref"), secret_ref: secretRef }),
]);

const headerName = z.string().regex(/^[A-Za-z0-9-]{1,64}$/);

export const mcpAuthSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("none") }),
  z.strictObject({ kind: z.literal("bearer"), secret_ref: secretRef }),
  z.strictObject({
    kind: z.literal("api_key"),
    secret_ref: secretRef,
    header_name: headerName,
  }),
  z.strictObject({
    kind: z.literal("oauth2"),
    issuer: z.string().regex(/^https:\/\/\S+$/),
    client_id: nonempty.max(200),
    client_secret_ref: secretRef.nullable(),
    scopes: z.array(nonempty.max(128)).max(32),
    token_ref: secretRef.nullable(),
  }),
]);

const stdioSchema = z.strictObject({
  executable: z.string().regex(/^(\/|[A-Za-z]:\\).+/),
  args: z.array(z.string()).max(64),
  cwd: z.string().regex(/^(\/|[A-Za-z]:\\).+/).nullable(),
  env: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), plainOrSecret),
});

const httpSchema = z.strictObject({
  url: z.string().regex(
    /^(https:\/\/\S+|http:\/\/(127\.0\.0\.1|\[::1\])(:\d+)?(\/\S*)?)$/,
  ),
  headers: z.record(headerName, plainOrSecret),
  auth: mcpAuthSchema,
});

export const mcpToolClassificationSchema = z.strictObject({
  effect: effectSchema,
  schema_hash: sha256Schema,
  reversible: z.boolean(),
});

const serverFields = {
  name: nameSchema,
  revision,
  enabled: z.boolean(),
  call_timeout_ms: z.number().int().min(1000).max(600_000),
  classifications: z.record(nonempty, mcpToolClassificationSchema),
};

export const mcpServerConfigSchema = z.discriminatedUnion("transport", [
  z.strictObject({
    ...serverFields,
    transport: z.literal("stdio"),
    stdio: stdioSchema,
  }),
  z.strictObject({
    ...serverFields,
    transport: z.literal("http"),
    http: httpSchema,
  }),
]);
export type McpServerConfig = z.infer<typeof mcpServerConfigSchema>;

export const extensionSettingsSchema = z.strictObject({
  revision,
  registered_folders: z.array(z.string().regex(/^(\/|[A-Za-z]:\\).+/)).max(64),
  mcp_servers: z.array(mcpServerConfigSchema).max(32),
}).refine(
  (value) =>
    new Set(value.mcp_servers.map((server) => server.name)).size ===
      value.mcp_servers.length,
  { message: "mcp server names must be unique" },
);

export const mcpServersSetting = defineSetting({
  key: "lophn-agent.extensions.mcp_servers",
  owner: "lophn-agent/extensions",
  display_name_key: "settings.lophn-agent.mcp_servers.name",
  description: "Registered external MCP servers.",
  value_meaning_key: "settings.lophn-agent.mcp_servers.value",
  default_meaning_key: "settings.lophn-agent.mcp_servers.default",
  affected_features: ["lophn-agent/extensions"],
  risk_key: "settings.lophn-agent.mcp_servers.risk",
  revert_key: "settings.lophn-agent.mcp_servers.revert",
  constraints: {
    transports: ["stdio", "http"],
    auth: ["none", "bearer", "api_key", "oauth2"],
    call_timeout_ms: { min: 1000, max: 600_000, default: 60_000 },
    tool_effects: ["read", "write", "external"],
  },
  required: false,
  layers: ["common"],
  apply_at: "next_run",
  apply_at_key: "settings.lophn-agent.mcp_servers.apply_at",
  machine_local: true,
  default_present: true,
  default: [],
  value_type: z.array(mcpServerConfigSchema).max(32),
});

const mcpAuthPlaceSchema = agentPlaceSchema.nullable();

// MCP OAuth 2.1의 시작 입구다(shell#T31에서 넘어온 것의 route 절반).
// 사람이 서버 이름을 정하고 lophn이 S256 PKCE verifier·challenge와 무작위 state를 만들어
// 사람이 OS browser에서 열 authorization 주소와 callback port를 돌려준다. verifier·state는
// 값이므로 응답 어디에도 옮기지 않고 core의 작업 메모리(packages/core/lophn-agent/extensions/
// mcp-oauth.ts)에만 산다. 기다리는 시한은 5분이다. ledger queue를 거치지 않는다(작업 메모리가
// 곧 상태다). 진행 중인 로그인을 그만두려면 `CancelMcpAuth`다.
//
// 서버는 이름만으로 하나가 정해지지 않는다: 서로 다른 자리가 같은 이름의 서버를 따로 둘 수 있다
// (extensions R33). 그래서 시작·완료 입력은 서버가 등록된 자리를 함께 받는다.
export const mcpAuthBeginInputSchema = z.strictObject({
  // 등록한 서버 이름이다. 계약 serverFields의 nameSchema다.
  name: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  // 서버가 등록된 자리다. 전역(Workspace) 서버는 자리가 아니므로 null이다(이웃 route는 전역을 다른
  // 설정이 맡아 자리만 받지만, 이 입구는 전역 서버의 로그인도 열어야 해서 null을 둔다).
  place: mcpAuthPlaceSchema,
  // 사람이 등록한 client_id다(동적 등록을 지원하지 않는 서버도 이 하나로 진행한다).
  client_id: z.string().min(1).max(200),
  scopes: z.array(z.string().min(1).max(128)).max(32),
});
export const mcpAuthBeginOutputSchema = z.object({
  // 사람이 OS browser에서 열 주소다(shell#T31이 크롬 링크로 연다). 값 없는 안내라
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
// 반환 검증 값은 거절이다), 교환한 token은 OS keychain에만 보관하고 설정의
// `token_ref`가 그 보관을 가리키게 쓴다. 성공·실패의 상태는 `/v1/agent-mcp-auth/state` read로만
// 보인다: token·verifier·state 값은 응답 어디에도 없다.
export const mcpAuthCompleteInputSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  // 시작이 받은 자리와 같다: 서버가 등록된 자리이고 전역 서버는 null이다.
  place: mcpAuthPlaceSchema,
  // 사람 credential의 loopback callback port다.
  callback_port: z.number().int().positive(),
});
export const mcpAuthCompleteOutputSchema = z.object({
  // extensions R16: 잘못된 state는 거절이다. complete이 결과 코드만 남기고 값은 없다.
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
// 그리고 keychain에 보관한 token이 지금 설정(발급자·URL·client, token 참조)과 맞는지다.
// - none: 로그인하지 않았거나 설정이 바뀌어 옛 token을 쓰지 않는다.
// - in_progress: 사람이 browser에서 돌아오기를 기다린다(시한 안).
// - signed_in: 쓸 수 있는 token이 있다.
// - failed: 마지막 시도나 갱신이 실패했고 reason이 이유다. 새로 시작하면 지워진다.
// 등록하지 않은 서버나 OAuth가 아닌 서버는 none이다. token·verifier·state·code 값이 들어갈 칸은 없다.
export const MCP_AUTH_STATES = [
  "none",
  "in_progress",
  "signed_in",
  "failed",
] as const;
export const MCP_AUTH_FAILURES = [
  "callback_timeout",
  "state_mismatch",
  "exchange_failed",
  "refresh_rejected",
  "expired",
  "store_failed",
] as const;
export const mcpAuthStateSchema = z.enum(MCP_AUTH_STATES);
export const mcpAuthFailureSchema = z.enum(MCP_AUTH_FAILURES);
export type McpAuthStateName = z.infer<typeof mcpAuthStateSchema>;
export type McpAuthFailure = z.infer<typeof mcpAuthFailureSchema>;

const mcpAuthServerName = z.string().regex(/^[A-Za-z0-9_-]{1,32}$/);

export const mcpAuthStateInputSchema = z.strictObject({
  servers: z.array(
    z.strictObject({ name: mcpAuthServerName, place: mcpAuthPlaceSchema }),
  ).max(64),
});
export const mcpAuthStateOutputSchema = z.strictObject({
  servers: z.array(z.strictObject({
    name: mcpAuthServerName,
    place: agentPlaceOutputSchema.nullable(),
    state: mcpAuthStateSchema,
    reason: mcpAuthFailureSchema.nullable(),
  })),
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
export const mcpAuthCancelOutputSchema = z.object({
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

// 발급자(token endpoint) 호출을 agent runtime이 대신 보낸다(architecture: OAuth network는 runtime의 몫이고 core
// module graph에는 외부 fetch가 없다). core는 token 교환·갱신 요청을 작업 메모리 대기열에 놓고, runtime이 이 입구로
// 가져가 `--allow-net`이 허락한 발급자에게 보낸 뒤 받은 응답을 돌려준다. machine 자격만 부르고(actors), 요청과
// 응답 본문에는 code·verifier·refresh token·새 token이 들어 있어 loopback 밖으로 나가지 않으며 어디에도 남기지
// 않는다(ledger·event·log 없음). core가 정하는 것은 요청 내용이고 runtime은 그 URL이 https인지만 다시 본다.
export const MCP_AUTH_REQUEST_BODY_MAX = 65_536;
export const mcpAuthRequestSchema = z.strictObject({
  id: z.string().min(1).max(64),
  url: z.string().regex(/^https:\/\/\S+$/).max(2048),
  method: z.literal("POST"),
  headers: z.record(
    z.string().regex(/^[A-Za-z0-9-]{1,64}$/),
    z.string().max(512),
  ),
  body: z.string().max(MCP_AUTH_REQUEST_BODY_MAX),
});
export type McpAuthRequest = z.infer<typeof mcpAuthRequestSchema>;

export const mcpAuthRequestTake = defineMemory({
  resource: "agent-mcp-auth",
  method: "request-take",
  name: "TakeMcpAuthRequest",
  input: z.strictObject({}),
  // 보낼 요청이 없으면 null이다. 가져간 요청은 runtime이 답하거나 기한이 지날 때까지 core가 기다린다.
  output: z.object({ request: mcpAuthRequestSchema.nullable() }),
  actors: ["machine"],
  errors: ["unauthorized", "forbidden", "invalid_input", "unavailable"],
});

export const mcpAuthResponseSchema = z.strictObject({
  status: z.number().int().min(100).max(599),
  // redirect 판정에 쓰는 Location뿐이다. 다른 header는 옮기지 않는다.
  location: z.string().max(2048).nullable(),
  body: z.string().max(MCP_AUTH_REQUEST_BODY_MAX),
});

export const mcpAuthRequestDone = defineMemory({
  resource: "agent-mcp-auth",
  method: "request-done",
  name: "FinishMcpAuthRequest",
  input: z.strictObject({
    id: z.string().min(1).max(64),
    // 발급자에 닿지 못했으면 null이다.
    response: mcpAuthResponseSchema.nullable(),
  }),
  // 이미 기한이 지났거나 모르는 요청이면 accepted가 false다.
  output: z.object({ accepted: z.boolean() }),
  actors: ["machine"],
  errors: ["unauthorized", "forbidden", "invalid_input", "unavailable"],
});

// 자리(project·app) 층의 MCP 서버 목록이다(domain model PlaceExtensionSettings).
// 그 자리 data 폴더의 파일 하나이고 agents/settings.md와 따로 둔다(open-issues extensions#Q8).
// 어느 서버·tool을 쓸지는 agent 정의가 고르므로 이 목록에는 끈 것 칸이 없다.
const placeServersSchema = z.array(mcpServerConfigSchema).max(32).refine(
  (servers) =>
    new Set(servers.map((server) => server.name)).size === servers.length,
  { message: "mcp server names must be unique" },
);

export const readPlaceExtensionSettingsInputSchema = z.strictObject({
  place: agentPlaceSchema,
});

// mcp_servers는 이 자리 파일의 새 내용 전체다: 없는 서버는 지워진다. 서버의 revision은 받은 값이 아니라
// 바뀐 설정에 맞춰 core가 올린다.
export const changePlaceExtensionSettingsInputSchema = z.strictObject({
  place: agentPlaceSchema,
  mcp_servers: placeServersSchema,
});

const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

// 이 자리 서버 목록과 파일 hash, 그리고 이 자리의 agent가 발견하는 skill(자리 폴더가 먼저)과 가려진 것,
// 제외한 꾸러미를 돌려준다. 파일이 없으면 hash가 null이고 서버는 비어 있다. 읽기는 화면과 run 준비(machine)가 한다.
export const placeExtensionSettingsRead = defineRead({
  resource: "place-extension-settings",
  method: "read",
  name: "ReadPlaceExtensionSettings",
  input: readPlaceExtensionSettingsInputSchema,
  output: withReadCommon(z.object({
    place: agentPlaceOutputSchema,
    settings: z.object({
      revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      mcp_servers: z.array(mcpServerConfigSchema),
    }),
    hash: sha256Schema.nullable(),
    skills: z.array(skillSummarySchema),
    shadowed: z.array(skillShadowSchema),
    skipped: z.array(skillSkippedSchema),
  })),
  actors: ["user", "machine"],
  errors: [...readErrors],
});

// 서버 등록은 사람만 정한다. 파일 hash를 비교하고(없는 파일은 null) 전역 서버와 이름이 겹치면 거절한다.
export const placeExtensionSettingsChange = defineCommand({
  resource: "place-extension-settings",
  method: "change",
  name: "ChangePlaceExtensionSettings",
  input: changePlaceExtensionSettingsInputSchema,
  output: z.object({
    place: agentPlaceOutputSchema,
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

// 누가 언제 어느 자리의 목록을 바꿨는지만 남기고 내용의 전후는 hash뿐이다. 서버 설정은 경로와 secret 참조를 담는다.
export const placeExtensionSettingsChanged = defineEvent(
  "PlaceExtensionSettingsChanged",
  {
    subject: z.union([idSchema("prj"), idSchema("app")]),
    payload: z.object({
      place: agentPlaceOutputSchema,
      before_hash: sha256Schema.nullable(),
      after_hash: sha256Schema,
    }),
  },
);

export const EXTENSION_ROUTES = [
  placeExtensionSettingsRead,
  placeExtensionSettingsChange,
  globalSkillsRead,
] as const;

export const EXTENSION_EVENTS = [placeExtensionSettingsChanged] as const;
