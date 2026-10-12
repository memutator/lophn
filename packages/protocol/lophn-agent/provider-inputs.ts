import { z } from "zod";
import { atSchema, durationMsSchema } from "../base/values.ts";
import { idSchema } from "../base/ids.ts";
import { secretPreparationInputSchema } from "../secrets/secrets.ts";
import {
  CREDENTIAL_STATES,
  modelBlockSchema,
  OAUTH_FLOWS,
  providerAuthKindSchema,
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

// Connect: provider와 그 credential 하나를 함께 받는다. secret 원값은 받지 않고 보호 입력이 보관한 뒤의
// 준비 증거만 받는다. 인증 없음(none)은 custom provider의 loopback 주소에만 있고 증거가 없다.
export const registerProviderInputSchema = z.strictObject({
  id: idSchema("pvd"),
  name: nonblankSchema,
  definition: providerDefinitionSchema,
  endpoint: z.string(),
  protocol: providerProtocolSchema,
  credential: z.strictObject({
    kind: providerAuthKindSchema,
    preparation: secretPreparationInputSchema.nullable(),
  }),
}).refine((value) => {
  const remote = isUrl(value.endpoint) &&
    new URL(value.endpoint).protocol === "https:";
  const { kind, preparation } = value.credential;
  return value.definition.protocols.includes(value.protocol) &&
    (remote || loopback(value.endpoint)) &&
    value.definition.auth_kinds.includes(kind) &&
    (!remote || kind !== "none") &&
    (kind === "none") === (preparation === null) &&
    (preparation === null ||
      (preparation.purpose === "provider_credential" &&
        preparation.owner === value.id));
}, {
  message:
    "endpoint, protocol or credential is outside the provider definition",
});

export const providerRevisionCompareSchema = z.strictObject({
  revision: positiveIntegerSchema,
});

// Disconnect: provider와 그 credential(secret)을 함께 지운다. 확인 창을 거친다.
export const disconnectProviderInputSchema = z.strictObject({
  provider: idSchema("pvd"),
});

export const refreshProviderCredentialInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  preparation: secretPreparationInputSchema.nullable(),
  expires_at: atSchema.nullable(),
  unavailable_reason: z.enum(["authentication", "refresh_revoked"]).nullable(),
}).refine(
  (value) =>
    (value.preparation === null) === (value.unavailable_reason !== null) &&
    (value.preparation === null ||
      (value.preparation.purpose === "provider_credential" &&
        value.preparation.owner === value.provider)),
  {
    message: "refresh stores a new reference or a safe unavailable state",
  },
);

export const recordProviderAvailabilityInputSchema = z.strictObject({
  provider: idSchema("pvd"),
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

export const providerReadInputSchema = z.strictObject({
  provider: idSchema("pvd"),
});
export const providerListInputSchema = z.strictObject({
  cursor: z.string().min(1).optional(),
});

export const providerRegisteredPayloadSchema = z.object({
  name: nonblankSchema,
  endpoint: z.string(),
  protocol: providerProtocolSchema,
  definition_revision: nonblankSchema,
  auth_kind: providerAuthKindSchema,
});
export const providerChangedPayloadSchema = z.object({
  revision: positiveIntegerSchema,
  credential_revision: positiveIntegerSchema,
  state: z.enum(CREDENTIAL_STATES),
});
export const providerDisconnectedPayloadSchema = z.object({
  definition_key: nonblankSchema,
});

// OAuth 로그인은 provider가 등록되기 전에 시작한다: Connect가 credential까지 받기 때문이다. 만들 provider의
// ID와 내장 정의 key를 받고, 정의는 core가 내장 목록에서 찾는다.
export const loginBeginInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  definition: nonblankSchema,
});
export const loginBeginOutputSchema = z.object({
  login: nonblankSchema,
  flow: z.enum(OAUTH_FLOWS),
  interval_ms: durationMsSchema,
  expires_at: atSchema,
  // 사람이 OS browser에서 열 공식 로그인 주소와 device code(shell이 이 단추로 연다).
  // 값 없는 안내라 secret이 아니다. 주소가 없으면 shell은 열 곳이 없다고 보인다.
  sign_in: z.object({
    url: z.string(),
    user_code: nonblankSchema.nullable(),
  }).optional(),
});

export const loginCompleteInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  login: nonblankSchema,
  submission: nonblankSchema,
});
export const loginCompleteOutputSchema = z.object({
  completed: z.literal(true),
});
export const loginCancelInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  login: nonblankSchema,
});
