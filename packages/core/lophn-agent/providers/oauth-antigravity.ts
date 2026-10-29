// Google Antigravity 구독 로그인의 발급자·control plane 요청이다. 세션(state·verifier·listener)은 oauth.ts가 쥔다.
// 1. authorize는 offline access와 consent를 요청한다.
// 2. 교환은 form POST이고 installed-app client pair를 싣는다. refresh token이 없으면 연결하지 않는다.
// 3. userinfo로 email을 채운다. 실패해도 이어 간다.
// 4. loadCodeAssist로 project를 찾는다. tier가 없으면 free-tier onboardUser를 보내고 operation을 30초 안에서 기다린다.
//    onboarding을 했든 안 했든 마지막 loadCodeAssist가 준 project만 저장한다. 다른 곳의 project를 대신 넣지 않는다.
// 5. 계정 model 목록은 fetchAvailableModels다(연결 뒤에 읽고 실패해도 연결은 남는다).
// control plane 주소는 provider endpoint다. 값(code·verifier·token)은 오류와 log에 싣지 않는다.

import process from "node:process";
import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  OAuthDefinition,
  ProviderAccount,
} from "../../../protocol/lophn-agent/mod.ts";
import { antigravityUserAgent } from "./adapters/cloud-code.ts";
import { joinEndpoint } from "./adapters/compat.ts";
import {
  type IssuerAnswer,
  type IssuerFetch,
  positive,
  postForm,
  postJson,
  recordOf,
  send,
  text,
} from "./issuer-http.ts";

export type AntigravityOAuth = Extract<
  OAuthDefinition,
  { product: "antigravity" }
>;

const METADATA = { ideType: "ANTIGRAVITY" };
const FREE_TIER = "free-tier";
const ONBOARD_MS = 30_000;
const ONBOARD_POLL_MS = 1_000;
const MODELS_MAX = 2000;
// operation 이름은 `/v1internal/` 뒤에 붙이는 상대 경로다. 다른 origin이나 위 경로로 가지 않는다.
const OPERATION_NAME = /^[A-Za-z0-9][A-Za-z0-9._\-/]*$/;

export function antigravityAuthorizeUrl(
  oauth: AntigravityOAuth,
  input: { redirectUri: string; state: string; challenge: string },
): string {
  const url = new URL(oauth.authorization_endpoint);
  for (const [key, value] of Object.entries({
    client_id: oauth.client_id,
    response_type: "code",
    redirect_uri: input.redirectUri,
    scope: oauth.scopes.join(" "),
    code_challenge: input.challenge,
    code_challenge_method: "S256",
    state: input.state,
    access_type: "offline",
    prompt: "consent",
  }))
    url.searchParams.set(key, value);
  return url.toString();
}

export async function antigravityExchange(
  http: IssuerFetch,
  oauth: AntigravityOAuth,
  input: {
    code: string;
    verifier: string;
    redirectUri: string;
    nowMs(): number;
  },
): Promise<Result<{ access: string; refresh: string; expires_at_ms: number }>> {
  const exchanged = await postForm(http, oauth.token_endpoint, {
    grant_type: "authorization_code",
    client_id: oauth.client_id,
    client_secret: oauth.client_secret,
    code: input.code,
    redirect_uri: input.redirectUri,
    code_verifier: input.verifier,
  });
  if (!exchanged.ok) return exchanged;
  if (exchanged.value.status !== 200) {
    return refused("발급자가 token 교환을 거절했다", "exchange_rejected");
  }
  const body = exchanged.value.body;
  const access = text(body["access_token"]);
  const seconds = positive(body["expires_in"]);
  const type = text(body["token_type"]);
  if (
    access === null ||
    seconds === null ||
    (type !== null && type.toLowerCase() !== "bearer")
  ) {
    return refused("token 응답이 모자라다", "exchange_rejected");
  }
  const refresh = text(body["refresh_token"]);
  // offline access를 요청했어도 refresh token이 늘 오지는 않는다. 없으면 오래 쓸 수 없어 다시 로그인해야 한다.
  if (refresh === null) {
    return err({
      code: "unauthorized",
      message: "refresh token을 받지 못했다. 다시 로그인해야 한다",
      details: { reason: "reauth_required" },
    });
  }
  return ok({
    access,
    refresh,
    expires_at_ms: input.nowMs() + seconds * 1000,
  });
}

function controlHeaders(access: string): Record<string, string> {
  return {
    authorization: `Bearer ${access}`,
    "user-agent": antigravityUserAgent(process.platform),
  };
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = recordOf(item);
        return record === null ? [] : [record];
      })
    : [];
}

// 검증 안내 주소는 https의 Google 주소만 사람에게 보인다. remote 글의 다른 주소로는 아무것도 보내지 않는다.
function validationUrl(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  try {
    const url = new URL(raw);
    const host = url.hostname;
    return url.protocol === "https:" &&
      (host === "google.com" || host.endsWith(".google.com"))
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}

// 로그인을 마친 access로 email과 Cloud Code project를 정한다.
export async function antigravityAccount(
  http: IssuerFetch,
  oauth: AntigravityOAuth,
  input: {
    endpoint: string;
    access: string;
    nowMs(): number;
    wait(ms: number): Promise<void>;
  },
): Promise<Result<ProviderAccount>> {
  const headers = controlHeaders(input.access);
  const userinfo = await send(http, oauth.userinfo_endpoint, {
    method: "GET",
    headers: { ...headers, accept: "application/json" },
  });
  const email =
    userinfo.ok && userinfo.value.status === 200
      ? text(userinfo.value.body["email"])
      : null;
  const load = (body: Record<string, unknown>) =>
    controlPost(http, input.endpoint, "loadCodeAssist", body, headers);

  const first = await load({ metadata: METADATA });
  if (!first.ok) return first;
  let loaded = first.value;
  const found = text(loaded["cloudaicompanionProject"]);
  if (
    found !== null &&
    (loaded["paidTier"] === undefined || loaded["paidTier"] === null)
  ) {
    const again = await load({
      cloudaicompanionProject: found,
      metadata: METADATA,
    });
    if (!again.ok) return again;
    loaded = again.value;
  }
  const allowed = records(loaded["allowedTiers"]).some(
    (tier) => tier["id"] === FREE_TIER,
  );
  if (!allowed) {
    const ineligible = records(loaded["ineligibleTiers"]).find(
      (tier) =>
        tier["tierId"] === FREE_TIER && text(tier["reasonMessage"]) !== null,
    );
    if (ineligible !== undefined) {
      const url = validationUrl(ineligible["validationUrl"]);
      return err({
        code: "forbidden",
        message: text(ineligible["reasonMessage"])!,
        details: {
          reason: "account_validation",
          ...(url === null ? {} : { validation_url: url }),
        },
      });
    }
  }
  if (recordOf(loaded["currentTier"]) === null) {
    const onboarded = await onboard(http, input, headers);
    if (!onboarded.ok) return onboarded;
  }
  const final = await load({ metadata: METADATA });
  if (!final.ok) return final;
  const project = text(final.value["cloudaicompanionProject"]);
  if (project === null) {
    return err({
      code: "unavailable",
      message: "Cloud Code project를 정하지 못했다",
      details: { reason: "project_missing" },
    });
  }
  return ok({
    id: null,
    email,
    organization_id: null,
    organization_name: null,
    project_id: project,
  });
}

async function controlPost(
  http: IssuerFetch,
  endpoint: string,
  method: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
): Promise<Result<Record<string, unknown>>> {
  const answer = await postJson(
    http,
    joinEndpoint(endpoint, `/v1internal:${method}`),
    body,
    headers,
  );
  return answerOf(answer);
}

function answerOf(
  answer: Result<IssuerAnswer>,
): Result<Record<string, unknown>> {
  if (!answer.ok) return answer;
  const { status, body } = answer.value;
  if (status === 200) return ok(body);
  if (status === 401) {
    return err({
      code: "unauthorized",
      message: "Google이 이 로그인을 받지 않았다",
      details: { reason: "reauth_required" },
    });
  }
  if (status === 403) {
    return refused("이 Google 계정은 Antigravity를 쓸 수 없다", "entitlement");
  }
  if (status === 429) {
    return err({
      code: "unavailable",
      message: "Google이 잠시 요청을 받지 않는다",
      details: { reason: "rate_limited" },
    });
  }
  return err({
    code: "unavailable",
    message: "Cloud Code 계정을 확인하지 못했다",
  });
}

// free-tier 계정을 만든다. operation이 끝날 때까지 기한 안에서 1초마다 본다.
async function onboard(
  http: IssuerFetch,
  input: { endpoint: string; nowMs(): number; wait(ms: number): Promise<void> },
  headers: Record<string, string>,
): Promise<Result<void>> {
  const deadline = input.nowMs() + ONBOARD_MS;
  const started = await controlPost(
    http,
    input.endpoint,
    "onboardUser",
    { tierId: FREE_TIER, metadata: METADATA },
    headers,
  );
  if (!started.ok) return started;
  let operation = started.value;
  while (operation["done"] !== true) {
    const name = text(operation["name"]);
    if (name === null || !OPERATION_NAME.test(name) || name.includes("..")) {
      return failedOnboarding();
    }
    if (input.nowMs() + ONBOARD_POLL_MS > deadline) return failedOnboarding();
    await input.wait(ONBOARD_POLL_MS);
    const polled = answerOf(
      await send(http, joinEndpoint(input.endpoint, `/v1internal/${name}`), {
        method: "GET",
        headers: { ...headers, accept: "application/json" },
      }),
    );
    if (!polled.ok) return polled;
    operation = polled.value;
  }
  if (
    operation["error"] !== undefined ||
    recordOf(operation["response"]) === null
  ) {
    return failedOnboarding();
  }
  return ok(undefined);
}

function failedOnboarding(): Result<never> {
  return err({
    code: "unavailable",
    message: "Antigravity 계정을 준비하지 못했다",
    details: { reason: "onboarding_failed" },
  });
}

// 계정 model 목록이다. map의 key가 요청에 싣는 model ID다. 내부용과 꺼진 줄은 고를 목록에서 뺀다.
// 실패하면 null이다(앞 목록이 남는다). 성공한 빈 목록도 기록할 수 없어 null로 돌아온다.
export async function readAntigravityModels(
  http: IssuerFetch,
  endpoint: string,
  project: string,
  access: string,
): Promise<string[] | null> {
  const answer = answerOf(
    await postJson(
      http,
      joinEndpoint(endpoint, "/v1internal:fetchAvailableModels"),
      { project },
      controlHeaders(access),
    ),
  );
  if (!answer.ok) return null;
  const models = recordOf(answer.value["models"]);
  if (models === null) return null;
  const names = Object.entries(models)
    .filter(([name, row]) => {
      const record = recordOf(row);
      return (
        name.trim() !== "" &&
        record !== null &&
        record["isInternal"] !== true &&
        record["disabled"] !== true
      );
    })
    .map(([name]) => name)
    .sort()
    .slice(0, MODELS_MAX);
  return names.length === 0 ? null : names;
}

export function antigravityRefreshRequest(
  oauth: AntigravityOAuth,
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
        client_secret: oauth.client_secret,
        refresh_token: refresh,
      }).toString(),
    },
  };
}

function refused(message: string, reason: string): Result<never> {
  return err({ code: "forbidden", message, details: { reason } });
}
