import { z } from "zod";
import type { Result } from "../../base/mod.ts";
import { withReadCommon } from "./envelope.ts";
import { defineEvent } from "./events.ts";
import { authenticatedContextSchema } from "./identity.ts";
import { defineCommand, defineRead, defineWorker } from "./route.ts";

export const SECRET_PURPOSES = [
  "app_secret",
  "provider_credential",
  "external_mcp_credential",
  "coding_connection_credential",
] as const;
export const secretPurposeSchema = z.enum(SECRET_PURPOSES);
export type SecretPurpose = z.infer<typeof secretPurposeSchema>;

// 이름은 event subject에도 들어가므로 공통 subject key의 문법을 유지한다.
export const secretNameSchema = z.string().regex(/^[A-Za-z0-9_.:-]+$/);
const opaqueRefSchema = z.string().min(1);
export const secretRevisionSchema = z.number().int().positive().max(
  Number.MAX_SAFE_INTEGER,
);

const preparationFields = {
  preparation: opaqueRefSchema,
  sealed_ref: opaqueRefSchema,
  purpose: secretPurposeSchema,
  owner: z.string().min(1),
};
export const secretPreparationSchema = z.object(preparationFields);
export type SecretPreparation = z.infer<typeof secretPreparationSchema>;
export const secretPreparationInputSchema = z.strictObject(preparationFields);

export const secretReferenceSchema = z.object({
  name: secretNameSchema,
  sealed_ref: opaqueRefSchema,
  revision: secretRevisionSchema,
});
export type SecretReference = z.infer<typeof secretReferenceSchema>;

export const secretStatusSchema = z.object({
  name: secretNameSchema,
  configured: z.boolean(),
  revision: secretRevisionSchema.nullable(),
}).refine((value) => value.configured === (value.revision !== null), {
  message: "configuration and revision must agree",
});
export type SecretStatus = z.infer<typeof secretStatusSchema>;

export const secretCleanupResultSchema = z.object({
  reference_blocked: z.boolean(),
  os_deleted: z.boolean(),
  processes_ended: z.boolean(),
});
export type SecretCleanupResult = z.infer<typeof secretCleanupResultSchema>;

export const listSecretsInputSchema = z.strictObject({
  names: z.array(secretNameSchema).optional(),
});
export const listSecretsOutputSchema = withReadCommon(z.object({
  secrets: z.array(secretStatusSchema),
}));
export const listSecrets = defineRead({
  resource: "secrets",
  method: "list",
  name: "ListSecrets",
  input: listSecretsInputSchema,
  output: listSecretsOutputSchema,
  actors: ["user", "coding_agent", "agent", "app", "machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

export const setSecretInputSchema = z.strictObject({
  name: secretNameSchema,
  preparation: secretPreparationInputSchema,
}).refine((value) =>
  value.preparation.purpose === "app_secret" &&
  value.preparation.owner === value.name, {
  message: "preparation must belong to the app secret name",
});
export const secretCompareSchema = z.strictObject({
  sealed_ref: opaqueRefSchema,
  revision: secretRevisionSchema,
});
export const setSecretCompareSchema = z.union([
  z.strictObject({ sealed_ref: z.null(), revision: z.null() }),
  secretCompareSchema,
]);
export const removeSecretInputSchema = z.strictObject({
  name: secretNameSchema,
});

// 사람 secret 관리는 secret_input 보호 입력에서만 시작한다(#27).
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
  display_read: "/v1/secrets/list",
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
  display_read: "/v1/secrets/list",
});

export const secretCleanupInputSchema = z.strictObject({
  name: secretNameSchema,
  revision: secretRevisionSchema,
});
export const secretCleanupOutputSchema = withReadCommon(
  secretCleanupResultSchema,
);
export const secretCleanup = defineRead({
  resource: "secrets",
  method: "cleanup",
  name: "SecretCleanup",
  input: secretCleanupInputSchema,
  output: secretCleanupOutputSchema,
  actors: ["user", "agent", "machine"],
  errors: ["invalid_input", "unauthorized", "forbidden", "unavailable"],
});

export const secretEventPayloadSchema = z.object({ name: secretNameSchema });
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
  z.strictObject({
    kind: z.literal("mcp"),
    server_connection: z.string().min(1),
    transport: z.literal("https"),
  }),
]);
export type SecretDestination = z.infer<typeof secretDestinationSchema>;

const useFields = {
  sealed_ref: opaqueRefSchema,
  revision: secretRevisionSchema,
  purpose: secretPurposeSchema,
  destination: secretDestinationSchema,
};
export const secretUseSchema = z.strictObject(useFields).refine(
  (use) => use.purpose !== "coding_connection_credential",
  { message: "coding connection credentials require the trusted loader" },
);
export type SecretUse = z.infer<typeof secretUseSchema>;

// 원값은 JSON payload가 아니라 callback 메모리 인자다. pipe schema에는 없다.
export type SecretValue = Uint8Array | string;

export const secretPrepareInputSchema = z.strictObject({
  context: secretAdapterContextSchema,
  purpose: secretPurposeSchema,
  owner: z.string().min(1),
});
export type SecretPrepareInput = z.infer<typeof secretPrepareInputSchema>;
export const secretSendInputSchema = z.strictObject({
  context: secretAdapterContextSchema,
  use: secretUseSchema,
  operation: z.string().min(1),
  body: z.json(),
});
export type SecretSendInput = z.infer<typeof secretSendInputSchema>;
export const secretSendOutputSchema = z.object({ sent: z.boolean() });
export type SecretSendOutput = z.infer<typeof secretSendOutputSchema>;

export const secretStoreRefreshInputSchema = z.strictObject({
  context: secretAdapterContextSchema,
  owner: z.string().min(1),
  ...useFields,
  purpose: z.enum(["provider_credential", "external_mcp_credential"]),
});
export type SecretStoreRefreshInput = z.infer<
  typeof secretStoreRefreshInputSchema
>;
export const secretStoreRefreshOutputSchema = z.object({
  sealed_ref: opaqueRefSchema,
  revision: secretRevisionSchema,
  configured: z.literal(true),
});
export type SecretStoreRefreshOutput = z.infer<
  typeof secretStoreRefreshOutputSchema
>;

export type SecretPrepareValueCallback = (
  value: SecretValue,
) => Promise<Result<SecretPreparation>>;
export type SecretSendValueCallback = (
  value: SecretValue,
) => Promise<Result<SecretSendOutput>>;
export type SecretStoreRefreshValueCallback = (
  value: SecretValue,
) => Promise<Result<SecretStoreRefreshOutput>>;

const pipeErrors = [
  "invalid_input",
  "unauthorized",
  "forbidden",
  "conflict",
  "unavailable",
] as const;

// 공개 HTTP route가 아니다. supervision worker envelope의 op로만 부른다.
export const SECRET_PREPARE_OP = "secret.prepare";
export const secretPrepare = defineWorker({
  resource: "secrets",
  method: "prepare",
  name: SECRET_PREPARE_OP,
  input: secretPrepareInputSchema,
  output: secretPreparationSchema,
  actors: ["machine"],
  errors: pipeErrors,
});

export const SECRET_SEND_OP = "secret.send";
export const secretSend = defineWorker({
  resource: "secrets",
  method: "send",
  name: SECRET_SEND_OP,
  input: secretSendInputSchema,
  output: secretSendOutputSchema,
  actors: ["machine"],
  errors: pipeErrors,
});

export const SECRET_STORE_REFRESH_OP = "secret.store-refresh";
export const secretStoreRefresh = defineWorker({
  resource: "secrets",
  method: "store-refresh",
  name: SECRET_STORE_REFRESH_OP,
  input: secretStoreRefreshInputSchema,
  output: secretStoreRefreshOutputSchema,
  actors: ["machine"],
  errors: pipeErrors,
});

export const SECRET_EXCHANGE_FORMAT = {
  format: 1,
  kdf: "Argon2id",
  memory_bytes: 64 * 1024 * 1024,
  iterations: 3,
  parallelism: 1,
  salt_bytes: 16,
  cipher: "AES-256-GCM",
  nonce_bytes: 12,
} as const;

export const SECRET_ROUTES = [
  listSecrets,
  setSecret,
  removeSecret,
  secretCleanup,
] as const;
export const SECRET_EVENTS = [secretSet, secretRemoved] as const;
export const SECRET_PIPE_OPS = [
  secretPrepare,
  secretSend,
  secretStoreRefresh,
] as const;
