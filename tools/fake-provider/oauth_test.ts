import { assertEquals } from "@std/assert";
import { startFakeProvider } from "./mod.ts";

const VERIFIER = "synthetic-verifier-0123456789abcdef";

async function challenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

Deno.test("tools/fake-provider: discovery, dynamic client, PKCE, refresh 회전을 흉내 낸다", async () => {
  const provider = startFakeProvider({
    script: { steps: [] },
    nowMs: () => 1_000,
    oauth: { rotateRefresh: true },
  });
  try {
    const discovery =
      await (await fetch(`${provider.url}/.well-known/openid-configuration`))
        .json();
    assertEquals(discovery.token_endpoint, "/oauth/token");
    assertEquals(discovery.code_challenge_methods_supported, ["S256"]);

    const registered = await (await fetch(`${provider.url}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "lophn",
        redirect_uris: ["http://127.0.0.1/callback"],
      }),
    })).json();
    const redirect = await fetch(
      `${provider.url}/oauth/authorize?client_id=${registered.client_id}&redirect_uri=${
        encodeURIComponent("http://127.0.0.1/callback")
      }&state=state-1&code_challenge=${await challenge(
        VERIFIER,
      )}&code_challenge_method=S256`,
      { redirect: "manual" },
    );
    assertEquals(redirect.status, 302);
    const location = new URL(redirect.headers.get("location") ?? "");
    assertEquals(location.searchParams.get("state"), "state-1");

    const token = await (await fetch(`${provider.url}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "synthetic-auth-code",
        code_verifier: VERIFIER,
        state: "state-1",
      }),
    })).json();
    assertEquals(token.token_type, "bearer");
    const firstRefresh = token.refresh_token;

    const rotated = await (await fetch(`${provider.url}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: token.refresh_token,
      }),
    })).json();
    assertEquals(rotated.rotated, true);
    assertEquals(rotated.refresh_token === firstRefresh, false);
    assertEquals(
      JSON.stringify(provider.requests()).includes(token.access_token),
      false,
    );
  } finally {
    await provider.close();
  }
});

Deno.test("tools/fake-provider: device poll은 pending, slow_down, 만료를 순서대로 낸다", async () => {
  const clock = { now: 1_000 };
  const provider = startFakeProvider({
    script: { steps: [] },
    nowMs: () => clock.now,
    oauth: {
      devicePolls: ["slow_down", "authorization_pending"],
      deviceExpiresAtMs: 5_000,
    },
  });
  try {
    const started =
      await (await fetch(`${provider.url}/oauth/device`, { method: "POST" }))
        .json();
    assertEquals(started.interval, 0);
    const poll = () =>
      fetch(`${provider.url}/oauth/token`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: started.device_code,
        }),
      });
    assertEquals((await (await poll()).json()).error, "slow_down");
    assertEquals((await (await poll()).json()).error, "authorization_pending");
    const granted = await (await poll()).json();
    assertEquals(granted.token_type, "bearer");
    assertEquals(typeof granted.access_token, "string");
    assertEquals(JSON.stringify(granted).includes("synthetic-access"), false);
    clock.now = 5_000;
    assertEquals((await (await poll()).json()).error, "expired_token");
  } finally {
    await provider.close();
  }
});

Deno.test("tools/fake-provider: 잘못된 PKCE와 state는 token을 주지 않는다", async () => {
  const provider = startFakeProvider({
    script: { steps: [] },
    nowMs: () => 0,
  });
  try {
    const registered = await (await fetch(`${provider.url}/oauth/register`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "lophn",
        redirect_uris: ["http://127.0.0.1/callback"],
      }),
    })).json();
    const redirect = await fetch(
      `${provider.url}/oauth/authorize?client_id=${registered.client_id}&redirect_uri=${
        encodeURIComponent("http://127.0.0.1/callback")
      }&state=state-2&code_challenge=${await challenge(
        VERIFIER,
      )}&code_challenge_method=S256`,
      { redirect: "manual" },
    );
    assertEquals(redirect.status, 302);
    const rejected = await (await fetch(`${provider.url}/oauth/token`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: "synthetic-auth-code",
        code_verifier: "wrong-verifier",
        state: "state-2",
      }),
    })).json();
    assertEquals(rejected.error, "invalid_grant");
  } finally {
    await provider.close();
  }
});

Deno.test("dev/stack#fake-provider: 401 뒤 OAuth refresh 재전송은 UA와 tool 이름을 그대로 단언한다", async () => {
  const body = {
    model: "fixture-model",
    tools: [{ name: "echo", input_schema: { type: "object" } }],
  };
  const ua = "lophn-fixture-UA";
  const match = {
    headers: { "user-agent": ua, authorization: "bearer" },
    body,
  };
  const provider = startFakeProvider({
    script: {
      steps: [
        {
          id: "expired",
          protocol: "messages",
          match,
          response: {
            status: 401,
            body: '{"error":{"type":"authentication_error"}}',
          },
        },
        { id: "retried", protocol: "messages", match, reply: { text: "ok" } },
      ],
    },
    oauth: { randomBytes: () => new Uint8Array([0, 1, 2]) },
  });
  const post = (access: string) =>
    fetch(`${provider.url}/messages`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "user-agent": ua,
        authorization: `Bearer ${access}`,
      },
      body: JSON.stringify(body),
    });
  try {
    const expired = await post("expired-private-access");
    assertEquals(expired.status, 401);
    await expired.text();
    const refreshed = await fetch(`${provider.url}/oauth/token`, {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "user-agent": ua,
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: "refresh-private",
      }),
    });
    assertEquals(refreshed.status, 200);
    const token = await refreshed.json();
    const retried = await post(token.access_token);
    assertEquals(retried.status, 200);
    await retried.text();
    const calls = provider.requests().filter((entry) => entry.matchedStep);
    assertEquals(calls.map((entry) => entry.matchedStep), [
      "expired",
      "retried",
    ]);
    assertEquals(calls.map((entry) => entry.body), [body, body]);
    assertEquals(
      calls[0].headers.find((header) => header.name === "user-agent"),
      calls[1].headers.find((header) => header.name === "user-agent"),
    );
    const log = JSON.stringify(provider.requests());
    for (
      const secret of [
        "expired-private-access",
        "refresh-private",
        token.access_token,
      ]
    ) assertEquals(log.includes(secret), false);
    provider.assertDone(2);
  } finally {
    await provider.close();
  }
});
