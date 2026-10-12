// OAuth token 갱신. 만료 60초 전부터 한 machine 경계에서
// credential별로 잠그고(credential별 single-flight) secret을 다시 읽고 필요할 때만
// 최대 15초 갱신한다. 새 token 보관 성공 뒤에만 잠금을 풀고 사용하며 새 refresh
// token이 없으면 이전 것을 유지한다. 회전 refresh가 timeout·취소로 결과가 미상이면
// 이전 token을 다시 쓰지 않고 재로그인이 필요하다. OAuth 401은 갱신 한 번과 동일
// 요청 재전송 한 번으로만 복구하고 재차 401·폐기·재사용·계정 불일치는
// 다시 쓰지 않는다. IO(lock·secret·network·판 기록)는 port로 받는다.

import { err, ok, type Result } from "../../../base/mod.ts";
import {
  OAUTH_REFRESH_LEAD_MS,
  OAUTH_REFRESH_TIMEOUT_MS,
} from "../../../protocol/lophn-agent/mod.ts";

// 만료 60초 전부터 갱신한다. 이 시각(만료 - lead)에 도달하면 갱신 대상이다.
export function refreshDueAt(
  expiresAt: string | null,
  leadMs = OAUTH_REFRESH_LEAD_MS,
): string | null {
  if (expiresAt === null) return null;
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) return null;
  return new Date(ms - leadMs).toISOString();
}

export type OAuthRefreshBundle = {
  access_token: string;
  refresh_token: string | null;
  // 실제 만료의 ms epoch다.
  expires_at: number | null;
  issued_client_id: string | null;
  resource: string | null;
  subject: string | null;
};

// 만료 60초 전인지(또는 이미 만료인지) 본다. 만료를 모르면 갱신하지 않는다.
export function refreshDue(
  expiresAt: string | null,
  nowMs: number,
  leadMs = OAUTH_REFRESH_LEAD_MS,
): boolean {
  if (expiresAt === null) return false;
  const ms = Date.parse(expiresAt);
  if (Number.isNaN(ms)) return false;
  return nowMs >= ms - leadMs;
}

// R18: OAuth 401의 복구 예산은 갱신 한 번과 동일 요청 재전송 한 번이다. 재전송은
// 새 ModelCall로 남는다(run 한도에 센다).
export type UnauthorizedRetry = {
  refresh: boolean;
  retry: boolean;
  attempts: number;
};

export function unauthorizedRetry(input: {
  refreshTokened: boolean;
  retriedAfterRefresh: boolean;
}): UnauthorizedRetry {
  if (!input.refreshTokened) return { refresh: true, retry: true, attempts: 1 };
  if (!input.retriedAfterRefresh) {
    return { refresh: false, retry: true, attempts: 2 };
  }
  // 갱신과 재전송을 모두 썼다. 더 시도하지 않는다.
  return { refresh: false, retry: false, attempts: 2 };
}

export type OAuthRefreshPort = {
  // secret 재조회. 갱신 직전 credential의 현재 참조·판을 다시 읽는다.
  current(
    provider: string,
  ): Promise<
    Result<{
      sealed_ref: string;
      revision: number;
      expires_at: string | null;
      bundle: {
        access_token: string;
        refresh_token: string | null;
      };
    }>
  >;
  // token 갱신 요청이다(최대 15초). signal은 이 port를 부르는 쪽이 끊는다.
  network(
    input: {
      token_endpoint: string;
      refresh_token: string;
      client_id: string | null;
      resource: string | null;
    },
    signal: AbortSignal,
  ): Promise<
    Result<{
      access_token: string;
      refresh_token: string | null;
      expires_in: number | null;
    }>
  >;
  // 새 token 보관이다. 보관 실패는 새 token을 반환하지 않는다.
  save(
    provider: string,
    next: {
      bundle: {
        access_token: string;
        refresh_token: string | null;
      };
      expires_at: string;
      sealed_previous: { sealed_ref: string; revision: number };
    },
  ): Promise<
    Result<{ sealed_ref: string; revision: number; configured: true }>
  >;
};

export type OAuthRefreshOutcome =
  | { kind: "refreshed"; rotated: boolean }
  | { kind: "unchanged" }
  | { kind: "needs_login"; reason: string }
  | { kind: "uncertain"; reason: string };

// 만료 60초 전 갱신 판정. 만료를 모르면 갱신 대상이 아니다.
export type RefreshFacts = {
  provider: string;
  token_endpoint: string;
  client_id: string | null;
  resource: string | null;
};

export function createOAuthRefresher(deps: {
  port: OAuthRefreshPort;
  // machine 경계의 credential별 lock이다. provider당 credential이 하나라 lock key는 provider다.
  // 같은 credential의 갱신을 하나로 좁힌다. 두 프로세스가 같은 port로 같은 credential을 잠그면
  // network은 한 번이다.
  lock: {
    run<T>(key: string, next: () => Promise<T>): Promise<T>;
  };
  nowMs(): number;
  at: (ms: number) => string;
}): {
  refresh(
    facts: RefreshFacts,
    signal: AbortSignal,
  ): Promise<Result<OAuthRefreshOutcome>>;
} {
  return {
    async refresh(facts, signal) {
      // credential별 lock이다. 같은 credential의 동시 갱신은 하나로 좁혀진다.
      return await deps.lock.run(facts.provider, async () => {
        // secret을 다시 읽는다. 갱신 직전의 현재 참조·판이다.
        const current = await deps.port.current(facts.provider);
        if (!current.ok) return current;
        const held = current.value;
        if (
          held.expires_at === null || !refreshDue(held.expires_at, deps.nowMs())
        ) {
          return ok({ kind: "unchanged" } as OAuthRefreshOutcome);
        }
        if (held.bundle.refresh_token === null) {
          return ok({
            kind: "needs_login",
            reason: "refresh token is missing",
          } as OAuthRefreshOutcome);
        }
        // 최대 15초이다.
        const timeout = AbortSignal.any([
          signal,
          AbortSignal.timeout(OAUTH_REFRESH_TIMEOUT_MS),
        ]);
        const next = await deps.port.network(
          {
            token_endpoint: facts.token_endpoint,
            refresh_token: held.bundle.refresh_token,
            client_id: facts.client_id,
            resource: facts.resource,
          },
          timeout,
        );
        if (!next.ok) {
          if (timeout.aborted) {
            // 회전 refresh가 timeout·취소로 서버에 도달했을 수 있다. 이전 token을
            // 다시 쓰면 재사용 거절이 날 수 있으므로 재로그인이 필요하다.
            return ok({
              kind: "uncertain",
              reason: next.error.message,
            } as OAuthRefreshOutcome);
          }
          return next;
        }
        const expiresIn = next.value.expires_in;
        if (expiresIn === null || expiresIn <= 0) {
          return err({
            code: "unavailable",
            message: "refresh response has no expiry",
          });
        }
        // 새 token 보관이다. 성공 뒤에 잠금을 풀고 사용한다.
        const saved = await deps.port.save(facts.provider, {
          bundle: {
            access_token: next.value.access_token,
            // 새 refresh token이 없으면 이전 것을 유지한다.
            refresh_token: next.value.refresh_token ??
              held.bundle.refresh_token,
          },
          expires_at: deps.at(deps.nowMs() + expiresIn * 1000),
          sealed_previous: {
            sealed_ref: held.sealed_ref,
            revision: held.revision,
          },
        });
        if (!saved.ok) {
          // 보관 실패면 새 token으로 inference하지 않는다.
          return saved;
        }
        return ok({
          kind: "refreshed",
          rotated: next.value.refresh_token !== null &&
            next.value.refresh_token !== held.bundle.refresh_token,
        } as OAuthRefreshOutcome);
      });
    },
  };
}
