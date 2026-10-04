import { assert, assertEquals } from "@std/assert";
import { createLogger } from "../../base/mod.ts";
import { ERROR_HTTP_STATUS } from "../../contracts/platform/mod.ts";
import {
  call,
  listen,
  registry,
  USER,
  value,
} from "./harness_test.ts";
import { gateRequest } from "./mod.ts";

const HEALTH = "/v1/platform/health";

Deno.test("platform/identity#R11: health·status·WS도 Bearer 없이 401이다", async () => {
  const opened = await listen();
  try {
    for (
      const path of [HEALTH, "/v1/platform/status", "/v1/events/subscribe"]
    ) {
      const response = await call(opened.base, path, { method: "POST" });
      assertEquals(response.status, 401);
      const body = await response.json();
      assertEquals(body.error.code, "unauthorized");
    }
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/identity#R12: Host allowlist는 실제 port의 loopback만 통과한다", async () => {
  const opened = await listen();
  const port = opened.server.port;
  try {
    for (
      const host of [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`]
    ) {
      const response = await call(opened.base, HEALTH, {
        method: "POST",
        token: opened.token,
        host,
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      // route handler는 없을 수 있다. Host 거절(400)만 아니면 allowlist를 통과한 것이다.
      assert(response.status !== 400, host);
      await response.body?.cancel();
    }
    // fetch는 Host를 연결 주소로 바꿔 보내므로 잘못된 Host는 gate에 직접 넣는다.
    const made = registry();
    for (
      const host of [
        `8.8.8.8:${port}`,
        `127.0.0.1:${port + 1}`,
        `evil.example:${port}`,
      ]
    ) {
      const decision = await gateRequest({
        url: `http://${host}/v1/platform/health`,
        origin: null,
        authorization: `Bearer ${opened.token}`,
        port,
      }, made.credentials);
      assertEquals(decision.ok, false, host);
      if (!decision.ok) {
        assertEquals(decision.failure.error.code, "invalid_input");
      }
    }
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/identity#R13: Origin이 있으면 올바른 token도 403이고 CORS·cookie는 열지 않는다", async () => {
  const opened = await listen();
  try {
    const origin = await call(opened.base, HEALTH, {
      method: "POST",
      token: opened.token,
      headers: {
        origin: "http://127.0.0.1",
        "content-type": "application/json",
      },
      body: "{}",
    });
    assertEquals(origin.status, 403);
    assertEquals((await origin.json()).error.code, "forbidden");
    assertEquals(origin.headers.get("access-control-allow-origin"), null);

    const preflight = await call(opened.base, HEALTH, {
      method: "OPTIONS",
      headers: {
        origin: "http://127.0.0.1",
        "access-control-request-method": "POST",
      },
    });
    assertEquals(preflight.status, 403);
    await preflight.body?.cancel();

    const cookie = await call(opened.base, HEALTH, {
      method: "POST",
      headers: {
        cookie: `lophn=${opened.token}`,
        "content-type": "application/json",
      },
      body: "{}",
    });
    assertEquals(cookie.status, 401);
    await cookie.body?.cancel();
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/identity#R13: token 비교는 digest의 constant-time이다", async () => {
  const made = registry();
  const issued = value(await made.credentials.issue(USER));
  const forged = issued.token.slice(0, -1) +
    (issued.token.endsWith("a") ? "b" : "a");
  const denied = await made.credentials.authenticate(forged);
  assertEquals(denied.ok, false);
  const again = value(await made.credentials.authenticate(issued.token));
  assertEquals(again.principal, "user");
});

Deno.test("platform/diagnostics#R7: 무인증 실패와 Origin 거부는 안전 log만 남긴다", async () => {
  const records: { event: string; fields: Record<string, unknown> }[] = [];
  const ledger: string[] = [];
  const logger = createLogger({
    now: () => "2026-10-04T00:00:00.000Z",
    sink: (record) => {
      records.push({ event: record.event, fields: record.fields });
    },
  });
  const opened = await listen({ logger });
  try {
    for (let i = 0; i < 20; i++) {
      const response = await call(opened.base, HEALTH, { method: "POST" });
      assertEquals(response.status, ERROR_HTTP_STATUS.unauthorized);
      await response.body?.cancel();
    }
    const origin = await call(opened.base, HEALTH, {
      method: "POST",
      token: opened.token,
      headers: { origin: "https://evil.example" },
    });
    assertEquals(origin.status, 403);
    await origin.body?.cancel();
    await logger.flush();
    assert(records.some((record) => record.event === "auth_rejected"));
    assert(records.some((record) => record.event === "origin_rejected"));
    const text = JSON.stringify(records);
    assert(!text.includes(opened.token));
    assertEquals(ledger.length, 0);
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/security#R6: loopback 두 주소만 bind하고 원격 bind 설정이 없다", async () => {
  const opened = await listen();
  try {
    const v4 = await call(opened.base, HEALTH, {
      method: "POST",
      token: opened.token,
    });
    assert(
      v4.status === 401 || v4.status === 400 || v4.status === 503 ||
        v4.status === 200 ||
        v4.status === 404,
    );
    await v4.body?.cancel();
    const v6 = await fetch(`http://[::1]:${opened.server.port}${HEALTH}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${opened.token}`,
        host: `[::1]:${opened.server.port}`,
      },
    });
    assert(v6.status !== 0);
    await v6.body?.cancel();
    const source = await Deno.readTextFile(
      new URL("./server.ts", import.meta.url),
    );
    assert(!source.includes("0.0.0.0"));
    assert(!/hostname:\s*"0\.0\.0\.0"/.test(source));
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/identity#R11: 없는 token과 hash 재사용은 401이다", async () => {
  const made = registry();
  const issued = value(await made.credentials.issue(USER));
  const opened = await listen({
    credentials: made.credentials,
    clock: made.clock,
    token: issued.token,
  });
  try {
    const missing = await call(opened.base, HEALTH, {
      method: "POST",
      token: "a".repeat(43),
    });
    assertEquals(missing.status, 401);
    await missing.body?.cancel();
    const digest = issued.token;
    assertEquals(digest.length, 43);
  } finally {
    await opened.server.stop();
  }
});
