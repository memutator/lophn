import { z } from "zod";
import {
  atSchema,
  durationMsSchema,
  idSchema,
  secretPreparationInputSchema,
  sha256Schema,
} from "../platform/mod.ts";
import {
  CONNECTION_TEST_TIMEOUT_MS,
  CREDENTIAL_STATES,
  modelBlockSchema,
  OAUTH_FLOWS,
  providerCheckOutputSchema,
  providerCheckSchema,
  providerDefinitionSchema,
  providerProtocolSchema,
  UNAVAILABLE_REASONS,
} from "./provider-values.ts";

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const positiveIntegerSchema = z.number().int().positive().max(
  Number.MAX_SAFE_INTEGER,
);
const nonnegativeIntegerSchema = z.number().int().nonnegative().max(
  Number.MAX_SAFE_INTEGER,
);

function unique(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function loopback(value: string): boolean {
  if (!isUrl(value)) return false;
  const host = new URL(value).hostname;
  return host === "127.0.0.1" || host === "[::1]" || host === "localhost";
}

export const registerProviderInputSchema = z.strictObject({
  id: idSchema("pvd"),
  name: nonblankSchema,
  definition: providerDefinitionSchema,
  endpoint: z.string(),
  protocol: providerProtocolSchema,
}).refine((value) => {
  const remote = isUrl(value.endpoint) &&
    new URL(value.endpoint).protocol === "https:";
  return value.definition.protocols.includes(value.protocol) &&
    (remote || loopback(value.endpoint));
}, { message: "endpoint or protocol is outside the provider definition" });

export const changeProviderInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  name: nonblankSchema.optional(),
  enabled: z.boolean().optional(),
}).refine((value) => value.name !== undefined || value.enabled !== undefined, {
  message: "provider change is empty",
});
export const providerRevisionCompareSchema = z.strictObject({
  revision: positiveIntegerSchema,
});

export const registerProviderCredentialInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  key: nonblankSchema,
  kind: z.enum(["api_key", "oauth"]),
  label: nonblankSchema,
  preparation: secretPreparationInputSchema,
  account: nonblankSchema.nullable(),
  organization: nonblankSchema.nullable(),
  plan: nonblankSchema.nullable(),
  dedup_fingerprint: sha256Schema,
}).refine((value) => value.preparation.purpose === "provider_credential", {
  message: "credential preparation must use the provider credential purpose",
});

const credentialChangeFields = {
  key: nonblankSchema,
  revision: positiveIntegerSchema,
  replacement: secretPreparationInputSchema.nullable(),
  enabled: z.boolean().optional(),
  order: nonnegativeIntegerSchema,
  revoke: z.boolean(),
};

export const changeProviderCredentialsInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  credentials: z.array(z.strictObject(credentialChangeFields)).min(1),
}).refine((value) => {
  const keys = value.credentials.map((credential) => credential.key);
  const orders = value.credentials.map((credential) =>
    String(credential.order)
  );
  return unique(keys) && unique(orders) &&
    value.credentials.every((credential) =>
      credential.replacement === null ||
      credential.replacement.purpose === "provider_credential"
    );
}, { message: "credential order or replacement is not exact" });

export const refreshProviderCredentialInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  key: nonblankSchema,
  preparation: secretPreparationInputSchema.nullable(),
  expires_at: atSchema.nullable(),
  unavailable_reason: z.enum(["authentication", "refresh_revoked"]).nullable(),
}).refine(
  (value) =>
    (value.preparation === null) === (value.unavailable_reason !== null) &&
    (value.preparation === null ||
      value.preparation.purpose === "provider_credential"),
  {
    message: "refresh stores a new reference or a safe unavailable state",
  },
);

export const recordProviderAvailabilityInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  key: nonblankSchema,
  state: z.enum(CREDENTIAL_STATES),
  unavailable_reason: z.enum(UNAVAILABLE_REASONS).nullable(),
  until: atSchema.nullable(),
  model_block: modelBlockSchema.nullable(),
}).refine((value) => {
  const waiting = value.state === "usage_wait";
  const reason = value.state === "available"
    ? value.unavailable_reason === null
    : value.unavailable_reason !== null;
  return reason && waiting === (value.until !== null);
}, { message: "availability state and until do not agree" });

export const recordProviderCheckInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  check: providerCheckSchema,
});

export const providerReadInputSchema = z.strictObject({
  provider: idSchema("pvd"),
});
export const providerListInputSchema = z.strictObject({
  cursor: z.string().min(1).optional(),
});
export const providerCredentialListInputSchema = z.strictObject({
  provider: idSchema("pvd"),
});

export const providerRegisteredPayloadSchema = z.object({
  name: nonblankSchema,
  endpoint: z.string(),
  protocol: providerProtocolSchema,
  definition_revision: nonblankSchema,
});
export const providerChangedPayloadSchema = z.object({
  revision: positiveIntegerSchema,
  credential_key: nonblankSchema.nullable(),
  credential_revision: positiveIntegerSchema.nullable(),
  state: z.enum(CREDENTIAL_STATES).nullable(),
});
export const providerCheckedPayloadSchema = providerCheckOutputSchema;

export const loginBeginInputSchema = z.strictObject({
  provider: idSchema("pvd"),
});
export const loginBeginOutputSchema = z.object({
  login: nonblankSchema,
  flow: z.enum(OAUTH_FLOWS),
  interval_ms: durationMsSchema,
  expires_at: atSchema,
});

export const loginCompleteInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  login: nonblankSchema,
  submission: nonblankSchema,
});
export const loginCancelInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  login: nonblankSchema,
});

export const connectionTestInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  credential_key: nonblankSchema,
  model_name: nonblankSchema,
  test_kind: z.enum(["text", "tool_call"]),
  command_key: nonblankSchema,
});
export const connectionTestOutputSchema = z.object({
  check: providerCheckOutputSchema.nullable(),
  timeout_ms: z.literal(CONNECTION_TEST_TIMEOUT_MS),
});
