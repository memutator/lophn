import { z } from "zod";
import { ERROR_CODES } from "../../base/mod.ts";
import { defineDecision } from "../base/confirmation-handle.ts";
import { withReadCommon } from "../base/envelope.ts";
import { defineEvent } from "../events/events.ts";
import { idSchema } from "../base/ids.ts";
import { defineCommand, defineMemory, defineRead } from "../base/route.ts";
import { seqSchema, sha256Schema } from "../base/values.ts";

export const connectionIdSchema = idSchema("cac");

export type ConnectionId = z.infer<typeof connectionIdSchema>;

// 공백뿐인 이름은 사람이 연결을 구별하지 못한다(domain-model connection label).
const labelSchema = z.string().regex(/\S/);

// scope는 생성 뒤 불변이다. all은 앱 대상이 없고 app은 앱 하나가 필수다.
export const connectionScopeSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("all"), app: z.null() }),
  z.strictObject({ kind: z.literal("app"), app: idSchema("app") }),
]);

export type ConnectionScope = z.infer<typeof connectionScopeSchema>;

// principal은 connection id에서 결정된다. 요청 본문으로 받지 않는다.
export function connectionPrincipal(id: ConnectionId): string {
  return `coding_agent:${id}`;
}

const principalSchema = z.string().refine((value) => {
  const prefix = "coding_agent:";
  return value.startsWith(prefix) &&
    connectionIdSchema.safeParse(value.slice(prefix.length)).success;
}, { message: "invalid principal" });

export const CONNECTION_STATES = ["active", "revoked"] as const;

export const connectionStateSchema = z.enum(CONNECTION_STATES);

export type ConnectionState = z.infer<typeof connectionStateSchema>;

// 원문 token도 검증 digest도 없다. 일반 읽기·event에 검증 값을 돌려주지 않는다.
export const connectionSchema = z.object({
  id: connectionIdSchema,
  label: labelSchema,
  scope: connectionScopeSchema,
  principal: principalSchema,
  state: connectionStateSchema,
  revision: seqSchema,
}).refine((value) => value.principal === connectionPrincipal(value.id), {
  message: "principal must be coding_agent:<id>",
});

export type Connection = z.infer<typeof connectionSchema>;

const cursorSchema = z.string().min(1);

export const connectionListInputSchema = z.strictObject({
  state: connectionStateSchema.optional(),
  scope: connectionScopeSchema.optional(),
  cursor: cursorSchema.optional(),
});

export const connectionListOutputSchema = withReadCommon(z.object({
  connections: z.array(connectionSchema),
}));

export const connectionShowInputSchema = z.strictObject({
  connection: connectionIdSchema,
});

export const connectionShowOutputSchema = withReadCommon(z.object({
  connection: connectionSchema,
}));

const readActors = ["user", "coding_agent"] as const;
const readErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "not_found",
  "unavailable",
] as const;

export const connectionList = defineRead({
  resource: "coding_agent_connections",
  method: "list",
  name: "ListCodingAgentConnections",
  input: connectionListInputSchema,
  output: connectionListOutputSchema,
  actors: readActors,
  errors: readErrors,
});

export const connectionShow = defineRead({
  resource: "coding_agent_connections",
  method: "show",
  name: "ShowCodingAgentConnection",
  input: connectionShowInputSchema,
  output: connectionShowOutputSchema,
  actors: readActors,
  errors: readErrors,
});

// 인증 경계가 core 밖에서 준비한 검증 digest만 받는다. 원문 token field는 없다.
export const connectionCreateInputSchema = z.strictObject({
  id: connectionIdSchema,
  label: labelSchema,
  scope: connectionScopeSchema,
  token_digest: sha256Schema,
});

export const connectionCreateOutputSchema = z.object({
  connection: connectionSchema,
});

export const connectionCreate = defineCommand({
  resource: "coding_agent_connections",
  method: "create",
  name: "CreateCodingAgentConnection",
  input: connectionCreateInputSchema,
  output: connectionCreateOutputSchema,
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "conflict"],
});

// 사람의 연결 결정 입구다(coding-agent/connection#R2). 사람이 고른 이름·범위만 받고 token 생성·
// 붙여 넣기 field가 없다. core의 인증 경계가 token을 자동 발급해 OS keychain에 보관한 뒤 검증 hash만
// connection create command로 제출한다. 결과에는 connection 참조만 있고 token·hash는 없다. 확인 창은
// 없다(회수만 묻는다). coding agent·app는 호출할 수 없다.
export const connectionConnectInputSchema = z.strictObject({
  label: labelSchema,
  scope: connectionScopeSchema,
});

export const connectionConnectOutputSchema = z.strictObject({
  connection: connectionIdSchema,
});

export const connectionConnect = defineMemory({
  resource: "coding_agent_connections",
  method: "connect",
  name: "ConnectCodingAgent",
  input: connectionConnectInputSchema,
  output: connectionConnectOutputSchema,
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "conflict", "unavailable"],
});

// 신뢰 감독(shell main)이 lophn이 띄운 coding TUI 아래의 MCP·CLI child process generation을 core의
// 보호 전달 인증 경계에 등록·해제하는 입구다(platform/identity#R15, coding-agent/connection#R17). 사람
// credential(shell main이 가진 user token)만 부른다. coding agent·app·agent는 호출할 수 없다. scope는 본문으로
// 받지 않고 core가 ledger의 connection 현재 상태에서 읽는다. 회수·없는 connection은 등록하지 않는다.
// process_generation은 `<pid>.<시작 tick>`, loader_identity는 설치된 helper의 절대 경로다.
export const connectionRegisterChildInputSchema = z.strictObject({
  connection: connectionIdSchema,
  process_generation: z.string().min(1).max(128),
  loader_identity: z.string().min(1).max(1024),
});

export const connectionRegisterChildOutputSchema = z.strictObject({
  registered: z.literal(true),
});

export const connectionRegisterChild = defineMemory({
  resource: "coding_agent_connections",
  method: "register_child",
  name: "RegisterCodingAgentChild",
  input: connectionRegisterChildInputSchema,
  output: connectionRegisterChildOutputSchema,
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

export const connectionEndChildInputSchema = z.strictObject({
  process_generation: z.string().min(1).max(128),
});

export const connectionEndChildOutputSchema = z.strictObject({});

export const connectionEndChild = defineMemory({
  resource: "coding_agent_connections",
  method: "end_child",
  name: "EndCodingAgentChild",
  input: connectionEndChildInputSchema,
  output: connectionEndChildOutputSchema,
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

export const connectionEndConnectionInputSchema = z.strictObject({
  connection: connectionIdSchema,
});

export const connectionEndConnectionOutputSchema = z.strictObject({
  ended: z.number().int().min(0),
});

export const connectionEndConnection = defineMemory({
  resource: "coding_agent_connections",
  method: "end_connection",
  name: "EndCodingAgentConnectionChildren",
  input: connectionEndConnectionInputSchema,
  output: connectionEndConnectionOutputSchema,
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 회수만 사람 결정이다. 표시와 제출이 같은 대상·판을 묶는다.
export const CODING_AGENT_CONNECTION_REVOKE = defineDecision(
  "coding_agent_connection_revoke",
);

export const connectionRevokeInputSchema = z.strictObject({
  connection: connectionIdSchema,
  base_revision: seqSchema,
});

export const connectionRevokeOutputSchema = z.object({
  connection: connectionSchema,
});

export const connectionRevoke = defineCommand({
  resource: "coding_agent_connections",
  method: "revoke",
  name: "RevokeCodingAgentConnection",
  input: connectionRevokeInputSchema,
  output: connectionRevokeOutputSchema,
  compare: z.strictObject({ base_revision: seqSchema }),
  actors: ["user"],
  errors: ["not_found", "forbidden", "conflict"],
  confirmation: "required",
  binding: ["connection", "base_revision"],
  display_read: "ShowCodingAgentConnection",
});

export const codingAgentConnectionCreatedPayloadSchema = z.object({
  label: labelSchema,
  scope: connectionScopeSchema,
  principal: principalSchema,
});

export const codingAgentConnectionCreated = defineEvent(
  "CodingAgentConnectionCreated",
  {
    subject: connectionIdSchema,
    payload: codingAgentConnectionCreatedPayloadSchema,
  },
);

export const codingAgentConnectionRevokedPayloadSchema = z.object({
  before_revision: seqSchema,
});

export const codingAgentConnectionRevoked = defineEvent(
  "CodingAgentConnectionRevoked",
  {
    subject: connectionIdSchema,
    payload: codingAgentConnectionRevokedPayloadSchema,
  },
);

export const CONNECTION_ROUTES = [
  connectionList,
  connectionShow,
  connectionCreate,
  connectionConnect,
  connectionRegisterChild,
  connectionEndChild,
  connectionEndConnection,
  connectionRevoke,
] as const;

export const CONNECTION_EVENTS = [
  codingAgentConnectionCreated,
  codingAgentConnectionRevoked,
] as const;

const knownErrors: readonly string[] = ERROR_CODES;
for (const route of CONNECTION_ROUTES) {
  for (const code of route.errors) {
    if (!knownErrors.includes(code)) {
      throw new Error("connection error code is outside the common seven");
    }
  }
}
