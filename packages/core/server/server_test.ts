import { assert, assertEquals } from "@std/assert";
import { ok } from "../../base/mod.ts";
import {
  API_MAJOR,
  DEFAULT_API_PORT,
  ERROR_HTTP_STATUS,
  EVENT_SUBSCRIBE_PATH,
  EVENT_SUBSCRIBE_SUBPROTOCOL,
  HEADER_MAX_BYTES,
  platformHealth,
  RPC_JSON_MAX_BYTES,
  RPC_JSON_MAX_DEPTH,
  RPC_JSON_MAX_ITEMS,
} from "../../protocol/server/mod.ts";
import type { EventBackend } from "../storage/ledger/mod.ts";
import { call, listen } from "./harness_test.ts";
import { defaultPort, JSON_MAX_BYTES, RouteRegistry } from "./mod.ts";

Deno.test("platform/api#R1: 기본 port는 7431이고 read POST는 상태를 바꾸지 않는다", async () => {
  assertEquals(DEFAULT_API_PORT, 7431);
  assertEquals(defaultPort(), 7431);
  assertEquals(API_MAJOR, 1);
  let calls = 0;
  const opened = await listen({
    reads: new Map([
      ["platform/health", () => {
        calls += 1;
        return ok({
          observations: [],
          observed_at: "2026-10-04T00:00:00.000Z",
          as_of_seq: "0",
          next_cursor: null,
        });
      }],
    ]),
  });
  try {
    const first = await call(opened.base, "/v1/platform/health", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assertEquals(first.status, 200);
    const body = await first.json();
    assertEquals(body.observations, []);
    assertEquals(body.as_of_seq, "0");
    assertEquals(calls, 1);
    assert(!("data" in body));
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R2: 정확히 3구간 POST만 받고 미등록·대소문자·/v2는 거절한다", async () => {
  const opened = await listen();
  try {
    const registry = new RouteRegistry();
    assert(registry.lookup("/v1/platform/health") !== undefined);
    assertEquals(registry.lookup("/v1/platform/Health"), undefined);
    assertEquals(registry.lookup("/v1/platform/health/extra"), undefined);
    assertEquals(registry.lookup("/v2/platform/health"), undefined);
    assertEquals(registry.lookup("/v1/nope/missing"), undefined);
    assertEquals(registry.lookup(EVENT_SUBSCRIBE_PATH), undefined);

    for (
      const path of [
        "/v1/platform/Health",
        "/v1/platform/health/extra",
        "/v2/platform/health",
        "/v1/nope/missing",
        "/platform/health",
      ]
    ) {
      const response = await call(opened.base, path, {
        method: "POST",
        token: opened.token,
        headers: { "content-type": "application/json" },
        body: "{}",
      });
      assertEquals(response.status, 404, path);
      assertEquals((await response.json()).error.code, "not_found");
    }
    const get = await call(opened.base, "/v1/platform/health", {
      method: "GET",
      token: opened.token,
    });
    assertEquals(get.status, 400);
    await get.body?.cancel();
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R3: 성공은 결과 그대로 200이고 실패는 공통 상태다", async () => {
  const opened = await listen({
    reads: new Map([
      ["platform/health", () =>
        ok({
          observations: [{
            component: "ledger",
            available: true,
            observed_at: "2026-10-04T00:00:00.000Z",
          }],
          observed_at: "2026-10-04T00:00:00.000Z",
          as_of_seq: "3",
          next_cursor: null,
        })],
    ]),
    files: new Map([
      ["platform/health", () => ok(new TextEncoder().encode("nope"))],
    ]),
  });
  try {
    const okResponse = await call(opened.base, "/v1/platform/health", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assertEquals(okResponse.status, 200);
    assertEquals(
      okResponse.headers.get("content-type")?.includes("application/json"),
      true,
    );
    const json = await okResponse.json();
    assertEquals(json.as_of_seq, "3");
    assertEquals(Object.keys(json).includes("error"), false);

    const missing = await call(opened.base, "/v1/not/here", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assertEquals(missing.status, ERROR_HTTP_STATUS.not_found);
    const error = await missing.json();
    assertEquals(error.error.code, "not_found");
    assertEquals(typeof error.error.message, "string");
    assertEquals(platformHealth.resource, "platform");
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R4: handler 오류의 stack·원문·token을 지운다", async () => {
  const opened = await listen({
    reads: new Map([
      ["platform/health", () => {
        throw new Error(`secret-token leaked stack ${"x".repeat(20)}`);
      }],
    ]),
  });
  try {
    const response = await call(opened.base, "/v1/platform/health", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assertEquals(response.status, 500);
    const text = await response.text();
    const body = JSON.parse(text);
    assertEquals(body.error.code, "internal");
    assertEquals(body.error.message, "internal error");
    assert(!text.includes("secret-token"));
    assert(!text.includes("stack"));
    assert(!text.includes(opened.token));
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R6: 미지원 major는 변환하지 않고 거절한다", async () => {
  const opened = await listen();
  try {
    const response = await call(opened.base, "/v2/platform/health", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    assertEquals(response.status, 404);
    const body = await response.json();
    assertEquals(body.error.code, "not_found");
    assert(!JSON.stringify(body).includes("v1"));
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/security#R8: header·Content-Length·JSON 한도를 body 처리 전에 거절한다", async () => {
  const opened = await listen({
    reads: new Map([["platform/health", () => {
      throw new Error("body must not be handled");
    }]]),
  });
  try {
    // 선언 길이만 속이면 Deno가 body를 맞추다 연결을 끊는다. 실제 초과 bytes로 누적 상한을 본다.
    const huge = await call(opened.base, "/v1/platform/health", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: "x".repeat(RPC_JSON_MAX_BYTES + 1),
    });
    assertEquals(huge.status, 400);
    assertEquals((await huge.json()).error.code, "invalid_input");

    let deep = "0";
    for (let i = 0; i < RPC_JSON_MAX_DEPTH + 1; i++) {
      deep = '{"a":' + deep + "}";
    }
    const nested = await call(opened.base, "/v1/platform/health", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: deep,
    });
    assertEquals(nested.status, 400);
    assertEquals((await nested.json()).error.code, "invalid_input");

    const wide = JSON.stringify({
      items: Array.from({ length: RPC_JSON_MAX_ITEMS + 1 }, () => 1),
    });
    assert(wide.length < JSON_MAX_BYTES);
    const many = await call(opened.base, "/v1/platform/health", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json" },
      body: wide,
    });
    assertEquals(many.status, 400);
    await many.body?.cancel();

    const fat = "x".repeat(HEADER_MAX_BYTES);
    const headers = await call(opened.base, "/v1/platform/health", {
      method: "POST",
      token: opened.token,
      headers: { "content-type": "application/json", "x-pad": fat },
      body: "{}",
    });
    assertEquals(headers.status, 400);
  } finally {
    await opened.server.stop();
  }
});

Deno.test("platform/api#R1: WS upgrade를 event session에 넘긴다", async () => {
  const backend: EventBackend = {
    current: () => Promise.reject(new Error("unused")),
    read: () => Promise.reject(new Error("unused")),
  };
  const opened = await listen({ events: backend });
  try {
    const socket = new WebSocket(
      `ws://127.0.0.1:${opened.server.port}${EVENT_SUBSCRIBE_PATH}`,
      EVENT_SUBSCRIBE_SUBPROTOCOL,
    );
    // Bearer 없는 upgrade는 401이라 socket이 열리지 않는다.
    const closed = await new Promise<boolean>((resolve) => {
      socket.onopen = () => resolve(false);
      socket.onerror = () => resolve(true);
      socket.onclose = () => resolve(true);
    });
    assert(closed);

    const authed = new WebSocket(
      `ws://127.0.0.1:${opened.server.port}${EVENT_SUBSCRIBE_PATH}`,
      EVENT_SUBSCRIBE_SUBPROTOCOL,
    );
    // WebSocket 생성자는 header를 못 넣는다. fetch upgrade로 Bearer를 확인한다.
    authed.close();
    const upgrade = await fetch(
      `http://127.0.0.1:${opened.server.port}${EVENT_SUBSCRIBE_PATH}`,
      {
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
          "sec-websocket-version": "13",
          "sec-websocket-protocol": EVENT_SUBSCRIBE_SUBPROTOCOL,
          authorization: `Bearer ${opened.token}`,
        },
      },
    );
    assertEquals(upgrade.status, 101);
    await upgrade.body?.cancel();
  } finally {
    await opened.server.stop();
  }
});
