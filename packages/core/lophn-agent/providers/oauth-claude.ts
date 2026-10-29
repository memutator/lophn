// Claude account 구독 로그인의 발급자 요청 모양이다. 세션(state·verifier·listener)은 oauth.ts가 쥐고 여기는 authorize
// 주소, code 교환, 계정 보충, refresh 요청만 둔다. 주소와 client 값은 provider 정의 data다. header 값은 Claude Code
// client profile이고 Anthropic이 공개 보장한 OAuth API가 아니다.
// - 교환은 JSON POST다. client secret은 없다. callback에서 받은 state를 같이 싣는다.
// - token 응답에 계정·조직이 빠지면 account_endpoint로 빈 칸만 채운다. 실패해도 로그인은 이어 간다.
// - refresh는 같은 token endpoint에 JSON POST하고 OAuth beta와 SDK User-Agent를 붙인다.
// 값(code·verifier·token)은 오류와 log에 싣지 않는다.

import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  OAuthDefinition,
  ProviderAccount,
} from "../../../protocol/lophn-agent/mod.ts";
import {
  CLAUDE_CLI_VERSION,
  CLAUDE_OAUTH_BETA,
  CLAUDE_SDK_VERSION,
} from "./adapters/claude-code.ts";
import {
  type IssuerFetch,
  positive,
  postJson,
  recordOf,
  send,
  text,
} from "./issuer-http.ts";

export type ClaudeOAuth = Extract<OAuthDefinition, { product: "claude" }>;

export type GrantedTokens = {
  access: string;
  refresh: string;
  expires_at_ms: number;
  account: ProviderAccount;
};

export function claudeAuthorizeUrl(
  oauth: ClaudeOAuth,
  input: { redirectUri: string; state: string; challenge: string },
): string {
  const url = new URL(oauth.authorization_endpoint);
  for (const [key, value] of Object.entries({
    code: "true",
    client_id: oauth.client_id,
    response_type: "code",
    redirect_uri: input.redirectUri,
    scope: oauth.scopes.join(" "),
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    state: input.state,
  }))
    url.searchParams.set(key, value);
  return url.toString();
}

export async function claudeExchange(
  http: IssuerFetch,
  oauth: ClaudeOAuth,
  input: {
    code: string;
    verifier: string;
    state: string;
    redirectUri: string;
    nowMs(): number;
  },
): Promise<Result<GrantedTokens>> {
  const exchanged = await postJson(http, oauth.token_endpoint, {
    grant_type: "authorization_code",
    client_id: oauth.client_id,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
    state: input.state,
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
  const expiresAtMs = input.nowMs() + seconds * 1000;
  const person = recordOf(body["account"]);
  const organization = recordOf(body["organization"]);
  const account: ProviderAccount = {
    id: text(person?.["uuid"]),
    email: text(person?.["email_address"]),
    organization_id: text(organization?.["uuid"]),
    organization_name: text(organization?.["name"]),
    project_id: null,
  };
  const filled =
    account.id === null ||
    account.email === null ||
    account.organization_id === null
      ? await withAccountLookup(http, oauth.account_endpoint, access, account)
      : account;
  return ok({ access, refresh, expires_at_ms: expiresAtMs, account: filled });
}

// token 응답에서 이미 받은 값은 덮지 않는다. 어떤 실패든 받은 값 그대로 돌려준다.
async function withAccountLookup(
  http: IssuerFetch,
  endpoint: string,
  access: string,
  account: ProviderAccount,
): Promise<ProviderAccount> {
  const read = await send(http, endpoint, {
    method: "GET",
    headers: {
      authorization: `Bearer ${access}`,
      accept: "application/json, text/plain, */*",
      "content-type": "application/json",
      "user-agent": `claude-code/${CLAUDE_CLI_VERSION}`,
      "anthropic-beta": CLAUDE_OAUTH_BETA,
    },
  });
  if (!read.ok || read.value.status !== 200) return account;
  const found = recordOf(read.value.body["oauth_account"]);
  if (found === null) return account;
  return {
    id: account.id ?? text(found["account_uuid"]),
    email: account.email ?? text(found["account_email"]),
    organization_id:
      account.organization_id ?? text(found["organization_uuid"]),
    organization_name:
      account.organization_name ?? text(found["organization_name"]),
    project_id: null,
  };
}

export function claudeRefreshRequest(
  oauth: ClaudeOAuth,
  refresh: string,
): { url: string; init: RequestInit } {
  return {
    url: oauth.token_endpoint,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
        "anthropic-beta": CLAUDE_OAUTH_BETA,
        "user-agent": `anthropic-sdk-typescript/${CLAUDE_SDK_VERSION} userOAuthProvider`,
      },
      body: JSON.stringify({
        grant_type: "refresh_token",
        client_id: oauth.client_id,
        refresh_token: refresh,
      }),
    },
  };
}

function refused(message: string): Result<never> {
  return err({ code: "forbidden", message });
}
