import { err, ok, type Result } from "../../../base/mod.ts";
import {
  CATALOG_REFRESH_INTERVAL_MS,
  type OAuthDefinition,
  type ProviderCredential,
  type ProviderRecord,
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
import {
  readProviderModels,
  readsModels,
  type ReportedModelRoster,
} from "./reported-models.ts";

// 구독 provider의 OAuth access token 갱신이다. agent runtime이 model 호출에 실을 token(`provider.<id>`)을 달라고
// 할 때 core가 값을 건네기 직전에 부른다(runtime-secret.ts의 providerOAuth hook). 만료가 lead보다 가까우면
// 발급자 요청 대기열로 refresh_token grant를 보내고 새 token을 저장한 뒤 credential의 만료를 올린다.
// token을 바꾸는 곳은 이 core 하나다. inference·model 목록·quota가 따로 갱신하지 않는다.
// - refresh token은 회전한다. 같은 token을 두 번 보내면 발급자가 둘 다 폐기하므로 provider마다 한 번에 하나만 돈다.
// - 회전한 refresh token을 먼저 저장한다. 잃으면 사람이 다시 로그인해야 한다.
// - 발급자가 grant를 거절했다고 확인되면(오류 code가 invalid_grant·invalid_client·unauthorized_client) credential을
//   revoked로 하고 token을 건네지 않는다.
// - 그 밖의 실패(발급자에 닿지 못함, 5xx, WAF·proxy의 JSON 아닌 400·401, 이상한 응답)는 지금 token이 아직 살아 있으면
//   그대로 건넨다.
// - 요청 중 401을 받은 runtime은 force로 다시 부른다. force는 만료 lead를 건너뛰고 갱신한다.
// - lead는 실제 만료 5분 전 하나다. Claude Code는 응답 TTL에서 6분 앞을 갱신 시점으로 쓰지만 여기는 lead 하나로 줄였다.
// token과 응답 본문은 오류·log에 싣지 않는다.
// provider의 model 목록(구독 계정과 내장 API key provider)은 token이나 key를 건넨 뒤에 읽는다: 갱신 직후,
// 이 process에서 처음 쓸 때, 마지막으로 읽기 시작한 뒤 catalog 주기가 지났을 때. provider가 새 model을 열면 쓰는 동안 따라온다.
// 읽는 데 발급자 대기열 기한(8초)까지 걸릴 수 있어 token을 기다리게 하지 않는다. 실패는 삼키고 앞서 저장한 목록은 남긴다.

const ACCESS_DEFAULT_S = 3_600;
const ACCESS_NAME = /^provider\.([^.]+)$/;
// 받은 token의 저장을 같은 값으로 다시 해 보는 횟수다.
const SAVE_ATTEMPTS = 3;
// 발급자가 grant를 거절했다고 보는 OAuth 2.0 token endpoint 오류 code다. 나머지는 일시 실패로 본다.
const GRANT_REFUSED = [
  "invalid_grant",
  "invalid_client",
  "unauthorized_client",
];

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
  listProviders?: () => Promise<Result<readonly ProviderRecord[]>>;
  secrets: Pick<SecretStorePort, "get" | "put" | "delete">;
  http: IssuerFetch;
  // RefreshProviderCredential을 그 provider의 revision으로 부른다.
  record(
    provider: ProviderRecord,
    result: RefreshRecord,
    credentialId?: string,
  ): Promise<Result<unknown>>;
  // RecordProviderModels를 그 provider의 revision으로 부른다.
  recordModels(
    provider: ProviderRecord,
    roster: ReportedModelRoster,
    credentialId?: string,
  ): Promise<Result<unknown>>;
  nowMs(): number;
  leadMs: number;
}): {
  // force면 만료가 멀어도 갱신한다(요청이 401을 받았을 때).
  prepareToken(
    use: SecretFileUse,
    options?: { force?: boolean },
  ): Promise<Result<void> | undefined>;
  // 뒤에서 도는 목록 읽기가 끝나기를 기다린다(test와 정지용).
  idle(): Promise<void>;
} {
  const flights = new Map<string, Promise<Result<void>>>();
  const reads = new Map<string, Promise<void>>();
  // 회전해서 받았지만 저장하지 못한 refresh token이다. 옛 것은 이미 써서 이것이 유일한 살아 있는 token이라 메모리에
  // 두고 다음 갱신이 먼저 쓴다. 다시 로그인했으면(logged_in_at이 다르면) 버린다. log·오류에 싣지 않는다.
  const unsaved = new Map<
    string,
    { token: string; loggedInAt: string | null }
  >();
  // credential마다 마지막으로 읽기를 시작한 때다. 기동하면 비어 있어 처음 쓸 때 한 번 읽는다.
  const readAt = new Map<string, number>();

  function readModelsWhenStale(
    provider: ProviderRecord,
    credential: ProviderCredential,
  ): void {
    const at = readAt.get(credential.id);
    // 읽기가 실패해도 주기를 기다린다. 목록을 못 읽는 provider에서 model 호출마다 다시 읽지 않는다.
    if (at === undefined || deps.nowMs() - at >= CATALOG_REFRESH_INTERVAL_MS) {
      readModelsLater(provider, credential);
    }
  }

  // credential마다 한 번에 하나만 돈다. 기다리지 않고 돌려보낸다.
  function readModelsLater(
    provider: ProviderRecord,
    credential: ProviderCredential,
  ): void {
    const source = {
      ...provider,
      kind: credential.kind,
      account: credential.account,
    };
    if (!readsModels(source) || reads.has(credential.id)) return;
    readAt.set(credential.id, deps.nowMs());
    const read = (async () => {
      const secretName =
        credential.secret_ref?.name ?? providerTokenNames(credential.id).access;
      const access = deps.secrets.get(secretName);
      if (!access.ok) return;
      const roster = await readProviderModels(deps.http, source, access.value);
      if (roster === null) return;
      const latest = await deps.readProvider(provider.id);
      if (!latest.ok || latest.value === null) return;
      await deps.recordModels(latest.value, roster, credential.id);
    })()
      .catch(() => {})
      .finally(() => reads.delete(credential.id));
    reads.set(credential.id, read);
  }

  async function refresh(
    provider: ProviderRecord,
    credential: ProviderCredential,
  ): Promise<Result<void>> {
    const oauth = provider.definition.oauth;
    const stored = loadProviderTokens(deps.secrets, credential.id);
    if (oauth === null || !stored.ok) {
      return err({ code: "unavailable", message: "저장된 token이 없다" });
    }
    const names = providerTokenNames(credential.id);
    let refreshToken = stored.value.refresh;
    const kept = unsaved.get(credential.id);
    if (kept !== undefined) {
      if (kept.loggedInAt !== credential.logged_in_at) {
        unsaved.delete(credential.id);
      } else {
        refreshToken = kept.token;
        if ((await putAgain(names.refresh, kept.token)).ok) {
          unsaved.delete(credential.id);
        }
      }
    }
    const request = refreshRequestOf(oauth, refreshToken);
    // Antigravity token은 계정 project와 함께여야 쓸 수 있다. project 없는 기록은 다시 로그인해야 한다.
    if (
      oauth.product === "antigravity" &&
      credential.account?.project_id == null
    ) {
      return err({
        code: "unavailable",
        message: "저장된 계정에 project가 없다",
      });
    }
    const still = (): Result<void> => {
      const expires = Date.parse(credential.expires_at ?? "");
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
    // 기다리는 동안 Disconnect·삭제하거나 다시 로그인했으면 늦은 답으로 지금 연결을 덮거나 지운 token을 되살리지 않는다.
    const latest = await deps.readProvider(provider.id);
    const latestCred = latest.ok
      ? latest.value?.credentials.find((item) => item.id === credential.id)
      : undefined;
    if (
      !latest.ok ||
      latest.value === null ||
      latestCred === undefined ||
      latestCred.logged_in_at !== credential.logged_in_at
    ) {
      return err({ code: "unavailable", message: "연결이 바뀌었다" });
    }
    if (GRANT_REFUSED.includes(text(body["error"]) ?? "")) {
      unsaved.delete(credential.id);
      const revoked = await recordWithRetry(latest.value, credential.id, {
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
    // 발급자가 refresh token을 새로 주지 않으면 지금 것을 그대로 쓴다. 새로 준 것은 저장이 잠깐 실패해도 같은 값으로
    // 다시 쓴다: 옛 refresh token은 이미 썼을 수 있어 다시 보내지 않는다.
    const rotated = text(body["refresh_token"]);
    if (rotated !== null) {
      const put = await putAgain(names.refresh, rotated);
      if (!put.ok) {
        unsaved.set(credential.id, {
          token: rotated,
          loggedInAt: credential.logged_in_at,
        });
        return put;
      }
      unsaved.delete(credential.id);
    }
    const put = await putAgain(names.access, access);
    if (!put.ok) return put;
    const seconds = positive(body["expires_in"]) ?? ACCESS_DEFAULT_S;
    return await recordWithRetry(latest.value, credential.id, {
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
    credentialId: string,
    result: RefreshRecord,
  ): Promise<Result<void>> {
    const first = await deps.record(provider, result, credentialId);
    if (first.ok) return ok(undefined);
    if (first.error.code !== "conflict") return first;
    const again = await deps.readProvider(provider.id);
    if (!again.ok || again.value === null) {
      return err({
        code: "unavailable",
        message: "provider를 다시 읽지 못했다",
      });
    }
    const second = await deps.record(again.value, result, credentialId);
    return second.ok ? ok(undefined) : second;
  }

  async function findBySecret(
    secretName: string,
    suffix: string,
  ): Promise<
    Result<{ provider: ProviderRecord; credential: ProviderCredential } | null>
  > {
    if (deps.listProviders !== undefined) {
      const listed = await deps.listProviders();
      if (!listed.ok) return listed;
      for (const provider of listed.value) {
        const match = provider.credentials.find(
          (item) => item.secret_ref?.name === secretName,
        );
        if (match !== undefined) {
          return ok({ provider, credential: match });
        }
      }
      return ok(null);
    }
    const read = await deps.readProvider(`pvd_${suffix.replace(/^crd_/, "")}`);
    if (!read.ok) return read;
    if (read.value === null) return ok(null);
    const match =
      read.value.credentials.find(
        (item) => item.secret_ref?.name === secretName,
      ) ?? read.value.credential;
    return ok({ provider: read.value, credential: match });
  }

  return {
    async idle() {
      await Promise.all([...reads.values()]);
    },
    async prepareToken(use, options) {
      const name = ACCESS_NAME.exec(use.name);
      if (name === null) return undefined;
      const found = await findBySecret(use.name, name[1]!);
      if (!found.ok) return found;
      if (found.value === null) return undefined;
      const { provider, credential } = found.value;
      if (credential.kind === "api_key") {
        readModelsWhenStale(provider, credential);
        return undefined;
      }
      if (credential.kind !== "oauth" || credential.state === "revoked")
        return undefined;
      const expires = Date.parse(credential.expires_at ?? "");
      if (
        options?.force !== true &&
        Number.isFinite(expires) &&
        expires - deps.nowMs() > deps.leadMs
      ) {
        readModelsWhenStale(provider, credential);
        return undefined;
      }
      const running = flights.get(credential.id);
      if (running !== undefined) return await running;
      const flight = refresh(provider, credential).finally(() =>
        flights.delete(credential.id),
      );
      flights.set(credential.id, flight);
      const refreshed = await flight;
      if (refreshed.ok) readModelsLater(provider, credential);
      return refreshed;
    },
  };
}
