import { z } from "zod";
import { atSchema, durationMsSchema } from "../base/values.ts";
import { idSchema } from "../base/ids.ts";
import { secretNameSchema } from "../secrets/secrets.ts";
import {
  CREDENTIAL_STATES,
  modelBlockSchema,
  OAUTH_FLOWS,
  providerAuthKindSchema,
  providerDefinitionSchema,
  providerProtocolSchema,
  providerRecordSchema,
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

const providerTargetFields = {
  name: nonblankSchema,
  definition: providerDefinitionSchema,
  endpoint: z.string(),
  protocol: providerProtocolSchema,
};

function targetFits(value: {
  definition: { protocols: readonly string[]; auth_kinds: readonly string[] };
  endpoint: string;
  protocol: string;
}, authKind: string): boolean {
  const remote = isUrl(value.endpoint) &&
    new URL(value.endpoint).protocol === "https:";
  return value.definition.protocols.includes(value.protocol) &&
    (remote || loopback(value.endpoint)) &&
    value.definition.auth_kinds.includes(authKind) &&
    (!remote || authKind !== "none");
}

// Connect: provider와 그 credential 하나를 함께 받는다. credential은 secret 이름 참조다: API key 값은 보호 입력 창을
// 거쳐 `secrets/put`으로 먼저 들어가 있고 여기에는 이름만 온다. OAuth는 core의 로그인 처리기가 token을 저장한 뒤
// 부르고 access token의 만료 시각을 같이 싣는다. 인증 없음(none)은 custom provider의 loopback 주소에만 있고
// credential이 null이다.
export const connectProviderInputSchema = z.strictObject({
  id: idSchema("pvd"),
  ...providerTargetFields,
  auth_kind: providerAuthKindSchema,
  credential: z.strictObject({ secret: secretNameSchema }).nullable(),
  expires_at: atSchema.optional(),
}).refine((value) =>
  targetFits(value, value.auth_kind) &&
  (value.auth_kind === "none") === (value.credential === null) &&
  (value.auth_kind === "oauth") === (value.expires_at !== undefined), {
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
  expires_at: atSchema.nullable(),
  unavailable_reason: z.enum(["authentication", "refresh_revoked"]).nullable(),
}).refine(
  (value) =>
    (value.expires_at === null) === (value.unavailable_reason !== null),
  { message: "refresh stores a new expiry or a safe unavailable state" },
);

export const recordProviderAccountModelsInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  models: z.array(nonblankSchema).min(1).max(2000),
});

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

// OAuth 로그인은 provider가 등록되기 전에 시작한다: 끝나면 core가 token을 저장하고 Connect까지 부르기 때문이다.
// 만들 provider의 ID와 Connect에 실을 정의·endpoint·protocol을 받는다. 발급자 주소는 정의 data다.
export const loginBeginInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  ...providerTargetFields,
}).refine(
  (value) => value.definition.oauth !== null && targetFits(value, "oauth"),
  { message: "the provider definition has no OAuth login for this endpoint" },
);
export const loginBeginOutputSchema = z.object({
  login: nonblankSchema,
  flow: z.enum(OAUTH_FLOWS),
  interval_ms: durationMsSchema,
  expires_at: atSchema,
  // 사람이 OS browser에서 열 공식 로그인 주소와 device code. 값 없는 안내라 secret이 아니다.
  sign_in: z.object({
    url: z.string(),
    user_code: nonblankSchema.nullable(),
  }),
});

// Complete는 기다리지 않는다. 한 번 보고 아직이면 pending과 다음에 부를 간격을, 끝났으면 연결된 provider를 낸다.
export const loginCompleteInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  login: nonblankSchema,
});
export const loginCompleteOutputSchema = z.discriminatedUnion("state", [
  z.object({ state: z.literal("pending"), interval_ms: durationMsSchema }),
  z.object({ state: z.literal("connected"), provider: providerRecordSchema }),
]);
export const loginCancelInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  login: nonblankSchema,
});
