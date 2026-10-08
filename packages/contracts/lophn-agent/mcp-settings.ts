import { z } from "zod";
import { defineMemory, defineSetting, sha256Schema } from "../platform/mod.ts";

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

// MCP OAuth 2.1의 시작 입구다(extensions#R16, shell#T31에서 넘어온 것의 route 절반).
// 사람이 서버 이름을 정하고 lophn이 S256 PKCE verifier·challenge와 무작위 state를 만들어
// 사람이 OS browser에서 열 authorization 주소와 callback port를 돌려준다. verifier·state는
// 값이므로 응답 어디에도 옮기지 않고 core runtime 제어 작업(packages/lophn-agent/
// extensions/mcp-auth.ts)의 작업 메모리에만 산다. credential 값 보관은 보호 창의
// `SetSecret`(이름 `mcp-<server>`)이 하고 설정은 `sec:mcp-<server>`를 가리킨다.
// ledger queue를 거치지 않는다(작업 메모리가 곧 상태다).
export const mcpAuthBeginInputSchema = z.strictObject({
  // 등록한 서버 이름이다. 계약 serverFields의 nameSchema(extensions R12)다.
  name: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
  // 사람이 등록한 client_id다(R16: 동적 등록을 지원하지 않는 서버도 이 하나로 진행한다).
  client_id: z.string().min(1).max(200),
  scopes: z.array(z.string().min(1).max(128)).max(32),
});
export const mcpAuthBeginOutputSchema = z.object({
  // 사람이 OS browser에서 열 주소다(shell#T31이 크롬 링크로 연다). 값 없는 안내라
  // secret이 아니다.
  url: z.string(),
  // 사람 credential의 loopback callback port다(127.0.0.1, extensions R16).
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

// MCP OAuth 2.1의 완료 입구다(extensions#R16, R17). 사람이 돌아온 callback의 code·state를
// 받아 lophn이 token 교환을 마친다. state는 시작이 만든 무작위 값과 같아야 하고(잘못된
// 반환 검증 값은 거절이다, extensions R16), 교환 성공·갱신 실패의 상태는
// `/v1/agent-mcp-auth/state` read로만 보인다: token·verifier·state 값은 응답 어디에도 없다.
export const mcpAuthCompleteInputSchema = z.strictObject({
  name: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/),
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
