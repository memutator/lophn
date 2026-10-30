// ChatGPT 구독 로그인의 발급자 요청 모양이다. Codex CLI의 공개 client와 고정 loopback callback을 쓴다. 세션(state·verifier·
// listener)은 oauth.ts가 쥐고 여기는 authorize 주소, code 교환, 계정, refresh 요청만 둔다. 주소와 client 값은 provider
// 정의 data다. Codex client profile이고 OpenAI가 제3자에게 공개 보장한 OAuth API가 아니다.
// - 교환·refresh는 form POST다. client secret은 없다.
// - 계정 id(`chatgpt_account_id`)는 token의 claim에서 읽는다. Codex backend는 요청마다 이 값을 `chatgpt-account-id`로 받는다.
//   서명은 검사하지 않는다: 발급자에게 TLS로 직접 받은 token이고 이 값을 권한 판단에 쓰지 않는다.
// 값(code·verifier·token)은 오류와 log에 싣지 않는다.

import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  OAuthDefinition,
  ProviderAccount,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  type IssuerFetch,
  positive,
  postForm,
  recordOf,
  text,
} from "./issuer-http.ts";
import type { GrantedTokens } from "./oauth-claude.ts";

export type ChatGptOAuth = Extract<OAuthDefinition, { product: "chatgpt" }>;

const AUTH_CLAIM = "https://api.openai.com/auth";
const PROFILE_CLAIM = "https://api.openai.com/profile";
// Codex backend의 요청 header `originator`와 같은 값이다. 동의 화면과 ChatGPT의 연결 앱 목록에 보인다.
export const CODEX_ORIGINATOR = "lophn";

export function chatGptAuthorizeUrl(
  oauth: ChatGptOAuth,
  input: { redirectUri: string; state: string; challenge: string },
): string {
  const url = new URL(oauth.authorization_endpoint);
  for (const [key, value] of Object.entries({
    response_type: "code",
    client_id: oauth.client_id,
    redirect_uri: input.redirectUri,
    scope: oauth.scopes.join(" "),
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    state: input.state,
    id_token_add_organizations: "true",
    codex_cli_simplified_flow: "true",
    originator: CODEX_ORIGINATOR,
  }))
    url.searchParams.set(key, value);
  return url.toString();
}

export async function chatGptExchange(
  http: IssuerFetch,
  oauth: ChatGptOAuth,
  input: {
    code: string;
    verifier: string;
    redirectUri: string;
    nowMs(): number;
  },
): Promise<Result<GrantedTokens>> {
  const exchanged = await postForm(http, oauth.token_endpoint, {
    grant_type: "authorization_code",
    client_id: oauth.client_id,
    code: input.code,
    code_verifier: input.verifier,
    redirect_uri: input.redirectUri,
  });
  if (!exchanged.ok) return exchanged;
  if (exchanged.value.status !== 200) {
    return refused("발급자가 token 교환을 거절했다");
  }
  const body = exchanged.value.body;
  const access = text(body["access_token"]);
  const refresh = text(body["refresh_token"]);
  const seconds = positive(body["expires_in"]);
  if (access === null || refresh === null || seconds === null) {
    return refused("token 응답이 모자라다");
  }
  const account = chatGptAccount(access, text(body["id_token"]));
  if (account.id === null) return refused("token에 ChatGPT 계정이 없다");
  return ok({
    access,
    refresh,
    expires_at_ms: input.nowMs() + seconds * 1000,
    account,
  });
}

// access token과 id_token claim에서 계정을 읽는다. plan 종류는 id_token에만 있을 수 있다.
export function chatGptAccount(
  access: string,
  idToken: string | null,
): ProviderAccount {
  const claims = [
    claimsOf(access),
    idToken === null ? null : claimsOf(idToken),
  ];
  const pick = (claim: string, field: string): string | null => {
    for (const set of claims) {
      const value = text(recordOf(set?.[claim])?.[field]);
      if (value !== null) return value;
    }
    return null;
  };
  return {
    id: pick(AUTH_CLAIM, "chatgpt_account_id"),
    email: pick(PROFILE_CLAIM, "email")?.toLowerCase() ?? null,
    organization_id: null,
    organization_name: pick(AUTH_CLAIM, "chatgpt_plan_type"),
    project_id: null,
  };
}

export function chatGptRefreshRequest(
  oauth: ChatGptOAuth,
  refresh: string,
): { url: string; init: RequestInit } {
  return {
    url: oauth.token_endpoint,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: oauth.client_id,
        refresh_token: refresh,
      }).toString(),
    },
  };
}

// base64url payload를 읽는다. JSON이 utf-8이라 byte로 풀고 다시 글로 바꾼다.
function claimsOf(jwt: string): Record<string, unknown> | null {
  const payload = jwt.split(".")[1];
  if (payload === undefined) return null;
  try {
    const base64 =
      payload.replaceAll("-", "+").replaceAll("_", "/") +
      "=".repeat((4 - (payload.length % 4)) % 4);
    const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
    return recordOf(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}

function refused(message: string): Result<never> {
  return err({ code: "forbidden", message });
}
