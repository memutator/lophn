import { err, ok, type Result } from "../../../base/mod.ts";
import type {
  OAuthDefinition,
  ProviderRecord,
} from "../../../protocol/lophn-agent/mod.ts";
import type {
  SecretFileUse,
  SecretStorePort,
} from "../../../protocol/secrets/mod.ts";
import { type IssuerFetch, objectOf, positive, text } from "./issuer-http.ts";
import { chatGptRefreshRequest } from "./oauth-chatgpt.ts";
import { claudeRefreshRequest } from "./oauth-claude.ts";
import { antigravityRefreshRequest } from "./oauth-antigravity.ts";
import { loadProviderTokens, providerTokenNames } from "./oauth-secrets.ts";
import { readAccountModels, readsAccountModels } from "./reported-models.ts";

// 구독 provider의 OAuth access token 갱신이다. agent runtime이 model 호출에 실을 token(`provider.<id>`)을 달라고
// 할 때 core가 값을 건네기 직전에 부른다(runtime-secret.ts의 providerOAuth hook). 만료가 lead보다 가까우면
// 발급자 요청 대기열로 refresh_token grant를 보내고 새 token을 저장한 뒤 credential의 만료를 올린다.
// token을 바꾸는 곳은 이 core 하나다. inference·model 목록·quota가 따로 갱신하지 않는다.
// - refresh token은 회전한다. 같은 token을 두 번 보내면 발급자가 둘 다 폐기하므로 provider마다 한 번에 하나만 돈다.
// - 회전한 refresh token을 먼저 저장한다. 잃으면 사람이 다시 로그인해야 한다.
// - 발급자가 grant를 거절하면(400·401, invalid_grant) credential을 revoked로 하고 token을 건네지 않는다.
// - 그 밖의 실패(발급자에 닿지 못함, 5xx, 이상한 응답)는 지금 token이 아직 살아 있으면 그대로 건넨다.
// - lead는 실제 만료 5분 전 하나다. Claude Code는 응답 TTL에서 6분 앞을 갱신 시점으로 쓰지만 여기는 lead 하나로 줄였다.
// token과 응답 본문은 오류·log에 싣지 않는다.
// ChatGPT 계정의 model 목록은 token을 건넨 뒤에 읽는다(갱신 직후, 그리고 목록이 아직 없을 때). 읽는 데 발급자 대기열
// 기한(8초)까지 걸릴 수 있어 token을 기다리게 하지 않는다. 실패는 삼키고 앞서 저장한 목록은 남긴다.

const ACCESS_DEFAULT_S = 3_600;
const ACCESS_NAME = /^provider\.([^.]+)$/;
// 받은 token의 저장을 같은 값으로 다시 해 보는 횟수다.
const SAVE_ATTEMPTS = 3;

// product마다 refresh grant의 모양이 다르다.
function refreshRequestOf(
  oauth: OAuthDefinition,
  refresh: string,
): { url: string; init: RequestInit } {
  if (oauth.product === "chatgpt") {
    return chatGptRefreshRequest(oauth, refresh);
  }
  if (oauth.product === "claude") {
    return claudeRefreshRequest(oauth, refresh);
  }
  if (oauth.product === "antigravity") {
    return antigravityRefreshRequest(oauth, refresh);
  }
  const fields: Record<string, string> = {
    grant_type: "refresh_token",
    refresh_token: refresh,
    client_id: oauth.client_id,
  };
  return {
    url: oauth.token_endpoint,
    init: {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams(fields).toString(),
    },
  };
}

export type RefreshRecord =
  | { expires_at: string }
  | { unavailable_reason: "refresh_revoked" };

export function createProviderRefresher(deps: {
  readProvider(provider: string): Promise<Result<ProviderRecord | null>>;
  secrets: Pick<SecretStorePort, "get" | "put" | "delete">;
  http: IssuerFetch;
  // RefreshProviderCredential을 그 provider의 revision으로 부른다.
  record(
    provider: ProviderRecord,
    result: RefreshRecord,
  ): Promise<Result<unknown>>;
  // RecordProviderModels를 그 provider의 revision으로 부른다.
  recordModels(
    provider: ProviderRecord,
    models: string[],
  ): Promise<Result<unknown>>;
  nowMs(): number;
  leadMs: number;
}): {
  prepareToken(use: SecretFileUse): Promise<Result<void> | undefined>;
  // 뒤에서 도는 목록 읽기가 끝나기를 기다린다(test와 정지용).
  idle(): Promise<void>;
} {
  const flights = new Map<string, Promise<Result<void>>>();
  const reads = new Map<string, Promise<void>>();

  // provider마다 한 번에 하나만 돈다. 기다리지 않고 돌려보낸다.
  function readModelsLater(provider: ProviderRecord): void {
    const source = { ...provider, account: provider.credential.account };
    if (!readsAccountModels(source) || reads.has(provider.id)) return;
    const read = (async () => {
      const access = deps.secrets.get(providerTokenNames(provider.id).access);
      if (!access.ok) return;
      const models = await readAccountModels(deps.http, source, access.value);
      if (models === null) return;
      const latest = await deps.readProvider(provider.id);
      if (!latest.ok || latest.value === null) return;
      await deps.recordModels(latest.value, models);
    })()
      .catch(() => {})
      .finally(() => reads.delete(provider.id));
    reads.set(provider.id, read);
  }

  async function refresh(provider: ProviderRecord): Promise<Result<void>> {
    const oauth = provider.definition.oauth;
    const stored = loadProviderTokens(deps.secrets, provider.id);
    if (oauth === null || !stored.ok) {
      return err({ code: "unavailable", message: "저장된 token이 없다" });
    }
    const request = refreshRequestOf(oauth, stored.value.refresh);
    // Antigravity token은 계정 project와 함께여야 쓸 수 있다. project 없는 기록은 다시 로그인해야 한다.
    if (
      oauth.product === "antigravity" &&
      provider.credential.account?.project_id == null
    ) {
      return err({
        code: "unavailable",
        message: "저장된 계정에 project가 없다",
      });
    }
    const still = (): Result<void> => {
      const expires = Date.parse(provider.credential.expires_at ?? "");
      return Number.isFinite(expires) && expires > deps.nowMs()
        ? ok(undefined)
        : err({ code: "unavailable", message: "token을 갱신하지 못했다" });
    };
    let status: number;
    let body: Record<string, unknown>;
    try {
      const response = await deps.http(request.url, request.init);
      status = response.status;
      body = objectOf(await response.text());
    } catch {
      return still();
    }
    // 기다리는 동안 Disconnect하거나 다시 로그인했으면 늦은 답으로 지금 연결을 덮거나 지운 token을 되살리지 않는다.
    const latest = await deps.readProvider(provider.id);
    if (
      !latest.ok ||
      latest.value === null ||
      latest.value.credential.logged_in_at !== provider.credential.logged_in_at
    ) {
      return err({ code: "unavailable", message: "연결이 바뀌었다" });
    }
    if (status === 400 || status === 401 || body["error"] === "invalid_grant") {
      const revoked = await recordWithRetry(provider, {
        unavailable_reason: "refresh_revoked",
      });
      if (!revoked.ok) return revoked;
      return err({
        code: "forbidden",
        message: "구독 로그인이 끝났다. 다시 로그인해야 한다",
      });
    }
    const access = text(body["access_token"]);
    if (status !== 200 || access === null) return still();
    const names = providerTokenNames(provider.id);
    // 발급자가 refresh token을 새로 주지 않으면 지금 것을 그대로 쓴다. 새로 준 것은 저장이 잠깐 실패해도 같은 값으로
    // 다시 쓴다: 옛 refresh token은 이미 썼을 수 있어 다시 보내지 않는다.
    const rotated = text(body["refresh_token"]);
    if (rotated !== null) {
      const put = await putAgain(names.refresh, rotated);
      if (!put.ok) return put;
    }
    const put = await putAgain(names.access, access);
    if (!put.ok) return put;
    const seconds = positive(body["expires_in"]) ?? ACCESS_DEFAULT_S;
    return await recordWithRetry(provider, {
      expires_at: new Date(deps.nowMs() + seconds * 1000).toISOString(),
    });
  }

  async function putAgain(name: string, value: string): Promise<Result<void>> {
    for (let attempt = 0; attempt < SAVE_ATTEMPTS; attempt++) {
      const put = await deps.secrets.put(name, value);
      if (put.ok) return ok(undefined);
    }
    return err({ code: "unavailable", message: "token을 저장하지 못했다" });
  }

  // 읽은 뒤 provider revision이 바뀌었으면(다른 갱신, 상태 기록) 다시 읽어 한 번 더 기록한다.
  async function recordWithRetry(
    provider: ProviderRecord,
    result: RefreshRecord,
  ): Promise<Result<void>> {
    const first = await deps.record(provider, result);
    if (first.ok) return ok(undefined);
    if (first.error.code !== "conflict") return first;
    const again = await deps.readProvider(provider.id);
    if (!again.ok || again.value === null) {
      return err({
        code: "unavailable",
        message: "provider를 다시 읽지 못했다",
      });
    }
    const second = await deps.record(again.value, result);
    return second.ok ? ok(undefined) : second;
  }

  return {
    async idle() {
      await Promise.all([...reads.values()]);
    },
    async prepareToken(use) {
      const name = ACCESS_NAME.exec(use.name);
      if (name === null) return undefined;
      const read = await deps.readProvider(`pvd_${name[1]}`);
      if (!read.ok) return read;
      const provider = read.value;
      if (
        provider === null ||
        provider.credential.kind !== "oauth" ||
        provider.credential.state === "revoked"
      )
        return undefined;
      const expires = Date.parse(provider.credential.expires_at ?? "");
      if (Number.isFinite(expires) && expires - deps.nowMs() > deps.leadMs) {
        // 연결 직후 첫 읽기가 실패했으면 여기서 다시 읽는다.
        if (provider.credential.reported_models === null) {
          readModelsLater(provider);
        }
        return undefined;
      }
      const running = flights.get(provider.id);
      if (running !== undefined) return await running;
      const flight = refresh(provider).finally(() =>
        flights.delete(provider.id),
      );
      flights.set(provider.id, flight);
      const refreshed = await flight;
      if (refreshed.ok) readModelsLater(provider);
      return refreshed;
    },
  };
}
