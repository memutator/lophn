import assert from "node:assert/strict";
import { createServer, type AddressInfo } from "node:net";
import { test } from "node:test";

import {
  createOAuthHandoffHost,
  parseLoopbackRedirect,
} from "./oauth-handoff.ts";

// 보안 경계: loopback(127.0.0.1·::1·localhost) http 주소만 listener를 연다. 외부 host·https·userinfo·0 port는 거절한다.
test("parseLoopbackRedirect accepts only loopback http redirects with an explicit port", () => {
  assert.deepStrictEqual(
    parseLoopbackRedirect("http://localhost:1455/auth/callback"),
    {
      hosts: ["127.0.0.1", "::1"],
      port: 1455,
      path: "/auth/callback",
      origin: "http://localhost:1455",
    },
  );
  assert.deepStrictEqual(
    parseLoopbackRedirect("http://127.0.0.1:54321/callback"),
    {
      hosts: ["127.0.0.1"],
      port: 54321,
      path: "/callback",
      origin: "http://127.0.0.1:54321",
    },
  );
  for (const bad of [
    "https://127.0.0.1:1455/auth/callback",
    "http://example.com:1455/auth/callback",
    "http://0.0.0.0:1455/auth/callback",
    "http://user:pass@127.0.0.1:1455/callback",
    "http://127.0.0.1/callback",
    "http://127.0.0.1:0/callback",
    "not a url",
  ]) {
    assert.equal(parseLoopbackRedirect(bad), null, bad);
  }
});

// 빈 loopback port를 하나 얻고 닫는다.
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as AddressInfo).port;
      server.close(() => resolve(port));
    });
  });
}

// 임시 loopback listener는 맞는 state의 callback 하나만 받아 돌려주고, port가 바쁘면 conflict를 낸다.
test("createOAuthHandoffHost captures matching callback, ignores wrong state, and reports busy port as conflict", async () => {
  const logs: string[] = [];
  const host = createOAuthHandoffHost({ log: (line) => logs.push(line) });
  try {
    const port = await freePort();
    const redirectUri = `http://127.0.0.1:${port}/auth/callback`;
    const started = await host.handle({
      action: "start",
      id: "h1",
      redirectUri,
      state: "STATE-1",
    });
    assert.deepStrictEqual(started, { ok: true });
    // log에 state 원문이 남지 않는다.
    assert.ok(logs.every((line) => !line.includes("STATE-1")));

    const waiting = host.handle({ action: "wait", id: "h1" });

    // 같은 port로 또 시작하면 conflict다(renderer가 manual paste fallback으로 안내한다).
    const busy = await host.handle({
      action: "start",
      id: "h2",
      redirectUri,
      state: "STATE-2",
    });
    assert.deepStrictEqual(busy, { ok: false, code: "conflict" });

    // 다른 state는 400으로 돌려보내고 계속 기다린다.
    const wrongRes = await fetch(`${redirectUri}?code=WRONG&state=OTHER`);
    assert.equal(wrongRes.status, 400);

    // 맞는 state와 code가 오면 200으로 닫히고 wait가 전체 callback URL을 돌려준다.
    const okRes = await fetch(`${redirectUri}?code=CODE-9&state=STATE-1`);
    assert.equal(okRes.status, 200);
    const captured = await waiting;
    assert.deepStrictEqual(captured, {
      ok: true,
      callbackUrl: `${redirectUri}?code=CODE-9&state=STATE-1`,
    });

    // 취소하면 열려 있던 listener가 닫히고 wait가 cancelled로 끝난다.
    const port2 = await freePort();
    const started2 = await host.handle({
      action: "start",
      id: "h3",
      redirectUri: `http://127.0.0.1:${port2}/callback`,
      state: "STATE-3",
    });
    assert.deepStrictEqual(started2, { ok: true });
    const waiting2 = host.handle({ action: "wait", id: "h3" });
    await host.handle({ action: "cancel", id: "h3" });
    assert.deepStrictEqual(await waiting2, { ok: false, code: "cancelled" });
  } finally {
    await host.stopAll();
  }
});
