import { err, ok, type Result } from "../../../base/mod.ts";
import type { ProviderRecord } from "../../../protocol/lophn-agent/mod.ts";
import type {
  SecretFileUse,
  SecretStorePort,
} from "../../../protocol/secrets/mod.ts";
import { type IssuerFetch, objectOf, positive, text } from "./oauth.ts";
import { loadProviderTokens, providerTokenNames } from "./oauth-secrets.ts";

// 구독 provider의 OAuth access token 갱신이다. agent runtime이 model 호출에 실을 token(`provider.<id>`)을 달라고
// 할 때 core가 값을 건네기 직전에 부른다(runtime-secret.ts의 providerOAuth hook). 만료가 lead보다 가까우면
// 발급자 요청 대기열로 refresh_token grant를 보내고 새 token을 저장한 뒤 credential의 만료를 올린다.
// - refresh token은 회전한다. 같은 token을 두 번 보내면 발급자가 둘 다 폐기하므로 provider마다 한 번에 하나만 돈다.
// - 회전한 refresh token을 먼저 저장한다. 잃으면 사람이 다시 로그인해야 한다.
// - 발급자가 grant를 거절하면(400·401, invalid_grant) credential을 revoked로 하고 token을 건네지 않는다.
// - 그 밖의 실패(발급자에 닿지 못함, 5xx, 이상한 응답)는 지금 token이 아직 살아 있으면 그대로 건넨다.
// token과 응답 본문은 오류·log에 싣지 않는다.

const ACCESS_DEFAULT_S = 3_600;
const ACCESS_NAME = /^provider\.([^.]+)$/;

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
  nowMs(): number;
  leadMs: number;
}): { prepareToken(use: SecretFileUse): Promise<Result<void> | undefined> } {
  const flights = new Map<string, Promise<Result<void>>>();

  async function refresh(provider: ProviderRecord): Promise<Result<void>> {
    const oauth = provider.definition.oauth;
    const stored = loadProviderTokens(deps.secrets, provider.id);
    if (oauth === null || !stored.ok) {
      return err({ code: "unavailable", message: "저장된 token이 없다" });
    }
    const clientId = oauth.product === "chatgpt"
      ? stored.value.meta.client_id
      : oauth.client_id;
    if (clientId === null) {
      return err({
        code: "unavailable",
        message: "저장된 token meta가 깨졌다",
      });
    }
    const fields: Record<string, string> = {
      grant_type: "refresh_token",
      refresh_token: stored.value.refresh,
      client_id: clientId,
      ...(oauth.product === "chatgpt" ? { resource: oauth.resource } : {}),
    };
    const still = (): Result<void> => {
      const expires = Date.parse(provider.credential.expires_at ?? "");
      return Number.isFinite(expires) && expires > deps.nowMs()
        ? ok(undefined)
        : err({ code: "unavailable", message: "token을 갱신하지 못했다" });
    };
    let status: number;
    let body: Record<string, unknown>;
    try {
      const response = await deps.http(oauth.token_endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          accept: "application/json",
        },
        body: new URLSearchParams(fields).toString(),
      });
      status = response.status;
      body = objectOf(await response.text());
    } catch {
      return still();
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
    const rotated = text(body["refresh_token"]);
    if (rotated !== null) {
      const put = await deps.secrets.put(names.refresh, rotated);
      if (!put.ok) {
        return err({ code: "unavailable", message: "token을 저장하지 못했다" });
      }
    }
    const put = await deps.secrets.put(names.access, access);
    if (!put.ok) {
      return err({ code: "unavailable", message: "token을 저장하지 못했다" });
    }
    const seconds = positive(body["expires_in"]) ?? ACCESS_DEFAULT_S;
    return await recordWithRetry(provider, {
      expires_at: new Date(deps.nowMs() + seconds * 1000).toISOString(),
    });
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
    async prepareToken(use) {
      const name = ACCESS_NAME.exec(use.name);
      if (name === null) return undefined;
      const read = await deps.readProvider(`pvd_${name[1]}`);
      if (!read.ok) return read;
      const provider = read.value;
      if (
        provider === null || provider.credential.kind !== "oauth" ||
        provider.credential.state === "revoked"
      ) return undefined;
      const expires = Date.parse(provider.credential.expires_at ?? "");
      if (Number.isFinite(expires) && expires - deps.nowMs() > deps.leadMs) {
        return undefined;
      }
      const running = flights.get(provider.id);
      if (running !== undefined) return await running;
      const flight = refresh(provider).finally(() =>
        flights.delete(provider.id)
      );
      flights.set(provider.id, flight);
      return await flight;
    },
  };
}
