import { z } from "zod";
import { defineMemory } from "../base/route.ts";
import { secretNameSchema } from "../secrets/secrets.ts";
import { appIdSchema } from "./channel-values.ts";

// 앱 선언의 secret.use oauth 블록(declaration/types.ts)으로 사람이 앱 OAuth 로그인을 하는 route다.
// 갱신 token·meta·client는 `app-oauth.` 이름 공간의 secret이고 core 밖으로 나가지 않는다.
// access token은 선언한 이름 그대로 두어 apps.secret_value가 앱 쪽으로 돌려준다.
export const APP_OAUTH_PREFIX = "app-oauth.";

export function appOAuthNames(name: string): {
  refresh: string;
  meta: string;
  // client secret. 보호된 입력 창이 넣는다.
  client: string;
  // client id. 글로 넣는다.
  client_id: string;
} {
  const base = `${APP_OAUTH_PREFIX}${name}`;
  return {
    refresh: `${base}.refresh`,
    meta: `${base}.meta`,
    client: `${base}.client`,
    client_id: `${base}.client_id`,
  };
}

// none: 로그인한 적 없거나 선언·client가 바뀌어 옛 token을 쓰지 않는다. in_progress: 사람이 browser에서
// 돌아오기를 기다린다. signed_in: 쓸 수 있는 token이 있다. failed: 마지막 시도나 refresh가 실패했고 reason이 이유다.
export const APP_OAUTH_STATES = [
  "none",
  "in_progress",
  "signed_in",
  "failed",
] as const;
// MCP의 McpAuthFailure와 같은 여섯 값이다. 화면이 같은 문구를 쓴다.
export const APP_OAUTH_FAILURES = [
  "callback_timeout",
  "state_mismatch",
  "exchange_failed",
  "refresh_rejected",
  "expired",
  "store_failed",
] as const;
// 값을 받을 수 없을 때 `apps.secret_value`가 앱 쪽으로 돌려주는 오류의 message. code는 `conflict`다.
export const APP_OAUTH_SIGN_IN_REQUIRED = "oauth sign-in required";

const target = { app: appIdSchema, name: secretNameSchema };

// 현재 선언에 이 이름의 oauth 블록이 없으면 forbidden 또는 not_found다.
export const appsOAuthClientSet = defineMemory({
  resource: "apps",
  method: "oauth_client_set",
  name: "apps.oauth_client_set",
  changes: [{ name: "secrets", id: (input) => input.name }],
  input: z.strictObject({
    ...target,
    client_id: z.string().regex(/^[^\s\p{Cc}]{1,200}$/u),
  }),
  output: z.strictObject({ stored: z.literal(true) }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "unavailable"],
});

export const appsOAuthBegin = defineMemory({
  resource: "apps",
  method: "oauth_begin",
  name: "apps.oauth_begin",
  changes: [{ name: "secrets", id: (input) => input.name }],
  input: z.strictObject(target),
  // 사람이 OS browser로 열 authorize URL이다. remote_handoff는 다른 기기가 시작한 로그인이다: 그 기기가 사람이 돌아온 주소를
  // `apps.oauth_callback`으로 건네고 redirect_uri는 발급자가 돌려보낼 loopback 주소다.
  output: z.strictObject({
    url: z.string(),
    callback_mode: z.enum(["local", "remote_handoff"]),
    redirect_uri: z.string(),
  }),
  actors: ["user"],
  errors: [
    "invalid_input",
    "forbidden",
    "not_found",
    "conflict",
    "unavailable",
  ],
});

// 다른 기기가 시작한 로그인의 callback 주소를 건넨다. 교환과 저장은 이 기계가 하고 결과는 oauth_state로 읽는다.
export const appsOAuthCallback = defineMemory({
  resource: "apps",
  method: "oauth_callback",
  name: "apps.oauth_callback",
  changes: [{ name: "secrets", id: (input) => input.name }],
  input: z.strictObject({
    ...target,
    callback_url: z.string().min(1).max(4096),
  }),
  output: z.strictObject({ accepted: z.literal(true) }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "not_found", "conflict"],
});

export const appsOAuthCancel = defineMemory({
  resource: "apps",
  method: "oauth_cancel",
  name: "apps.oauth_cancel",
  changes: [{ name: "secrets", id: (input) => input.name }],
  input: z.strictObject(target),
  output: z.strictObject({ cancelled: z.boolean() }),
  actors: ["user"],
  errors: ["invalid_input", "forbidden", "unavailable"],
});

// 보관한 token 셋(access·refresh·meta)을 지우고 진행 중인 시도·실패 기억을 버린다. client id와 client secret은 남는다.
export const appsOAuthSignOut = defineMemory({
  resource: "apps",
  method: "oauth_sign_out",
  name: "apps.oauth_sign_out",
  changes: [{ name: "secrets", id: (input) => input.name }],
  input: z.strictObject(target),
  output: z.strictObject({ signed_out: z.literal(true) }),
  actors: ["user"],
  errors: ["invalid_input", "unavailable"],
});

// 현재 release 선언에서 oauth 블록이 있는 secret.use마다 한 줄이다. token·client secret 값은 없다.
export const appsOAuthState = defineMemory({
  resource: "apps",
  method: "oauth_state",
  name: "apps.oauth_state",
  input: z.strictObject({ app: appIdSchema }),
  output: z.strictObject({
    secrets: z.array(
      z.strictObject({
        name: secretNameSchema,
        client_id: z.string().nullable(),
        client_secret_set: z.boolean(),
        state: z.enum(APP_OAUTH_STATES),
        // failed일 때만 값이 있다.
        reason: z.enum(APP_OAUTH_FAILURES).nullable(),
      }),
    ),
  }),
  reads: ["secrets"],
  actors: ["user"],
  errors: ["invalid_input", "not_found", "unavailable"],
});
