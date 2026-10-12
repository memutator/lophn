// lophn-agent/extensions#R16 #R17 [agent-I52]: runtime의 pump가 core 대기열의 발급자 요청을 가져가 대신 보내고 응답을
// 돌려준다. core는 가짜 CoreCall이고 발급자는 가짜 fetch다. 사람의 실제 발급자·core에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { err, ok } from "../../packages/base/mod.ts";
import type { McpAuthRequest } from "../../packages/contracts/lophn-agent/mod.ts";
import type { CoreCall } from "./core-call.ts";
import {
  MCP_AUTH_FETCH_TIMEOUT_MS,
  MCP_AUTH_PUMP_IDLE_MS,
  startMcpAuthPump,
} from "./mcp-auth-pump.ts";

const request = (
  id: string,
  body = "grant_type=refresh_token",
): McpAuthRequest => ({
  id,
  url: "https://issuer.example.test/token",
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body,
});

type Done = { id: string; response: unknown };

// 가져갈 요청을 차례로 내주고 돌려받은 답을 모으는 core다.
function fakeCore(queue: McpAuthRequest[], onDone: () => void = () => {}) {
  const done: Done[] = [];
  const call: CoreCall = (path, body) => {
    if (path === "/v1/agent-mcp-auth/request-take") {
      return Promise.resolve(ok({ request: queue.shift() ?? null }));
    }
    if (path === "/v1/agent-mcp-auth/request-done") {
      done.push(body as Done);
      onDone();
      return Promise.resolve(ok({ accepted: true }));
    }
    return Promise.resolve(err({ code: "not_found", message: path }));
  };
  return { call, done };
}

Deno.test("lophn-agent/extensions#R16 #R17 [agent-I52]: the pump sends a taken request as written without following a redirect, and returns the status, Location and body", async () => {
  const stop = new AbortController();
  const seen: { url: string; init: RequestInit }[] = [];
  const core = fakeCore(
    [request("req-1", "a=b"), request("req-2", "c=d")],
    () => core.done.length === 2 && stop.abort(),
  );
  await startMcpAuthPump({
    call: core.call,
    fetch: (url, init) => {
      seen.push({ url, init });
      return Promise.resolve(
        seen.length === 1
          ? new Response('{"access_token":"a"}', { status: 200 })
          : new Response("", {
            status: 302,
            headers: { location: "https://evil.example.test/token" },
          }),
      );
    },
    signal: stop.signal,
    wait: () => Promise.resolve(),
  });
  assertEquals(seen.map((entry) => entry.url), [
    "https://issuer.example.test/token",
    "https://issuer.example.test/token",
  ]);
  assertEquals(seen[0]!.init.method, "POST");
  assertEquals(seen[0]!.init.body, "a=b");
  assertEquals(seen[0]!.init.redirect, "manual");
  assertEquals(seen[0]!.init.headers, {
    "content-type": "application/x-www-form-urlencoded",
  });
  assertEquals(core.done, [
    {
      id: "req-1",
      response: { status: 200, location: null, body: '{"access_token":"a"}' },
    },
    {
      id: "req-2",
      response: {
        status: 302,
        location: "https://evil.example.test/token",
        body: "",
      },
    },
  ]);
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: an issuer that cannot be reached, answers too much or too slowly is reported as not reached, and the pump goes on to the next request", async () => {
  const stop = new AbortController();
  const core = fakeCore(
    [request("req-1"), request("req-2"), request("req-3"), request("req-4")],
    () => core.done.length === 4 && stop.abort(),
  );
  let round = 0;
  await startMcpAuthPump({
    call: core.call,
    fetch: (_url, init) => {
      round += 1;
      if (round === 1) return Promise.reject(new Error("network down"));
      if (round === 2) {
        return Promise.resolve(new Response("x".repeat(65_537)));
      }
      if (round === 3) {
        return new Promise((_resolve, reject) =>
          init.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          )
        );
      }
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
    signal: stop.signal,
    fetchTimeoutMs: 20,
    wait: () => Promise.resolve(),
  });
  assertEquals(core.done.map((entry) => entry.response), [
    null,
    null,
    null,
    { status: 200, location: null, body: "{}" },
  ]);
  assert(MCP_AUTH_FETCH_TIMEOUT_MS < 8_000);
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: with nothing to take, or with core out of reach, the pump rests and looks again, and it ends when it is stopped", async () => {
  const stop = new AbortController();
  const rests: number[] = [];
  let calls = 0;
  let down = true;
  const call: CoreCall = () => {
    calls += 1;
    if (down) {
      down = false;
      return Promise.resolve(
        err({ code: "unavailable", message: "core is not reachable" }),
      );
    }
    return Promise.resolve(ok({ request: null }));
  };
  await startMcpAuthPump({
    call,
    fetch: () => Promise.reject(new Error("가져갈 것이 없으면 보내지 않는다")),
    signal: stop.signal,
    wait: (ms) => {
      rests.push(ms);
      if (rests.length === 3) stop.abort();
      return Promise.resolve();
    },
  });
  assertEquals(rests, [
    MCP_AUTH_PUMP_IDLE_MS,
    MCP_AUTH_PUMP_IDLE_MS,
    MCP_AUTH_PUMP_IDLE_MS,
  ]);
  assertEquals(calls, 3);
  // 이미 멈춘 신호로는 한 번도 부르지 않는다.
  const before = calls;
  await startMcpAuthPump({
    call,
    fetch: () => Promise.reject(new Error("x")),
    signal: stop.signal,
  });
  assertEquals(calls, before);
});
