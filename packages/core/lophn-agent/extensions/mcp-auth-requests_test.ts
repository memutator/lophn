// lophn-agent/extensions#R16 #R17 [agent-I52]: core module graph에는 외부 fetch가 없다(platform/responsiveness#R1). 그래서 core는
// 발급자(token endpoint) 호출을 작업 메모리 대기열에 놓고 agent runtime이 machine 입구로 가져가 대신 보낸다. 이 시험은
// 대기열의 약속을 본다: 보낸 요청이 그대로 나가고, 응답이 Response로 돌아오고, 기한이 지나면 실패로 끝나며, 가져가지
// 않은 요청이 남아 새어 나가지 않는다. 사람의 실제 발급자·runtime에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { createMcpAuthRequests } from "./mcp-auth-requests.ts";

const URL_TOKEN = "https://issuer.example.test/token";

function world() {
  const timers: { ms: number; fire(): void; aborted: boolean }[] = [];
  let serial = 0;
  const requests = createMcpAuthRequests({
    newId: () => `req-${++serial}`,
    waitMs: 8_000,
    deadline: (ms, signal) =>
      new Promise((resolve) => {
        const timer = { ms, fire: () => resolve("elapsed"), aborted: false };
        timers.push(timer);
        signal.addEventListener("abort", () => {
          timer.aborted = true;
          resolve("aborted");
        }, { once: true });
      }),
  });
  return { requests, timers };
}

const post = (body: string) => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body,
});

const handler = (
  requests: ReturnType<typeof createMcpAuthRequests>,
  method: string,
) => requests.handlers.get(`agent-mcp-auth/${method}`)!;

Deno.test("lophn-agent/extensions#R16 [agent-I52]: a request core puts in the queue goes out as written, and the runtime's answer comes back as the response", async () => {
  const { requests } = world();
  const pending = requests.fetch(URL_TOKEN, post("grant_type=refresh_token"));
  const taken = requests.take();
  assertEquals(taken, {
    id: "req-1",
    url: URL_TOKEN,
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: "grant_type=refresh_token",
  });
  // 가져간 요청은 다시 나오지 않는다.
  assertEquals(requests.take(), null);
  assertEquals(
    requests.done("req-1", {
      status: 200,
      location: null,
      body: '{"access_token":"a"}',
    }),
    true,
  );
  const response = await pending;
  assertEquals(response.status, 200);
  assertEquals(await response.text(), '{"access_token":"a"}');
  // 한 번 답한 요청에 다시 답하면 받지 않는다.
  assertEquals(
    requests.done("req-1", { status: 200, location: null, body: "" }),
    false,
  );
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: requests go out in the order they were made, and each answer reaches its own request", async () => {
  const { requests } = world();
  const first = requests.fetch(URL_TOKEN, post("one"));
  const second = requests.fetch(URL_TOKEN, post("two"));
  assertEquals(requests.take()?.body, "one");
  assertEquals(requests.take()?.body, "two");
  assertEquals(requests.take(), null);
  requests.done("req-2", { status: 201, location: null, body: "second" });
  requests.done("req-1", { status: 200, location: null, body: "first" });
  assertEquals(await (await first).text(), "first");
  assertEquals(await (await second).text(), "second");
});

Deno.test("lophn-agent/extensions#R15 [agent-I52]: a redirect is handed back with its Location so the caller can refuse another origin, and a status without a body still makes a response", async () => {
  const { requests } = world();
  const moved = requests.fetch(URL_TOKEN, post("x"));
  requests.take();
  requests.done("req-1", {
    status: 302,
    location: "https://evil.example.test/token",
    body: "",
  });
  const redirect = await moved;
  assertEquals(redirect.status, 302);
  assertEquals(
    redirect.headers.get("location"),
    "https://evil.example.test/token",
  );
  const empty = requests.fetch(URL_TOKEN, post("y"));
  requests.take();
  requests.done("req-2", { status: 204, location: null, body: "" });
  assertEquals((await empty).status, 204);
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: a runtime that cannot reach the issuer fails the request, and so does the time limit, and a late answer is not accepted", async () => {
  const { requests, timers } = world();
  const unreachable = requests.fetch(URL_TOKEN, post("a"));
  requests.take();
  requests.done("req-1", null);
  let failed = false;
  try {
    await unreachable;
  } catch {
    failed = true;
  }
  assert(failed);

  // 아무도 가져가지 않은 요청은 기한이 지나면 실패하고 대기열에서도 빠진다.
  const stale = requests.fetch(URL_TOKEN, post("b"));
  assertEquals(timers.at(-1)!.ms, 8_000);
  timers.at(-1)!.fire();
  let timedOut = false;
  try {
    await stale;
  } catch {
    timedOut = true;
  }
  assert(timedOut);
  assertEquals(requests.take(), null);

  // 가져갔지만 답하지 않은 요청도 기한에 실패하고, 늦은 답은 받지 않는다.
  const slow = requests.fetch(URL_TOKEN, post("c"));
  const taken = requests.take();
  assertEquals(taken?.body, "c");
  timers.at(-1)!.fire();
  try {
    await slow;
  } catch { /* 기한 초과 */ }
  assertEquals(
    requests.done(taken!.id, { status: 200, location: null, body: "{}" }),
    false,
  );
  // 기한이 지난 요청이 대기열에 남아 timer를 쥐지 않는다.
  const quick = requests.fetch(URL_TOKEN, post("d"));
  requests.take();
  requests.done("req-4", { status: 200, location: null, body: "{}" });
  await quick;
  assert(timers.at(-1)!.aborted);
});

Deno.test("lophn-agent/extensions#R15 [agent-I52]: only an https POST with a text body is queued, anything else fails before it reaches the runtime", async () => {
  const { requests } = world();
  for (
    const [url, init] of [
      ["http://issuer.example.test/token", post("x")],
      [URL_TOKEN, { ...post("x"), method: "GET" }],
      [URL_TOKEN, { ...post("x"), body: new Uint8Array([1]) }],
      [URL_TOKEN, { ...post("x"), body: "x".repeat(65_537) }],
    ] as const
  ) {
    let failed = false;
    try {
      await requests.fetch(url, init as RequestInit);
    } catch {
      failed = true;
    }
    assert(failed, `${url} ${String(init.method)}`);
  }
  assertEquals(requests.take(), null);
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: the machine routes take and finish a request with the contract's input and answer, and reject a wrong input", async () => {
  const { requests } = world();
  const take = handler(requests, "request-take");
  const done = handler(requests, "request-done");
  const empty = await take({}, {});
  assert(empty.ok);
  assertEquals(empty.value, { request: null });
  const pending = requests.fetch(URL_TOKEN, post("z"));
  const got = await take({}, {});
  assert(got.ok);
  assertEquals((got.value as { request: { id: string } }).request.id, "req-1");
  const finished = await done({}, {
    id: "req-1",
    response: { status: 200, location: null, body: "ok" },
  });
  assert(finished.ok);
  assertEquals(finished.value, { accepted: true });
  assertEquals(await (await pending).text(), "ok");
  const again = await done({}, { id: "req-1", response: null });
  assert(again.ok);
  assertEquals(again.value, { accepted: false });
  const wrong = await done({}, { id: "req-1", response: { status: 1 } });
  assert(!wrong.ok);
  assertEquals(wrong.error.code, "invalid_input");
  const extra = await take({}, { anything: true });
  assert(!extra.ok);
  assertEquals(extra.error.code, "invalid_input");
});
