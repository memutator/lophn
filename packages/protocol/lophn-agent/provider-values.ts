import { z } from "zod";
import { atSchema } from "../base/values.ts";
import { idSchema } from "../base/ids.ts";
import { secretNameSchema } from "../secrets/secrets.ts";

const nonblankSchema = z.string().refine((value) => value.trim().length > 0, {
  message: "expected nonblank text",
});
const positiveIntegerSchema = z
  .number()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);

export const PROVIDER_PROTOCOLS = [
  "anthropic-messages",
  "openai-responses",
  "openai-chat-completions",
  // Google Cloud Code Assist의 `v1internal:streamGenerateContent`다. Antigravity 구독 계정만 쓴다.
  "cloud-code-assist",
  // Gemini API의 `models/<model>:streamGenerateContent`다. 지금은 OpenCode Go gateway의 Gemini model만 쓴다.
  "gemini-generate-content",
] as const;
export const providerProtocolSchema = z.enum(PROVIDER_PROTOCOLS);
export type ProviderProtocol = (typeof PROVIDER_PROTOCOLS)[number];

const PROVIDER_AUTH_KINDS = ["api_key", "oauth", "none"] as const;
export const providerAuthKindSchema = z.enum(PROVIDER_AUTH_KINDS);

// 구독 OAuth product다. product가 flow를 정한다.
// - chatgpt: Codex CLI의 ChatGPT 로그인(고정 client, PKCE + 고정 loopback `localhost:1455/auth/callback`). 이 token은
//   Codex backend(`chatgpt.com/backend-api/codex`)로 보낸다. OpenAI 공식 Sign in with ChatGPT가 아니다.
// - supergrok: device code.
// - claude: Claude account의 PKCE + 고정 loopback callback. Anthropic 공식 문서는 제3자 앱의 Claude.ai 로그인과
//   구독 credential 사용을 허락하지 않는다. 사람이 그 위험을 알고 고른 연결이다.
// - antigravity: Google account의 PKCE + 고정 loopback callback. 로그인 끝에 Cloud Code Assist project를 확정한다.
//   여기서 쓰는 `v1internal` API는 Google이 제3자 API로 공개 보장한 것이 아니다.
export const OAUTH_FLOWS = ["pkce_loopback", "device_code"] as const;
export type OAuthFlow = (typeof OAUTH_FLOWS)[number];
// 로그인이 돌아오는 길이다. local은 이 기계의 browser가 loopback으로 돌려보낸다. remote_handoff는 다른 기기가 시작해서 그
// 기기가 사람이 돌아온 주소를 `providers/sign-in-callback`으로 건넨다(device code는 돌아올 주소가 없어 local이다).
export const OAUTH_CALLBACK_MODES = ["local", "remote_handoff"] as const;

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

// 발급자 주소는 정의 data다. loopback http는 fake 발급자(test, 개발)만 쓴다.
const issuerUrlSchema = z
  .string()
  .refine((value) => isHttpsUrl(value) || loopback(value), {
    message: "expected an https or loopback url",
  });
const scopesSchema = z.array(nonblankSchema).min(1).refine(unique, {
  message: "scopes repeat",
});

// 발급자에 등록된 callback 주소라 port와 path까지 고정이다. browser를 열기 전에 이 port로 듣는다.
const redirectUriSchema = z
  .string()
  .refine(
    (value) =>
      loopback(value) &&
      new URL(value).protocol === "http:" &&
      new URL(value).port !== "",
    { message: "expected a loopback http url with a port" },
  );
const chatgptFields = {
  product: z.literal("chatgpt"),
  client_id: nonblankSchema,
  authorization_endpoint: issuerUrlSchema,
  token_endpoint: issuerUrlSchema,
  redirect_uri: redirectUriSchema,
  // 이 로그인으로 연결하면 provider endpoint가 이 주소다(API key 연결은 정의의 models_endpoint 쪽 그대로).
  inference_endpoint: issuerUrlSchema,
  scopes: scopesSchema,
};
const supergrokFields = {
  product: z.literal("supergrok"),
  client_id: nonblankSchema,
  device_authorization_endpoint: issuerUrlSchema,
  token_endpoint: issuerUrlSchema,
  scopes: scopesSchema,
};
const claudeFields = {
  product: z.literal("claude"),
  client_id: nonblankSchema,
  authorization_endpoint: issuerUrlSchema,
  token_endpoint: issuerUrlSchema,
  // token 응답에 계정·조직이 빠졌을 때 채우는 곳이다.
  account_endpoint: issuerUrlSchema,
  redirect_uri: redirectUriSchema,
  scopes: scopesSchema,
};
// installed-app client라 client_secret은 공개 배포된 값이다. 사람의 비밀이 아니다.
const antigravityFields = {
  product: z.literal("antigravity"),
  client_id: nonblankSchema,
  client_secret: nonblankSchema,
  authorization_endpoint: issuerUrlSchema,
  token_endpoint: issuerUrlSchema,
  userinfo_endpoint: issuerUrlSchema,
  redirect_uri: redirectUriSchema,
  scopes: scopesSchema,
};

const oauthDefinitionSchema = z.discriminatedUnion("product", [
  z.strictObject(chatgptFields),
  z.strictObject(supergrokFields),
  z.strictObject(claudeFields),
  z.strictObject(antigravityFields),
]);
const oauthDefinitionOutputSchema = z.discriminatedUnion("product", [
  z.object(chatgptFields),
  z.object(supergrokFields),
  z.object(claudeFields),
  z.object(antigravityFields),
]);
export type OAuthDefinition = z.infer<typeof oauthDefinitionSchema>;

// device code는 어느 browser에서나 끝난다. loopback은 core가 있는 기계의 browser로 돌아와야 한다(화면이 가린다).
export function oauthFlowOf(product: OAuthDefinition["product"]): OAuthFlow {
  return product === "supergrok" ? "device_code" : "pkce_loopback";
}

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
  return (
    unique(value.protocols) &&
    unique(value.auth_kinds) &&
    (value.models_endpoint === null || isHttpsUrl(value.models_endpoint)) &&
    value.auth_kinds.includes("oauth") === (value.oauth !== null)
  );
}

export const providerDefinitionSchema = z
  .strictObject(definitionFields)
  .refine(definitionShape, {
    message: "provider definition auth and oauth do not agree",
  });
export const providerDefinitionOutputSchema = z
  .object({
    ...definitionFields,
    oauth: oauthDefinitionOutputSchema.nullable(),
  })
  .refine(definitionShape, {
    message: "provider definition auth and oauth do not agree",
  });
export type ProviderDefinition = z.infer<typeof providerDefinitionSchema>;

// secret 원값은 받지 않는다. 파일 저장소(secrets.json)의 이름이 곧 key라 이름만 담는다.
const secretRefFields = {
  name: secretNameSchema,
};
const providerSecretRefSchema = z.strictObject(secretRefFields);
const providerSecretRefOutputSchema = z.object(secretRefFields);

export const PROVIDER_FAILURES = [
  "temporary",
  "credential_unavailable",
  "model_unavailable",
  "context_exceeded",
  "invalid_request",
  "image_rejected",
  "unknown",
  "cancelled",
  "refused",
] as const;
export const providerFailureSchema = z.enum(PROVIDER_FAILURES);

const MODEL_BLOCK_REASONS = [
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
const modelBlockOutputSchema = z.object(modelBlockFields);

// provider가 model 목록과 함께 알려 준 model별 token 한도다. 값은 그 model에 실제로 보낼 수 있는 수이고,
// provider가 밝히지 않은 칸은 null이다. catalog의 값이 아니라 그 계정이 보고한 값이다.
const reportedModelLimitFields = {
  context_limit: positiveIntegerSchema,
  max_context_limit: positiveIntegerSchema.nullable(),
  output_limit: positiveIntegerSchema.nullable(),
};
export const reportedModelLimitSchema = z.strictObject(
  reportedModelLimitFields,
);
export const reportedModelLimitsSchema = z.record(
  nonblankSchema,
  reportedModelLimitSchema,
);
export type ReportedModelLimits = z.infer<typeof reportedModelLimitsSchema>;

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

// 구독 로그인이 확정한 계정이다. 비밀이 아니다. 화면의 계정 표시와 provider가 요구하는 요청 metadata(Claude의
// account, Google의 project)에 쓴다. 모르는 칸은 null이다.
const providerAccountFields = {
  id: nonblankSchema.nullable(),
  email: nonblankSchema.nullable(),
  organization_id: nonblankSchema.nullable(),
  organization_name: nonblankSchema.nullable(),
  project_id: nonblankSchema.nullable(),
};
export const providerAccountSchema = z.strictObject(providerAccountFields);
const providerAccountOutputSchema = z.object(providerAccountFields);
export type ProviderAccount = z.infer<typeof providerAccountSchema>;

const credentialFields = {
  id: idSchema("crd"),
  active: z.boolean(),
  kind: providerAuthKindSchema,
  secret_ref: providerSecretRefSchema.nullable(),
  label: nonblankSchema.nullable(),
  // API key 마스킹 힌트(예: sk-…a1b2). 원문이 아니며 api_key 연결에만 있다.
  key_hint: nonblankSchema.nullable(),
  revision: positiveIntegerSchema,
  state: z.enum(CREDENTIAL_STATES),
  unavailable_reason: z.enum(UNAVAILABLE_REASONS).nullable(),
  until: atSchema.nullable(),
  expires_at: atSchema.nullable(),
  logged_in_at: atSchema.nullable(),
  refreshed_at: atSchema.nullable(),
  model_blocks: z.array(modelBlockSchema),
  // ChatGPT 계정이 쓸 수 있는 model 이름이다. null은 아직 못 읽었다는 뜻이고 그때는 거르지 않는다.
  reported_models: z.array(nonblankSchema).nullable(),
  // 목록과 함께 받은 model별 token 한도다. 없으면 provider가 밝히지 않았다는 뜻이다.
  reported_model_limits: reportedModelLimitsSchema.optional(),
  // 구독 OAuth 연결에만 있다.
  account: providerAccountSchema.nullable(),
};

function credentialShape(value: {
  kind: (typeof PROVIDER_AUTH_KINDS)[number];
  secret_ref: unknown;
  key_hint: string | null;
  state: (typeof CREDENTIAL_STATES)[number];
  unavailable_reason: string | null;
  until: string | null;
  model_blocks: readonly { model_name: string }[];
  account: unknown;
}): boolean {
  const secret = (value.kind === "none") === (value.secret_ref === null);
  const account = value.kind === "oauth" || value.account === null;
  const keyHint = value.kind === "api_key" || value.key_hint === null;
  const waiting = value.state === "usage_wait";
  const reason =
    value.state === "available"
      ? value.unavailable_reason === null
      : value.unavailable_reason !== null;
  return (
    secret &&
    account &&
    keyHint &&
    reason &&
    waiting === (value.until !== null) &&
    unique(value.model_blocks.map((block) => block.model_name))
  );
}

export const providerCredentialSchema = z
  .strictObject(credentialFields)
  .refine(credentialShape, {
    message: "credential state, secret and model blocks do not agree",
  });
const providerCredentialOutputSchema = z
  .object({
    ...credentialFields,
    secret_ref: providerSecretRefOutputSchema.nullable(),
    model_blocks: z.array(modelBlockOutputSchema),
    account: providerAccountOutputSchema.nullable(),
  })
  .refine(credentialShape, {
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
  // 현재 활성(active) credential 하나.
  credential: providerCredentialSchema,
  // 이 provider에 등록된 모든 credential 목록(최소 1개, 그중 정확히 1개가 active).
  credentials: z.array(providerCredentialSchema).min(1),
  revision: positiveIntegerSchema,
};

function providerShape(value: {
  definition: ProviderDefinition;
  endpoint: string;
  protocol: (typeof PROVIDER_PROTOCOLS)[number];
  credential: ProviderCredential;
  credentials: readonly ProviderCredential[];
}): boolean {
  const remote = isHttpsUrl(value.endpoint);
  const active = value.credentials.filter((item) => item.active);
  return (
    value.definition.protocols.includes(value.protocol) &&
    (remote || loopback(value.endpoint)) &&
    active.length === 1 &&
    value.credential.active &&
    active[0]!.id === value.credential.id &&
    unique(value.credentials.map((item) => item.id)) &&
    value.credentials.every(
      (item) =>
        value.definition.auth_kinds.includes(item.kind) &&
        (!remote || item.kind !== "none"),
    )
  );
}

export const providerRecordSchema = z
  .object({
    ...providerFields,
    definition: providerDefinitionOutputSchema,
    credential: providerCredentialOutputSchema,
    credentials: z.array(providerCredentialOutputSchema).min(1),
  })
  .refine(providerShape, {
    message: "provider endpoint, protocol and credential do not agree",
  });
export type ProviderRecord = z.infer<typeof providerRecordSchema>;

export const OAUTH_REFRESH_LEAD_MS = 5 * 60_000;
export const USAGE_WAIT_DEFAULT_MS = 3_600_000;
