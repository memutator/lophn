// lophn-agent/extensions#R16 #R17 [agent-I52]: OAuth 서버에 연결할 때 저장한 token을 요청마다 붙이고, 로그인 전에는 요청을
// 보내지 않으며, 재인증이 필요하면 연결 실패와 구별되는 인증 실패로 알린다. token 값은 부착 callback 안에만 있다.
// 서버는 가짜 fetch이고 부착은 시험용 port다. 사람의 실제 keychain·MCP server에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { err } from "../../base/mod.ts";
import { mcpServersSetting } from "../../protocol/lophn-agent/mod.ts";
import {
  createMcpConnections,
  type HttpFetch,
  type McpSecretAttach,
} from "./mod.ts";
import { mcpTokenRef } from "./mcp-oauth-vault.ts";

const SERVER_URL = "https://mcp.example.test/rpc";
const KEY = { place: null, name: "notes" } as const;

function oauthServer(tokenRef: string | null) {
  return mcpServersSetting.value_type.parse([{
    name: "notes",
    revision: 1,
    enabled: true,
    transport: "http",
    call_timeout_ms: 60_000,
    classifications: {},
    http: {
      url: SERVER_URL,
      headers: {},
      auth: {
        kind: "oauth2",
        issuer: "https://issuer.example.test",
        client_id: "lophn",
        client_secret_ref: null,
        scopes: [],
        token_ref: tokenRef,
      },
    },
  }])[0]!;
}

function fakeMcp() {
  const seen: { authorization: string | null; method: string }[] = [];
  const fetch: HttpFetch = async (_url, init) => {
    const headers = new Headers(init.headers);
    const body = JSON.parse(String(init.body)) as {
      id?: number;
      method: string;
    };
    seen.push({
      authorization: headers.get("authorization"),
      method: body.method,
    });
    if (body.id === undefined) return new Response(null, { status: 202 });
    const result = body.method === "initialize"
      ? {
        protocolVersion: "2025-06-18",
        capabilities: { tools: {} },
        serverInfo: { name: "fake", version: "0" },
      }
      : {
        tools: [{
          name: "whoami",
          description: "who",
          inputSchema: { type: "object", properties: {} },
        }],
      };
    return await Promise.resolve(
      Response.json({ jsonrpc: "2.0", id: body.id, result }),
    );
  };
  return { seen, fetch };
}

type Asked = { ref: string; purpose: string; origin: string };

function attachOf(
  answer: () => ReturnType<McpSecretAttach["send"]> | string | "refused",
): { attach: McpSecretAttach; asked: Asked[] } {
  const asked: Asked[] = [];
  return {
    asked,
    attach: {
      async send(input, transmit) {
        asked.push({
          ref: input.use.sealed_ref,
          purpose: input.use.purpose,
          origin: "origin" in input.use.destination
            ? input.use.destination.origin
            : "",
        });
        const next = answer();
        if (next === "refused") {
          return err({ code: "forbidden", message: "reauth_needed" });
        }
        if (typeof next === "string") return await transmit(next);
        return await next;
      },
    },
  };
}

function connectionsOver(
  fetch: HttpFetch,
  secrets: McpSecretAttach | undefined,
) {
  return createMcpConnections({
    nowMs: () => 0,
    wait: () => Promise.resolve("elapsed" as const),
    deadline: (_ms, signal) =>
      new Promise((resolve) =>
        signal.addEventListener("abort", () => resolve("aborted"), {
          once: true,
        })
      ),
    openStdio: () => Promise.reject(new Error("stdio 아님")),
    fetch,
    ...(secrets === undefined ? {} : { secrets }),
  });
}

Deno.test("lophn-agent/extensions#R16 #R17 [agent-I52]: an OAuth server gets the stored token as a bearer on every request, asked by the setting's token reference for that server only", async () => {
  const mcp = fakeMcp();
  const tokens = ["token-one", "token-two"];
  let round = 0;
  const secrets = attachOf(() => tokens[Math.min(round++, 1)]!);
  const connections = connectionsOver(mcp.fetch, secrets.attach);
  try {
    const ref = mcpTokenRef(KEY);
    const connected = await connections.acquire(
      "asg-1",
      oauthServer(ref),
      new AbortController().signal,
    );
    assert(connected.ok, connected.ok ? "" : connected.error.message);
    assertEquals(connected.value.state, "connected");
    assertEquals(mcp.seen[0]!.authorization, "Bearer token-one");
    // 값이 바뀌면(갱신) 다음 요청이 새 값을 붙인다. 연결을 다시 열 필요가 없다.
    const listed = await connections.toolList("asg-1", "notes");
    assert(listed.ok);
    assertEquals(mcp.seen.at(-1)!.authorization, "Bearer token-two");
    // 요청마다 부착을 청하고 참조는 설정이 가리키는 token 참조, 목적지는 서버 URL의 origin이다.
    assert(secrets.asked.length >= 2);
    for (const asked of secrets.asked) {
      assertEquals(asked, {
        ref,
        purpose: "external_mcp_credential",
        origin: "https://mcp.example.test",
      });
    }
    // 값은 연결 상태 어디에도 없다.
    assert(!JSON.stringify(connections.views()).includes("token-"));
  } finally {
    await connections.endAll();
  }
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: an OAuth server that was never signed in sends no request and fails as failed_auth", async () => {
  const mcp = fakeMcp();
  const secrets = attachOf(() => "never-used");
  const connections = connectionsOver(mcp.fetch, secrets.attach);
  try {
    const result = await connections.acquire(
      "asg-1",
      oauthServer(null),
      new AbortController().signal,
    );
    assert(!result.ok);
    assertEquals(result.error.code, "forbidden");
    assertEquals(connections.views().at(-1)?.state, "failed_auth");
    // 로그인 전 도구 호출은 막힌다: 서버에도, 부착 port에도 닿지 않는다.
    assertEquals(mcp.seen.length, 0);
    assertEquals(secrets.asked.length, 0);
    const called = await connections.call(
      "asg-1",
      "notes",
      "whoami",
      {},
      new AbortController().signal,
      1000,
    );
    assertEquals(called.kind, "no_connection");
  } finally {
    await connections.endAll();
  }
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: a refused token (sign in again) is failed_auth with no retry, while a token that cannot be read is a connection failure", async () => {
  const mcp = fakeMcp();
  const refused = attachOf(() => "refused");
  const first = connectionsOver(mcp.fetch, refused.attach);
  try {
    const result = await first.acquire(
      "asg-1",
      oauthServer(mcpTokenRef(KEY)),
      new AbortController().signal,
    );
    assert(!result.ok);
    assertEquals(first.views().at(-1)?.state, "failed_auth");
    // 인증 거절에는 자동 재연결이 없다.
    const again = await first.reconnect("asg-1", "notes");
    assert(!again.ok);
    assertEquals(again.error.code, "forbidden");
    assertEquals(mcp.seen.length, 0);
  } finally {
    await first.endAll();
  }
  const unreadable = attachOf(() =>
    Promise.resolve(err({ code: "unavailable", message: "keychain" }))
  );
  const second = connectionsOver(mcp.fetch, unreadable.attach);
  try {
    const result = await second.acquire(
      "asg-1",
      oauthServer(mcpTokenRef(KEY)),
      new AbortController().signal,
    );
    assert(!result.ok);
    assertEquals(second.views().at(-1)?.state, "failed_temporary");
    assertEquals(mcp.seen.length, 0);
  } finally {
    await second.endAll();
  }
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: without a secret attach port an OAuth server is not reached at all", async () => {
  const mcp = fakeMcp();
  const connections = connectionsOver(mcp.fetch, undefined);
  try {
    const result = await connections.acquire(
      "asg-1",
      oauthServer(mcpTokenRef(KEY)),
      new AbortController().signal,
    );
    assert(!result.ok);
    assertEquals(mcp.seen.length, 0);
  } finally {
    await connections.endAll();
  }
});
