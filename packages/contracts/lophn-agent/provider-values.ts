import { z } from "zod";
import {
  atSchema,
  idSchema,
  secretNameSchema,
  secretOpaqueRefSchema,
  secretRevisionSchema,
  sha256Schema,
} from "../platform/mod.ts";

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const positiveIntegerSchema = z.number().int().positive().max(
  Number.MAX_SAFE_INTEGER,
);
const nonnegativeIntegerSchema = z.number().int().nonnegative().max(
  Number.MAX_SAFE_INTEGER,
);

export const PROVIDER_PROTOCOLS = [
  "anthropic-messages",
  "openai-responses",
  "openai-chat-completions",
] as const;
export const providerProtocolSchema = z.enum(PROVIDER_PROTOCOLS);

export const PROVIDER_AUTH_KINDS = ["api_key", "oauth", "none"] as const;
export const providerAuthKindSchema = z.enum(PROVIDER_AUTH_KINDS);

// lead D31: OAuth는 ChatGPT와 SuperGrok만. Claude OAuth 자리는 두지 않는다.
export const OAUTH_PRODUCTS = ["chatgpt", "supergrok"] as const;
export const OAUTH_FLOWS = [
  "device_code",
  "device_code_then_pkce_paste_url",
] as const;

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isHttpsUrl(value: string): boolean {
  return isUrl(value) && new URL(value).protocol === "https:";
}

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function originOf(value: string): string | null {
  if (!isHttpsUrl(value)) return null;
  const url = new URL(value);
  return url.username || url.password ? null : url.origin;
}

const oauthFields = {
  product: z.enum(OAUTH_PRODUCTS),
  flow: z.enum(OAUTH_FLOWS),
  issuer: z.string(),
  authorization_endpoint: z.string(),
  token_endpoint: z.string(),
  allowed_call_origins: z.array(z.string()).min(1),
  scopes: z.array(nonblankSchema).min(1),
  verified_for_lophn: z.boolean(),
};

function oauthShape(value: {
  product: (typeof OAUTH_PRODUCTS)[number];
  flow: (typeof OAUTH_FLOWS)[number];
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  allowed_call_origins: readonly string[];
  scopes: readonly string[];
}): boolean {
  const flow = value.product === "chatgpt"
    ? "device_code_then_pkce_paste_url"
    : "device_code";
  return value.flow === flow &&
    [value.issuer, value.authorization_endpoint, value.token_endpoint].every(
      isHttpsUrl,
    ) && unique(value.allowed_call_origins) &&
    value.allowed_call_origins.every((origin) => originOf(origin) === origin) &&
    unique(value.scopes);
}

export const oauthDefinitionSchema = z.strictObject(oauthFields).refine(
  oauthShape,
  { message: "oauth definition does not match its verified product" },
);
export const oauthDefinitionOutputSchema = z.object(oauthFields).refine(
  oauthShape,
  { message: "oauth definition does not match its verified product" },
);
export type OAuthDefinition = z.infer<typeof oauthDefinitionSchema>;

const definitionFields = {
  key: nonblankSchema,
  display_name: nonblankSchema,
  protocols: z.array(providerProtocolSchema).min(1),
  auth_kinds: z.array(providerAuthKindSchema).min(1),
  models_endpoint: z.string().nullable(),
  oauth: oauthDefinitionSchema.nullable(),
  revision: nonblankSchema,
};

function definitionShape(value: {
  protocols: readonly string[];
  auth_kinds: readonly string[];
  models_endpoint: string | null;
  oauth: OAuthDefinition | null;
}): boolean {
  return unique(value.protocols) && unique(value.auth_kinds) &&
    (value.models_endpoint === null || isHttpsUrl(value.models_endpoint)) &&
    value.auth_kinds.includes("oauth") === (value.oauth !== null);
}

export const providerDefinitionSchema = z.strictObject(definitionFields).refine(
  definitionShape,
  { message: "provider definition auth and oauth do not agree" },
);
export const providerDefinitionOutputSchema = z.object({
  ...definitionFields,
  oauth: oauthDefinitionOutputSchema.nullable(),
}).refine(definitionShape, {
  message: "provider definition auth and oauth do not agree",
});
export type ProviderDefinition = z.infer<typeof providerDefinitionSchema>;

// secret 원값은 받지 않는다. platform secret 준비 handle과 참조만 받는다.
const secretRefFields = {
  name: secretNameSchema,
  sealed_ref: secretOpaqueRefSchema,
  revision: secretRevisionSchema,
};
export const providerSecretRefSchema = z.strictObject(secretRefFields);
export const providerSecretRefOutputSchema = z.object(secretRefFields);

export const PROVIDER_FAILURES = [
  "temporary",
  "credential_unavailable",
  "model_unavailable",
  "context_exceeded",
  "invalid_request",
  "unknown",
  "cancelled",
  "refused",
] as const;
export const providerFailureSchema = z.enum(PROVIDER_FAILURES);

const checkFields = {
  at: atSchema,
  credential_key: nonblankSchema,
  credential_revision: positiveIntegerSchema,
  model_name: nonblankSchema,
  test_kind: z.enum(["text", "tool_call"]),
  command_key: nonblankSchema,
  calls: z.array(idSchema("mcl")),
  result: z.enum(["success", "failure"]),
  code: providerFailureSchema.nullable(),
};

function checkShape(value: {
  calls: readonly string[];
  result: "success" | "failure";
  code: string | null;
}): boolean {
  return unique(value.calls) &&
    (value.result === "failure") === (value.code !== null);
}

export const providerCheckSchema = z.strictObject(checkFields).refine(
  checkShape,
  { message: "provider check result and failure code do not agree" },
);
export const providerCheckOutputSchema = z.object(checkFields).refine(
  checkShape,
  { message: "provider check result and failure code do not agree" },
);
export type ProviderCheck = z.infer<typeof providerCheckSchema>;

export const MODEL_BLOCK_REASONS = [
  "not_found",
  "retired",
  "account_model_access",
] as const;

const modelBlockFields = {
  model_name: nonblankSchema,
  reason: z.enum(MODEL_BLOCK_REASONS),
  until: atSchema.nullable(),
};
export const modelBlockSchema = z.strictObject(modelBlockFields);
export const modelBlockOutputSchema = z.object(modelBlockFields);
export type ModelBlock = z.infer<typeof modelBlockSchema>;

export const CREDENTIAL_STATES = [
  "available",
  "rejected",
  "usage_wait",
  "revoked",
] as const;
export const UNAVAILABLE_REASONS = [
  "authentication",
  "quota",
  "plan_access",
  "refresh_revoked",
] as const;

const credentialFields = {
  key: nonblankSchema,
  kind: providerAuthKindSchema,
  label: nonblankSchema,
  secret_ref: providerSecretRefSchema.nullable(),
  revision: positiveIntegerSchema,
  order: nonnegativeIntegerSchema,
  enabled: z.boolean(),
  account: nonblankSchema.nullable(),
  organization: nonblankSchema.nullable(),
  plan: nonblankSchema.nullable(),
  dedup_fingerprint: sha256Schema.nullable(),
  state: z.enum(CREDENTIAL_STATES),
  unavailable_reason: z.enum(UNAVAILABLE_REASONS).nullable(),
  until: atSchema.nullable(),
  expires_at: atSchema.nullable(),
  logged_in_at: atSchema.nullable(),
  refreshed_at: atSchema.nullable(),
  model_blocks: z.array(modelBlockSchema),
};

function credentialShape(value: {
  kind: (typeof PROVIDER_AUTH_KINDS)[number];
  secret_ref: unknown;
  state: (typeof CREDENTIAL_STATES)[number];
  unavailable_reason: string | null;
  until: string | null;
  model_blocks: readonly { model_name: string }[];
}): boolean {
  const secret = (value.kind === "none") === (value.secret_ref === null);
  const waiting = value.state === "usage_wait";
  const reason = value.state === "available"
    ? value.unavailable_reason === null
    : value.unavailable_reason !== null;
  return secret && reason && waiting === (value.until !== null) &&
    unique(value.model_blocks.map((block) => block.model_name));
}

export const providerCredentialSchema = z.strictObject(credentialFields).refine(
  credentialShape,
  { message: "credential state, secret and model blocks do not agree" },
);
export const providerCredentialOutputSchema = z.object({
  ...credentialFields,
  secret_ref: providerSecretRefOutputSchema.nullable(),
  model_blocks: z.array(modelBlockOutputSchema),
}).refine(credentialShape, {
  message: "credential state, secret and model blocks do not agree",
});
export type ProviderCredential = z.infer<typeof providerCredentialSchema>;

function loopback(value: string): boolean {
  if (!isUrl(value)) return false;
  const host = new URL(value).hostname;
  return host === "127.0.0.1" || host === "[::1]" || host === "localhost";
}

const providerFields = {
  id: idSchema("pvd"),
  name: nonblankSchema,
  definition: providerDefinitionSchema,
  endpoint: z.string(),
  protocol: providerProtocolSchema,
  enabled: z.boolean(),
  credentials: z.array(providerCredentialSchema),
  last_check: providerCheckSchema.nullable(),
  revision: positiveIntegerSchema,
};

function providerShape(value: {
  definition: ProviderDefinition;
  endpoint: string;
  protocol: (typeof PROVIDER_PROTOCOLS)[number];
  credentials: readonly ProviderCredential[];
}): boolean {
  const keys = value.credentials.map((credential) => credential.key);
  const orders = value.credentials.map((credential) =>
    String(credential.order)
  );
  const fingerprints = value.credentials.flatMap((credential) =>
    credential.dedup_fingerprint === null ? [] : [credential.dedup_fingerprint]
  );
  const remote = isHttpsUrl(value.endpoint);
  return value.definition.protocols.includes(value.protocol) &&
    (remote || loopback(value.endpoint)) &&
    (remote
      ? value.credentials.every((credential) => credential.kind !== "none")
      : true) &&
    unique(keys) && unique(orders) && unique(fingerprints);
}

export const providerRecordSchema = z.object({
  ...providerFields,
  definition: providerDefinitionOutputSchema,
  credentials: z.array(providerCredentialOutputSchema),
  last_check: providerCheckOutputSchema.nullable(),
}).refine(providerShape, {
  message: "provider endpoint, protocol and credentials do not agree",
});
export type ProviderRecord = z.infer<typeof providerRecordSchema>;

export const CONNECTION_TEST_TIMEOUT_MS = 30_000;
export const OAUTH_REFRESH_LEAD_MS = 60_000;
export const OAUTH_REFRESH_TIMEOUT_MS = 15_000;
export const USAGE_WAIT_DEFAULT_MS = 3_600_000;
export const ANTHROPIC_CACHE_TTL_MS = 300_000;
