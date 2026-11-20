import { z } from "zod";
import { atSchema, durationMsSchema } from "../base/values.ts";
import { idSchema } from "../base/ids.ts";
import { secretNameSchema } from "../secrets/secrets.ts";
import { CUSTOM_ID_SHAPE, customProtocolSchema } from "./custom-provider.ts";
import { ERROR_CODES } from "../../base/mod.ts";
import {
  CREDENTIAL_STATES,
  modelBlockSchema,
  OAUTH_CALLBACK_MODES,
  OAUTH_FLOWS,
  providerAccountSchema,
  providerAuthKindSchema,
  providerDefinitionSchema,
  providerProtocolSchema,
  providerRecordSchema,
  reportedModelLimitsSchema,
  UNAVAILABLE_REASONS,
} from "./provider-values.ts";

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const positiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

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

function targetFits(
  value: {
    definition: { protocols: readonly string[]; auth_kinds: readonly string[] };
    endpoint: string;
    protocol: string;
  },
  authKind: string,
): boolean {
  const remote =
    isUrl(value.endpoint) && new URL(value.endpoint).protocol === "https:";
  return (
    value.definition.protocols.includes(value.protocol) &&
    (remote || loopback(value.endpoint)) &&
    value.definition.auth_kinds.includes(authKind) &&
    (!remote || authKind !== "none")
  );
}

// Connect: provider와 그 credential 하나를 함께 받는다. credential은 secret 이름 참조다: API key 값은 보호 입력 창을
// 거쳐 `secrets/put`으로 먼저 들어가 있고 여기에는 이름만 온다. OAuth는 core의 로그인 처리기가 token을 저장한 뒤
// 부르고 access token의 만료 시각을 같이 싣는다. 인증 없음(none)은 custom provider의 loopback 주소에만 있고
// credential이 null이다.
export const connectProviderInputSchema = z
  .strictObject({
    id: idSchema("pvd"),
    ...providerTargetFields,
    auth_kind: providerAuthKindSchema,
    credential: z.strictObject({ secret: secretNameSchema }).nullable(),
    expires_at: atSchema.optional(),
    // 구독 로그인이 확정한 계정이다. core의 로그인 처리기만 싣는다.
    account: providerAccountSchema.optional(),
  })
  .refine(
    (value) =>
      targetFits(value, value.auth_kind) &&
      (value.auth_kind === "none") === (value.credential === null) &&
      (value.auth_kind === "oauth") === (value.expires_at !== undefined) &&
      (value.auth_kind === "oauth" || value.account === undefined),
    {
      message:
        "endpoint, protocol or credential is outside the provider definition",
    },
  );

export const providerRevisionCompareSchema = z.strictObject({
  revision: positiveIntegerSchema,
});

// Disconnect: provider와 그 credential(secret)을 함께 지운다. 확인 창을 거친다.
export const disconnectProviderInputSchema = z.strictObject({
  provider: idSchema("pvd"),
});

export const refreshProviderCredentialInputSchema = z
  .strictObject({
    provider: idSchema("pvd"),
    expires_at: atSchema.nullable(),
    unavailable_reason: z
      .enum(["authentication", "refresh_revoked"])
      .nullable(),
  })
  .refine(
    (value) =>
      (value.expires_at === null) === (value.unavailable_reason !== null),
    { message: "refresh stores a new expiry or a safe unavailable state" },
  );

export const recordProviderModelsInputSchema = z
  .strictObject({
    provider: idSchema("pvd"),
    models: z.array(nonblankSchema).min(1).max(2000),
    // 목록과 함께 읽은 model별 한도다. 없으면 앞서 저장한 한도를 지운다(목록처럼 통째로 바꾼다).
    model_limits: reportedModelLimitsSchema.optional(),
  })
  .refine(
    (value) =>
      Object.keys(value.model_limits ?? {}).every((name) =>
        value.models.includes(name),
      ),
    { message: "model limits name a model that the list does not report" },
  );

export const refreshProviderModelsInputSchema = z.strictObject({
  provider: idSchema("pvd"),
});

export const recordProviderAvailabilityInputSchema = z
  .strictObject({
    provider: idSchema("pvd"),
    state: z.enum(CREDENTIAL_STATES),
    unavailable_reason: z.enum(UNAVAILABLE_REASONS).nullable(),
    until: atSchema.nullable(),
    model_block: modelBlockSchema.nullable(),
  })
  .refine(
    (value) => {
      const waiting = value.state === "usage_wait";
      const reason =
        value.state === "available"
          ? value.unavailable_reason === null
          : value.unavailable_reason !== null;
      return reason && waiting === (value.until !== null);
    },
    { message: "availability state and until do not agree" },
  );

export const providerReadInputSchema = z.strictObject({
  provider: idSchema("pvd"),
});
export const providerListInputSchema = z.strictObject({
  cursor: z.string().min(1).optional(),
});

// 구독 로그인 하나의 대상이다. 로그인은 provider가 등록되기 전에 시작한다: 끝나면 core가 token을 저장하고 Connect까지 부르기
// 때문이다. 만들 provider의 ID와 Connect에 실을 정의·endpoint·protocol이다. 발급자 주소는 정의 data다. agent의 sign_in 요청
// view가 이 모양을 싣고, `providers/sign-in {request}`가 그 요청에서 읽는다.
export const providerSignInTargetSchema = z
  .strictObject({
    provider: idSchema("pvd"),
    ...providerTargetFields,
  })
  .refine(
    (value) => value.definition.oauth !== null && targetFits(value, "oauth"),
    { message: "the provider definition has no OAuth login for this endpoint" },
  );
export const providerSignInOutputSchema = z.object({
  provider: idSchema("pvd"),
  login: nonblankSchema,
  flow: z.enum(OAUTH_FLOWS),
  interval_ms: durationMsSchema,
  expires_at: atSchema,
  // 사람이 OS browser에서 열 공식 로그인 주소(auth_url)와 device code. 값 없는 안내라 secret이 아니다.
  sign_in: z.object({
    url: z.string(),
    user_code: nonblankSchema.nullable(),
  }),
  // remote_handoff면 발급자가 돌려보낼 loopback 주소(`redirect_uri`)다. 시작한 기기가 그 port를 듣거나, 사람이 돌아온 주소를
  // 붙여 넣어 `providers/sign-in-callback`으로 건넨다. 그 밖에는 null이다.
  callback_mode: z.enum(OAUTH_CALLBACK_MODES),
  redirect_uri: z.string().nullable(),
});

// 다른 기기가 사람이 돌아온 주소(전체 URL 또는 `code=...&state=...`)를 시작한 기계의 core에 건넨다.
export const providerSignInCallbackInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  login: nonblankSchema,
  callback_url: z.string().min(1).max(4096),
});

export const loginCancelInputSchema = z.strictObject({
  provider: idSchema("pvd"),
  login: nonblankSchema,
});

// 연결할 대상이다. 내장 정의 key이거나 사람이 만드는 Custom provider(key·이름·주소·API)다. id와 endpoint는 core가 정한다.
const customTargetSchema = z.strictObject({
  key: z.string().max(64).regex(CUSTOM_ID_SHAPE),
  name: z.string().max(100).regex(/\S/),
  base_url: z.string().min(1).max(300),
  protocol: customProtocolSchema,
});
export const providerConnectTargetSchema = z.union([
  z.strictObject({ definition: z.string().min(1).max(64) }),
  z.strictObject({ custom: customTargetSchema }),
]);
export type ProviderConnectTarget = z.infer<typeof providerConnectTargetSchema>;

export const connectLocalProviderInputSchema = z.strictObject({
  custom: customTargetSchema,
});

// 로그인 시작: 내장 정의 key이거나, agent의 sign_in 요청(core가 만든 id와 대상을 그 요청에서 읽는다).
export const providerSignInInputSchema = z.union([
  z.strictObject({ definition: z.string().min(1).max(64) }),
  z.strictObject({
    request: z.strictObject({
      session: idSchema("ses"),
      tool_call: idSchema("tcl"),
    }),
  }),
]);

// 로그인 하나의 상태다. 기다림은 core가 한다. 끝난 상태는 같은 정의로 새 로그인을 시작할 때까지 남는다.
export const providerSignInStateSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("waiting"),
    provider: idSchema("pvd"),
    flow: z.enum(OAUTH_FLOWS),
    expires_at: atSchema,
    sign_in: providerSignInOutputSchema.shape.sign_in,
    callback_mode: providerSignInOutputSchema.shape.callback_mode,
    redirect_uri: providerSignInOutputSchema.shape.redirect_uri,
  }),
  z.object({ state: z.literal("connected"), provider: idSchema("pvd") }),
  z.object({
    state: z.literal("failed"),
    provider: idSchema("pvd"),
    code: z.enum(ERROR_CODES),
  }),
  z.object({ state: z.literal("cancelled"), provider: idSchema("pvd") }),
]);
export type ProviderSignInState = z.infer<typeof providerSignInStateSchema>;
