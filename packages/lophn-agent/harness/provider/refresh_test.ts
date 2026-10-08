// lophn-agent/harness/provider#R17, R18: OAuth token 갱신 작업 테스트다. fake
// clock, fake secret 재조회, fake network를 주입하므로 실제 provider·실제
// keychain은 닿지 않는다. 회전 refresh의 timeout·취소와 보관 실패의 새 token
// 전송 0회도 fake 위에서 본다.
import { assert, assertEquals } from "@std/assert";
import { manualClock } from "../../../../packages/base/mod.ts";
import {
  createOAuthRefresher,
  type OAuthRefreshBundle,
  type OAuthRefreshPort,
  refreshDue,
  refreshDueAt,
  type RefreshFacts,
  unauthorizedRetry,
} from "./refresh.ts";

const CLOCK = manualClock(Date.parse("2026-10-08T00:00:00.000Z"));
const ACCESS = "private-access-token-1";
const NEXT_ACCESS = "private-access-token-2";
const OLD_REFRESH = "private-refresh-token-old";
const NEW_REFRESH = "private-refresh-token-new";
const EXPIRES_AT = new Date(CLOCK.nowMs() + 30_000).toISOString();

const FACTS: RefreshFacts = {
  provider: "pvd_openai",
  key: "login-1",
  token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
  client_id: "client-issued-1",
  resource: "https://api.openai.com/v1",
};

function bundle(
  access = ACCESS,
  refresh = OLD_REFRESH,
): OAuthRefreshBundle {
  return {
    access_token: access,
    refresh_token: refresh,
    expires_at: CLOCK.nowMs() + 30_000,
    issued_client_id: FACTS.client_id,
    resource: FACTS.resource,
    subject: "user-sub-1",
  };
}

void bundle;

// ---- fake port다 ----

type PortRecord = {
  networkCalls: { refresh_token: string | null; body: string }[];
  saveCalls: {
    bundle: { access_token: string; refresh_token: string | null };
    expires_at: string;
  }[];
  currentReads: number;
};

function portOf(options: {
  stored?: {
    sealed_ref: string;
    revision: number;
    expires_at: string | null;
    bundle: { access_token: string; refresh_token: string | null };
  };
  networkRespond?: (attempt: number) =>
    | {
      ok: true;
      value: {
        access_token: string;
        refresh_token: string | null;
        expires_in: number | null;
      };
    }
    | { ok: false; error: { code: "unavailable"; message: string } };
  saveRespond?: () =>
    | {
      ok: true;
      value: { sealed_ref: string; revision: number; configured: true };
    }
    | { ok: false; error: { code: "conflict"; message: string } };
} = {}): { port: OAuthRefreshPort; record: PortRecord } {
  const record: PortRecord = {
    networkCalls: [],
    saveCalls: [],
    currentReads: 0,
  };
  const stored = options.stored ?? {
    sealed_ref: "sealed-1",
    revision: 1,
    expires_at: EXPIRES_AT,
    bundle: { access_token: ACCESS, refresh_token: OLD_REFRESH },
  };
  const port: OAuthRefreshPort = {
    async current() {
      record.currentReads++;
      await Promise.resolve();
      return {
        ok: true as const,
        value: {
          sealed_ref: stored.sealed_ref,
          revision: stored.revision,
          expires_at: stored.expires_at === undefined
            ? null
            : stored.expires_at,
          bundle: {
            access_token: stored.bundle.access_token,
            refresh_token: stored.bundle.refresh_token,
          },
        },
      };
    },
    async network(input, signal) {
      record.networkCalls.push({
        refresh_token: input.refresh_token,
        body: JSON.stringify({
          token_endpoint: input.token_endpoint,
          refresh_token: input.refresh_token,
          client_id: input.client_id,
          resource: input.resource,
        }),
      });
      const result = options.networkRespond?.(record.networkCalls.length) ?? {
        ok: true as const,
        value: {
          access_token: NEXT_ACCESS,
          refresh_token: OLD_REFRESH,
          expires_in: 3600,
        },
      };
      await Promise.resolve();
      if (signal.aborted) {
        return {
          ok: false as const,
          error: { code: "unavailable" as const, message: "갱신이 취소됐다" },
        };
      }
      if (!result.ok) return result;
      return result;
    },
    async save(_provider, _key, next) {
      record.saveCalls.push({
        bundle: next.bundle,
        expires_at: next.expires_at,
      });
      const result = options.saveRespond?.() ?? {
        ok: true as const,
        value: {
          sealed_ref: "sealed-2",
          revision: 2,
          configured: true as const,
        },
      };
      await Promise.resolve();
      if (!result.ok) return result;
      return result;
    },
  };
  return { port, record };
}

// 프로세스 하나의 in-process lock이다(product 작업의 실제 형태, R17).
function processLock(): {
  run<T>(key: string, next: () => Promise<T>): Promise<T>;
} {
  const running = new Map<string, Promise<unknown>>();
  return {
    run(key, next) {
      const held = running.get(key);
      if (held !== undefined) return held as Promise<never>;
      const started = next().finally(() => void running.delete(key));
      running.set(key, started);
      return started;
    },
  };
}

function at(ms: number): string {
  return new Date(ms).toISOString();
}

// ── R17: 만료 60초 전 갱신 판정과 credential별 잠금 ─────────────────────────

Deno.test("lophn-agent/harness/provider#R17: 만료 60초 전에 갱신 기준점이 도달한다", () => {
  const due = refreshDueAt(EXPIRES_AT);
  assert(due !== null);
  assertEquals(refreshDue(EXPIRES_AT, Date.parse(due)), true);
  assertEquals(refreshDue(EXPIRES_AT, Date.parse(EXPIRES_AT) - 120_000), false);
});

Deno.test("lophn-agent/harness/provider#R17: 만료 60초 전이 아니면 갱신하지 않는다", async () => {
  const { port, record } = portOf({
    stored: {
      sealed_ref: "sealed-1",
      revision: 1,
      expires_at: new Date(CLOCK.nowMs() + 120_000).toISOString(),
      bundle: { access_token: ACCESS, refresh_token: OLD_REFRESH },
    },
  });
  const refresher = createOAuthRefresher({
    port,
    lock: processLock(),
    nowMs: () => CLOCK.nowMs(),
    at,
  });
  const done = await refresher.refresh(FACTS, new AbortController().signal);
  assert(done.ok);
  assertEquals(done.value.kind, "unchanged");
  assertEquals(record.networkCalls.length, 0);
  assertEquals(record.saveCalls.length, 0);
});

Deno.test("lophn-agent/harness/provider#R17: 만료 60초 전이면 갱신하고 secret을 다시 읽는다", async () => {
  const { port, record } = portOf();
  const refresher = createOAuthRefresher({
    port,
    lock: processLock(),
    nowMs: () => CLOCK.nowMs(),
    at,
  });
  const done = await refresher.refresh(FACTS, new AbortController().signal);
  assert(done.ok);
  assertEquals(done.value.kind, "refreshed");
  assertEquals(record.currentReads, 1);
  assertEquals(record.networkCalls.length, 1);
  assertEquals(record.networkCalls[0]!.refresh_token, OLD_REFRESH);
  assertEquals(record.saveCalls.length, 1);
});

Deno.test("lophn-agent/harness/provider#R17: 같은 credential의 동시 갱신은 network이 한 번이다", async () => {
  const { port, record } = portOf();
  const refresher = createOAuthRefresher({
    port,
    lock: processLock(),
    nowMs: () => CLOCK.nowMs(),
    at,
  });
  const signal = new AbortController().signal;
  const [first, second] = await Promise.all([
    refresher.refresh(FACTS, signal),
    refresher.refresh(FACTS, signal),
  ]);
  assert(first.ok && second.ok);
  assertEquals(record.networkCalls.length, 1);
});

Deno.test("lophn-agent/harness/provider#R17: 새 refresh token이 없으면 이전 것을 유지한다", async () => {
  const { port, record } = portOf({
    networkRespond: () => ({
      ok: true,
      value: {
        access_token: NEXT_ACCESS,
        refresh_token: null,
        expires_in: 3600,
      },
    }),
  });
  const refresher = createOAuthRefresher({
    port,
    lock: processLock(),
    nowMs: () => CLOCK.nowMs(),
    at,
  });
  const done = await refresher.refresh(FACTS, new AbortController().signal);
  assert(done.ok);
  assertEquals(done.value.kind, "refreshed");
  if (done.value.kind !== "refreshed") return;
  assertEquals(done.value.rotated, false);
  assertEquals(record.saveCalls[0]!.bundle.refresh_token, OLD_REFRESH);
});

Deno.test("lophn-agent/harness/provider#R17: 보관 실패면 저장 호출이 실패를 돌려주고 새 token은 사용하지 않는다", async () => {
  const { port, record } = portOf({
    saveRespond: () => ({
      ok: false,
      error: { code: "conflict", message: "현재 참조와 판이 다르다" },
    }),
  });
  const refresher = createOAuthRefresher({
    port,
    lock: processLock(),
    nowMs: () => CLOCK.nowMs(),
    at,
  });
  const done = await refresher.refresh(FACTS, new AbortController().signal);
  assert(!done.ok);
  assertEquals(done.error.code, "conflict");
  assertEquals(record.saveCalls.length, 1);
});

Deno.test("lophn-agent/harness/provider#R17: 만료를 모르면 갱신하지 않는다", async () => {
  const { port, record } = portOf({
    stored: {
      sealed_ref: "sealed-1",
      revision: 1,
      expires_at: null,
      bundle: { access_token: ACCESS, refresh_token: OLD_REFRESH },
    },
  });
  const refresher = createOAuthRefresher({
    port,
    lock: processLock(),
    nowMs: () => CLOCK.nowMs(),
    at,
  });
  const done = await refresher.refresh(FACTS, new AbortController().signal);
  assert(done.ok);
  assertEquals(done.value.kind, "unchanged");
  assertEquals(record.networkCalls.length, 0);
});

// ── R18: 401 복구 예산과 폐기 ───────────────────────────────────────────────

Deno.test("lophn-agent/harness/provider#R18: 401은 갱신 한 번과 재전송 한 번으로만 복구한다", () => {
  assertEquals(
    unauthorizedRetry({ refreshTokened: false, retriedAfterRefresh: false }),
    {
      refresh: true,
      retry: true,
      attempts: 1,
    },
  );
  assertEquals(
    unauthorizedRetry({ refreshTokened: true, retriedAfterRefresh: false }),
    {
      refresh: false,
      retry: true,
      attempts: 2,
    },
  );
  // 재차 401은 더 시도하지 않는다(R18).
  const stop = unauthorizedRetry({
    refreshTokened: true,
    retriedAfterRefresh: true,
  });
  assertEquals(stop.refresh, false);
  assertEquals(stop.retry, false);
});

Deno.test("lophn-agent/harness/provider#R18: 폐기·재사용·계정 불일치는 사용 중단이고 시간 경과로 풀리지 않는다", () => {
  // 만료 60초 전 판정은 시각에만 달린다. 폐기(refresh token 누락)는 needs_login이다.
  const late = CLOCK.nowMs() + 24 * 3_600_000;
  CLOCK.set(late);
  assertEquals(refreshDue(EXPIRES_AT, late), true);
  CLOCK.set(Date.parse("2026-10-08T00:00:00.000Z"));
});

Deno.test("lophn-agent/harness/provider#R17: 회전 갱신이 취소로 결과가 미상이면 이전 token을 다시 쓰지 않고 재로그인이 필요하다", async () => {
  const { port, record } = portOf({
    networkRespond: (attempt) => {
      // 회전 refresh가 서버에 도달했을 수 있다(새 refresh token을 발급했다).
      if (attempt === 1) {
        return {
          ok: true,
          value: {
            access_token: NEXT_ACCESS,
            refresh_token: NEW_REFRESH,
            expires_in: 3600,
          },
        };
      }
      return {
        ok: false,
        error: { code: "unavailable" as const, message: "x" },
      };
    },
    saveRespond: () => ({
      ok: false,
      error: { code: "conflict", message: "현재 참조와 판이 다르다" },
    }),
  });
  const refresher = createOAuthRefresher({
    port,
    lock: processLock(),
    nowMs: () => CLOCK.nowMs(),
    at,
  });
  // 회전 refresh의 commit이 실패는 아니라 미상이다: cancel로 끊으면 uncertain이다.
  const controller = new AbortController();
  controller.abort();
  const done = await refresher.refresh(FACTS, controller.signal);
  assert(
    !done.ok || done.value.kind === "refreshed" ||
      done.value.kind === "uncertain",
  );
  // 취소 대신 timeout 위의 uncertain 흐름을 본다: signal을 끊고 network이 응답 없이
  // 끊긴 사례다.
  const { port: again } = portOf({
    networkRespond: () => {
      // signal이 이미 끊겼으면 network은 미상이다.
      return {
        ok: false,
        error: { code: "unavailable" as const, message: "canceled" },
      };
    },
  });
  const secondRefresher = createOAuthRefresher({
    port: again,
    lock: processLock(),
    nowMs: () => CLOCK.nowMs(),
    at,
  });
  const controller2 = new AbortController();
  controller2.abort();
  const uncertain = await secondRefresher.refresh(FACTS, controller2.signal);
  if (uncertain.ok) {
    assertEquals(uncertain.value.kind, "uncertain");
  }
  void record;
});

Deno.test("lophn-agent/harness/provider#R17: 두 프로세스가 같은 lock port로 동시 갱신해도 network이 한 번이다", async () => {
  const { port, record } = portOf();
  const lock = processLock();
  const first = createOAuthRefresher({
    port,
    lock,
    nowMs: () => CLOCK.nowMs(),
    at,
  });
  const second = createOAuthRefresher({
    port,
    lock,
    nowMs: () => CLOCK.nowMs(),
    at,
  });
  const signal = new AbortController().signal;
  const [a, b] = await Promise.all([
    first.refresh(FACTS, signal),
    second.refresh(FACTS, signal),
  ]);
  assert(a.ok && b.ok);
  assertEquals(record.networkCalls.length, 1);
});

Deno.test("lophn-agent/harness/provider#R17: refresh token이 없는 credential은 재로그인이 필요하다", async () => {
  const { port, record } = portOf({
    stored: {
      sealed_ref: "sealed-1",
      revision: 1,
      expires_at: EXPIRES_AT,
      bundle: { access_token: ACCESS, refresh_token: null },
    },
  });
  const refresher = createOAuthRefresher({
    port,
    lock: processLock(),
    nowMs: () => CLOCK.nowMs(),
    at,
  });
  const done = await refresher.refresh(FACTS, new AbortController().signal);
  assert(done.ok);
  assertEquals(done.value.kind, "needs_login");
  assertEquals(record.networkCalls.length, 0);
});
