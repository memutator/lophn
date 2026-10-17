import { z } from "zod";
import { ERROR_CODES, type Result } from "../../base/mod.ts";
import { withReadCommon } from "../base/envelope.ts";
import { defineEvent } from "../base/event.ts";
import { authenticatedContextSchema } from "../server/identity.ts";
import type { Sql } from "../server/registration.ts";
import { defineCommand, defineRead, defineUpload } from "../base/route.ts";

const SECRET_PURPOSES = [
  "app_secret",
  "provider_credential",
  "external_mcp_credential",
] as const;
const secretPurposeSchema = z.enum(SECRET_PURPOSES);
export type SecretPurpose = z.infer<typeof secretPurposeSchema>;

// 이름은 event subject에도 들어가므로 공통 subject key의 문법을 유지한다.
export const secretNameSchema = z.string().regex(/^[A-Za-z0-9_.:-]+$/);
export const secretOpaqueRefSchema = z.string().min(1);
export const secretRevisionSchema = z.number().int().positive().max(
  Number.MAX_SAFE_INTEGER,
);

const preparationFields = {
  preparation: secretOpaqueRefSchema,
  sealed_ref: secretOpaqueRefSchema,
  purpose: secretPurposeSchema,
  owner: z.string().min(1),
};
export const secretPreparationSchema = z.object(preparationFields);
export type SecretPreparation = z.infer<typeof secretPreparationSchema>;
export const secretPreparationInputSchema = z.strictObject(preparationFields);

const secretStatusSchema = z.object({
  name: secretNameSchema,
  configured: z.boolean(),
  revision: secretRevisionSchema.nullable(),
}).refine((value) => value.configured === (value.revision !== null), {
  message: "configuration and revision must agree",
});
export type SecretStatus = z.infer<typeof secretStatusSchema>;

const secretCleanupResultSchema = z.object({
  reference_blocked: z.boolean(),
  os_deleted: z.boolean(),
  processes_ended: z.boolean(),
});

const listSecretsInputSchema = z.strictObject({
  names: z.array(secretNameSchema).optional(),
});
const listSecretsOutputSchema = withReadCommon(z.object({
  secrets: z.array(secretStatusSchema),
}));
export const listSecrets = defineRead({
  resource: "secrets",
  method: "list",
  name: "ListSecrets",
  input: listSecretsInputSchema,
  output: listSecretsOutputSchema,
  // coding agent는 secret 이름·설정 여부도 읽지 못한다.
  actors: ["user", "agent", "app", "machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

const setSecretInputSchema = z.strictObject({
  name: secretNameSchema,
  preparation: secretPreparationInputSchema,
}).refine((value) =>
  value.preparation.purpose === "app_secret" &&
  value.preparation.owner === value.name, {
  message: "preparation must belong to the app secret name",
});
const secretCompareSchema = z.strictObject({
  sealed_ref: secretOpaqueRefSchema,
  revision: secretRevisionSchema,
});
const setSecretCompareSchema = z.union([
  z.strictObject({ sealed_ref: z.null(), revision: z.null() }),
  secretCompareSchema,
]);

// main↔core 비공개 비교 read. HTTP list에 raw·sealed를 더하지 않는다.
// expected_revision이 현재 revision과 다르면 conflict다. ok compare의 revision은
// 요청과 같고, 마지막 writer CAS도 검사한다.
const opaqueRequestId = z.string().min(1);
export const secretComparisonRequestSchema = z.strictObject({
  type: z.literal("secret_comparison_request"),
  request_id: opaqueRequestId,
  name: secretNameSchema,
  expected_revision: secretRevisionSchema.nullable(),
});
const secretComparisonErrorSchema = z.strictObject({
  code: z.enum(ERROR_CODES),
  message: z.string(),
});
export const secretComparisonResponseSchema = z.discriminatedUnion("ok", [
  z.strictObject({
    type: z.literal("secret_comparison_response"),
    request_id: opaqueRequestId,
    name: secretNameSchema,
    ok: z.literal(true),
    compare: setSecretCompareSchema,
  }),
  z.strictObject({
    type: z.literal("secret_comparison_response"),
    request_id: opaqueRequestId,
    name: secretNameSchema,
    ok: z.literal(false),
    error: secretComparisonErrorSchema,
  }),
]);
const removeSecretInputSchema = z.strictObject({
  name: secretNameSchema,
});

// 사람 secret 관리는 secret_input 보호 입력에서만 시작한다.
export const setSecret = defineCommand({
  resource: "secrets",
  method: "set",
  name: "SetSecret",
  input: setSecretInputSchema,
  output: secretStatusSchema,
  compare: setSecretCompareSchema,
  actors: ["user"],
  errors: [
    "invalid_input",
    "unauthorized",
    "forbidden",
    "conflict",
    "unavailable",
  ],
  confirmation: "required",
  confirmation_kind: "secret_input",
  binding: ["name", "preparation"],
  display_read: "/secrets/list",
});
export const removeSecret = defineCommand({
  resource: "secrets",
  method: "remove",
  name: "RemoveSecret",
  input: removeSecretInputSchema,
  output: secretCleanupResultSchema,
  compare: secretCompareSchema,
  actors: ["user"],
  errors: ["unauthorized", "forbidden", "not_found", "conflict", "unavailable"],
  confirmation: "required",
  confirmation_kind: "secret_input",
  binding: ["name"],
  display_read: "/secrets/list",
});

const secretCleanupInputSchema = z.strictObject({
  name: secretNameSchema,
  revision: secretRevisionSchema,
});
const secretCleanupOutputSchema = withReadCommon(
  secretCleanupResultSchema,
);
const secretCleanup = defineRead({
  resource: "secrets",
  method: "cleanup",
  name: "SecretCleanup",
  input: secretCleanupInputSchema,
  output: secretCleanupOutputSchema,
  actors: ["user", "agent", "machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

const secretEventPayloadSchema = z.object({ name: secretNameSchema });
const secretSubjectSchema = z.string().regex(/^secret:[A-Za-z0-9_.:-]+$/);
export const secretSet = defineEvent("SecretSet", {
  subject: secretSubjectSchema,
  payload: secretEventPayloadSchema,
});
export const secretRemoved = defineEvent("SecretRemoved", {
  subject: secretSubjectSchema,
  payload: secretEventPayloadSchema,
});

// 일반 caller의 credential을 빌려 secret 경계를 넓히지 않는다.
export const secretAdapterContextSchema = authenticatedContextSchema.refine(
  (context) =>
    context.actor === "machine" &&
    context.conditions.process !== undefined &&
    context.conditions.task !== undefined,
  { message: "secret adapter requires a machine process and task" },
);
export const secretDestinationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("https"),
    origin: z.url().refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return url.protocol === "https:" && url.origin === value &&
        url.username === "" && url.password === "";
    }, { message: "destination must be a fixed HTTPS origin" }),
  }),
  // 같은 기계의 loopback 목적지(127.0.0.1, ::1, localhost)의 HTTP origin이다. 값이 이 기계 밖으로
  // 나가지 않는 로컬 model 서버(Ollama·LM Studio·llama.cpp)에 쓴다. HTTPS 목적지와 같은 취급이
  // 아니다: kind가 달라 서로 대신하지 못한다.
  z.strictObject({
    kind: z.literal("loopback_http"),
    origin: z.url().refine((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return url.protocol === "http:" && url.origin === value &&
        url.username === "" && url.password === "" &&
        ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
    }, { message: "destination must be a fixed loopback HTTP origin" }),
  }),
  z.strictObject({
    kind: z.literal("mcp"),
    server_connection: z.string().min(1),
    transport: z.literal("https"),
  }),
]);
export type SecretDestination = z.infer<typeof secretDestinationSchema>;

const useFields = {
  sealed_ref: secretOpaqueRefSchema,
  revision: secretRevisionSchema,
  purpose: secretPurposeSchema,
  destination: secretDestinationSchema,
};
export const secretUseSchema = z.strictObject(useFields);
export type SecretUse = z.infer<typeof secretUseSchema>;

// 원값은 JSON payload가 아니라 callback 메모리 인자다. pipe schema에는 없다.
export type SecretValue = Uint8Array | string;

// context는 caller 주장을 믿지 않는다. 신뢰한 supervisor가 주입하고,
// 현재 process·task·scope를 다시 검사한다.
const secretSendInputSchema = z.strictObject({
  context: secretAdapterContextSchema,
  use: secretUseSchema,
  operation: z.string().min(1),
  body: z.json(),
});
export type SecretSendInput = z.infer<typeof secretSendInputSchema>;
const secretSendOutputSchema = z.object({ sent: z.boolean() });
export type SecretSendOutput = z.infer<typeof secretSendOutputSchema>;

// 공개 HTTP route가 아니다. supervision worker envelope의 op로만 부른다.

export const SECRET_SEND_OP = "secret.send";

// 사람이 보호 입력창에 넣은 값이 core를 지나 I/O worker의 keychain adapter로 가는 유일한 HTTP
// 입구다. body는 값의 바이트이고 core는 해석·보관 없이 `secret.prepare`
// pipe로 흘려 보낸다. 입력 JSON에는 용도·owner·길이만 있고 값은 없다. 출력은 값 없는
// SecretPreparation이라 이어지는 SetSecret(또는 소유 concern command)이 그대로 쓴다.
export const SECRET_INPUT_MAX_BYTES = 64 * 1024;
const secretInput = defineUpload({
  resource: "secrets",
  method: "input",
  name: "secret.input",
  input: z.strictObject({
    purpose: secretPurposeSchema,
    owner: z.string().min(1),
    bytes: z.number().int().min(1).max(SECRET_INPUT_MAX_BYTES),
  }),
  output: secretPreparationSchema,
  actors: ["user"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
  max_bytes: SECRET_INPUT_MAX_BYTES,
});

// 다른 concern이 자기 ledger 표에 둔 secret 참조(MCP OAuth 등)를 core의 알려진 값
// registry에 등록하는 통로. 그 표는 소유 concern만
// 읽으므로 읽는 함수도 소유 concern이 낸다. 값은 이 모양 어디에도 없다.
export type SecretRefSource = {
  // 소유 concern. 이름 충돌을 막는 접두사다.
  owner: string;
  // 이 command가 확정되면 참조가 바뀌었을 수 있다. core가 응답 전에 알려진 값을 다시 맞춘다.
  commands: readonly string[];
  read(
    sql: Pick<Sql, "all">,
  ): Result<{ name: string; sealedRef: string }[]>;
};

export const SECRET_ROUTES = [
  listSecrets,
  setSecret,
  removeSecret,
  secretCleanup,
  secretInput,
] as const;
