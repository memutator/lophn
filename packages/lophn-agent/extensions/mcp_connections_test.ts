// lophn-agent/extensions MCP 연결 테스트다(lophn-agent#T36). 가짜 MCP child
// script와 로컬 fake HTTP server로 본다. 사람의 실제 keychain·실제 MCP server·
// 실제 model provider에 닿지 않는다. 파일은 temp dir만 쓴다.
import { assert, assertEquals } from "@std/assert";
import { err, manualClock } from "../../base/mod.ts";
import { mcpServersSetting } from "../../contracts/lophn-agent/mod.ts";
import {
  allowRunList,
  checkMcpConfig,
  CONNECT_TIMEOUT_MS,
  createMcpConnections,
  endpointReason,
  httpEndpointReason,
  type HttpFetch,
  initializeBody,
  LIST_BYTES_MAX,
  LIST_PAGE_MAX,
  LIST_TIMEOUT_MS,
  LIST_TOOLS_MAX,
  RECONNECT_DELAYS_MS,
  redirectOriginRejected,
  sameOrigin,
  SCHEMA_DEPTH_MAX,
  spawnStdioMcp,
  STDERR_MAX_BYTES,
  STDIO_AMBIENT_ENV,
  STDIO_KILL_GRACE_MS,
  STDIO_NO_SHELL,
  stdioChildEnv,
  type StdioSpawnInput,
  unsupportedReverseResponse,
} from "./mod.ts";

const clock = manualClock(0);

// ---- 가짜 MCP stdio child ----
// argv로 행동을 고른다. stdout으로 줄 단위 JSON-RPC를 쓰고 stdin에서 읽는다.
// deno-fmt-ignore
const CHILD_SCRIPT = `\
const mode = Deno.args[0] ?? "normal";
const dec = new TextDecoder();
let buf = "";
const envNames = Deno.env.toObject();
if (mode === "dump-env") {
  await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({ env: envNames }) + "\\n"));
  Deno.exit(0);
}
if (mode === "hang") {
  // initialize에 답하지 않는다(기한 시험).
  await new Promise(() => {});
}
for (;;) {
  const chunk = new Uint8Array(4096);
  const n = await Deno.stdin.read(chunk);
  if (n === null) break;
  buf += dec.decode(chunk.subarray(0, n));
  for (;;) {
    const at = buf.indexOf("\\n");
    if (at < 0) break;
    const line = buf.slice(0, at);
    buf = buf.slice(at + 1);
    if (line.trim() === "") continue;
    let message;
    try { message = JSON.parse(line); } catch { continue; }
    if (message.method === "initialize") {
      await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({
        jsonrpc: "2.0", id: message.id,
        result: { protocolVersion: "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "fake", version: "0" } },
      }) + "\\n"));
      continue;
    }
    if (message.method === "tools/list") {
      await Deno.stdout.write(new TextEncoder().encode(JSON.stringify(loginPages(mode, message.id, message.params)) + "\\n"));
      continue;
    }
    if (message.method === "tools/call") {
      if (mode === "silent-call") { await new Promise(() => {}); }
      await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({
        jsonrpc: "2.0", id: message.id, result: { content: [{ type: "text", text: "ok" }] },
      }) + "\\n"));
      continue;
    }
    if (message.method === "logging/setLevel" || message.method === "resources/list" ||
        message.method === "prompts/list" || message.method === "completion/complete") {
      await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({
        jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" },
      }) + "\\n"));
      continue;
    }
    if (message.method === undefined) continue;
    // 역방향 요청 시험이다(R25). 등록 기능 이름은 -32601로 답한다.
    if (mode === "reverse") {
      await Deno.stdout.write(new TextEncoder().encode(JSON.stringify({
        jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" },
      }) + "\\n"));
    }
  }
}
function loginPages(mode, id, params) {
  const tool = (name) => ({ name, description: name + " desc", inputSchema: { type: "object", properties: {} } });
  if (mode === "repeated-cursor") {
    if (params && params.cursor) {
      return { jsonrpc: "2.0", id, result: { tools: [], nextCursor: "page-2" } };
    }
    return { jsonrpc: "2.0", id, result: { tools: [tool("a")], nextCursor: "page-2" } };
  }
  if (mode === "duplicate") {
    return { jsonrpc: "2.0", id, result: { tools: [tool("a"), tool("a")] } };
  }
  if (mode === "bad-schema") {
    return { jsonrpc: "2.0", id, result: { tools: [tool("a"), { name: "b", inputSchema: "not-an-object" }] } };
  }
  if (mode === "no-tools-capability") {
    return { jsonrpc: "2.0", id, result: { tools: [] } };
  }
  if (mode === "many-pages") {
    const page = Number(params && params.cursor ? params.cursor : 0);
    if (page < 3) {
      return { jsonrpc: "2.0", id, result: { tools: [tool("t" + page)], nextCursor: String(page + 1) } };
    }
    return { jsonrpc: "2.0", id, result: { tools: [tool("t3")] } };
  }
  if (mode === "over-page-limit") {
    if (params && params.cursor) {
      return { jsonrpc: "2.0", id, result: { tools: [], nextCursor: "page-2" } };
    }
    return { jsonrpc: "2.0", id, result: { tools: [tool("a")], nextCursor: "page-2" } };
  }
  return { jsonrpc: "2.0", id, result: { tools: [tool("a"), tool("b")] } };
}
`;

// 가짜 stdio 목록이다. deps.openStdio가 실제 자식을 시작한다(절대 executable).
async function writeChild(): Promise<string> {
  const home = await Deno.makeTempDir({ prefix: "lophn-mcp-test-" });
  const path = `${home}/fake-mcp-child.mjs`;
  await Deno.writeTextFile(path, CHILD_SCRIPT);
  return path;
}

// ---- 가짜 HTTP server ----
// behavior로 응답을 고른다. loopback(127.0.0.1)만 듣는다. 요청 method·body도 기록한다.
function fakeHttpServer(behavior: {
  status?: number;
  location?: string;
  errorBody?: boolean;
  initializeResult?: Record<string, unknown>;
}) {
  const seen: { method: string; body: unknown }[] = [];
  const handler = (request: Request): Response => {
    if (behavior.location !== undefined) {
      return new Response(null, {
        status: 302,
        headers: { location: behavior.location },
      });
    }
    void request.text().then((text) => {
      try {
        seen.push({ method: JSON.parse(text).method, body: JSON.parse(text) });
      } catch { /* 본문이 JSON이 아니다 */ }
    });
    if (behavior.errorBody) {
      return new Response(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32000, message: "no" },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    if (behavior.status !== undefined) {
      return new Response("", { status: behavior.status });
    }
    const initialize = {
      protocolVersion: "2025-06-18",
      capabilities: { tools: {} },
      serverInfo: { name: "fake-http", version: "0" },
      ...(behavior.initializeResult ?? {}),
    };
    const body = JSON.stringify({
      jsonrpc: "2.0",
      id: 0,
      result: initialize,
    });
    return new Response(body, {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const server: Deno.HttpServer<Deno.NetAddr> = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    handler,
  );
  return {
    port: server.addr.port,
    seen,
    stop: () => server.shutdown(),
  };
}

// ---- deps ----
// 연결 눈이다. manualClock, 즉시 deadline·wait, 실제 spawnStdioMcp를 쓴다.
function connectionsDeps(childPath: string, fetch?: HttpFetch) {
  return {
    nowMs: () => clock.nowMs(),
    wait: () => Promise.resolve("elapsed" as const),
    // 실제 기한은 ms 뒤 elapsed다. 테스트는 긴 기한을 둔다(R19: 즉시 기한은
    // initialize 응답 전에 중단을 유발한다).
    deadline: async (ms: number, signal: AbortSignal) => {
      await new Promise((resolve) => setTimeout(resolve, Math.min(ms, 10_000)));
      return signal.aborted ? "aborted" as const : "elapsed" as const;
    },
    openStdio: (_server: unknown, input: StdioSpawnInput) =>
      Promise.resolve(
        spawnStdioMcp({
          ...input,
          env: { ...input.env, FAKE_CHILD: childPath },
        }),
      ),
    ...(fetch === undefined ? {} : { fetch }),
  };
}

// 기준 stdio server 설정이다. 계약 schema value_type을 지난다. executable은
// /bin/sh이고 args는 childPath를 literal 인자로 받는다.
let childPath: string | undefined;

function stdioServer() {
  // /bin/sh로 가짜 child를 deno run으로 시작한다(R14: 셸은 실행 파일이고
  // 인자는 literal로 전달된다). .mjs를 sh 스크립트로 주면 sh가 그대로
  // 해석하므로 -c로 deno run을 부른다.
  const script = childPath ?? "/lophn-mcp-test/none.mjs";
  const parsed = mcpServersSetting.value_type.parse([{
    name: "notes",
    revision: 1,
    enabled: true,
    transport: "stdio",
    call_timeout_ms: 60_000,
    classifications: {},
    stdio: {
      executable: "/bin/sh",
      args: ["-c", `deno run --allow-read --allow-env ${script} normal`],
      cwd: null,
      env: {},
    },
  }]);
  if (!parsed[0] || parsed[0].transport !== "stdio") {
    throw new Error("기준 stdio server가 아니었다");
  }
  return parsed[0];
}

Deno.test("lophn-agent/extensions#R12: 설정 누락·상충이면 그 서버만 연결 안 함과 고칠 항목을 알린다", () => {
  const checked = checkMcpConfig([
    {
      ...stdioServer(),
      name: "good",
    },
    // executable이 비어 있으면 그 서버만 문제다.
    {
      name: "absent",
      revision: 1,
      enabled: true,
      transport: "stdio",
      call_timeout_ms: 60_000,
      classifications: {},
      stdio: { executable: "", args: [], cwd: null, env: {} },
    },
    // 평문 http가 loopback이 아니면 그 서버만 문제다(R15).
    {
      name: "public-http",
      revision: 1,
      enabled: true,
      transport: "http",
      call_timeout_ms: 60_000,
      classifications: {},
      http: {
        url: "http://mcp.example.test/rpc",
        headers: {},
        auth: { kind: "none" },
      },
    },
  ]);
  assert(checked.ok);
  assertEquals(checked.value.valid.map((server) => server.name), ["good"]);
  assertEquals(
    checked.value.problems.map((problem) => problem.server),
    ["absent", "public-http"],
  );
  // 고칠 항목에는 힌트가 온다.
  assert(checked.value.problems[1].reason.includes("https"));
  assert(httpEndpointReason("http://192.168.1.5/rpc") !== null);
  assert(httpEndpointReason("http://127.0.0.1:8080/rpc") === null);
  assert(httpEndpointReason("https://mcp.example.test/rpc") === null);
  // --allow-run 목��은 enabled인 stdio executable만, 사전순으로 온다(architecture §2.3).
  const enabled = stdioServer();
  const disabled = { ...stdioServer(), name: "kept-off", enabled: false };
  const httpServer = {
    name: "http-one",
    revision: 1,
    enabled: true,
    transport: "http",
    call_timeout_ms: 60_000,
    classifications: {},
    http: {
      url: "https://mcp.example.test/rpc",
      headers: {},
      auth: { kind: "none" },
    },
  };
  const runs = allowRunList(
    [disabled, httpServer, enabled].map((value) =>
      mcpServersSetting.value_type.parse([value])[0]
    ),
  );
  assertEquals(runs, ["/bin/sh"]);
});

Deno.test("lophn-agent/extensions#R13: stdio와 Streamable HTTP만이고 SSE로 자동 전환하지 않는다", () => {
  // 계약 schema가 sse를 거절한다(contracts mcp-settings).
  const sse = mcpServersSetting.value_type.safeParse([{
    ...stdioServer(),
    transport: "sse",
  }]);
  assert(!sse.success);
  // streamable http는 받아들인다(R13: stdio와 Streamable HTTP만).
  const http = mcpServersSetting.value_type.safeParse([{
    name: "remote",
    revision: 1,
    enabled: true,
    transport: "http",
    call_timeout_ms: 60_000,
    classifications: {},
    http: {
      url: "https://mcp.example.test/rpc",
      headers: {},
      auth: { kind: "none" },
    },
  }]);
  assert(http.success);
});

Deno.test("lophn-agent/extensions#R14: shell 해석 없는 절대 executable과 최소 env로 자식을 시작한다", async () => {
  childPath = await writeChild();
  // 상대 경로는 거절이다.
  const relative = spawnStdioMcp({
    executable: "some-relative",
    args: [],
    cwd: null,
    env: {},
  });
  assert(!relative.ok);
  const explicit = spawnStdioMcp({
    executable: "/bin/sh",
    args: ["-c", "exit 0"],
    cwd: null,
    env: { A: "1" },
  });
  assert(explicit.ok);
  await explicit.value.close();
  // 최소 env 이름이다.
  assertEquals([...STDIO_AMBIENT_ENV], ["PATH", "HOME", "TEMP", "LC_ALL"]);
  assertEquals(STDIO_NO_SHELL, true);
  const env = stdioChildEnv(
    { A: "x" },
    (name) => name === "HOME" ? "/h" : undefined,
  );
  assertEquals(env, { HOME: "/h", A: "x" });
  const overridden = stdioChildEnv(
    { HOME: "/own" },
    (name) => name === "HOME" ? "/h" : undefined,
  );
  assertEquals(overridden, { HOME: "/own" });
  // metachar 인자는 그 글 그대로 간다(Deno.Command 배열 인자 보장).
  const metachar = spawnStdioMcp({
    executable: "/bin/sh",
    args: ["-c", "echo $HOME; rm -rf /"],
    cwd: null,
    env: {},
  });
  assert(metachar.ok);
  await metachar.value.close();
});

Deno.test("lophn-agent/extensions#R15: HTTPS·loopback만 HTTP이고 다른 origin redirect는 거절이다", async () => {
  assert(endpointReason("https://mcp.example.test/rpc") === null);
  assert(endpointReason("http://127.0.0.1:3921/rpc") === null);
  assert(endpointReason("http://mcp.example.test/rpc") !== null);
  // Q13: host·scheme·port가 하나라도 다른 redirect다.
  assert(
    redirectOriginRejected(
      "https://mcp.example.test/rpc",
      "https://evil.test/rpc",
    ) !==
      null,
  );
  assert(
    redirectOriginRejected(
      "https://mcp.example.test/rpc",
      "https://mcp.example.test:8443/rpc",
    ) !== null,
  );
  assert(
    redirectOriginRejected(
      "https://mcp.example.test/rpc",
      "https://mcp.example.test/rpc",
    ) === null,
  );
  assert(sameOrigin("https://a.test/x", "https://a.test/y"));
  assert(!sameOrigin("http://a.test/x", "https://a.test/y"));
  assert(!sameOrigin("https://127.0.0.1/x", "https://localhost/x"));
  // 실제 redirect 요청: 같은 origin의 redirect는 따라가지 않고 응답 그대로 본다.
  const http = fakeHttpServer({});
  const response = await fetch(`http://127.0.0.1:${http.port}/rpc`, {
    method: "POST",
    body: "{}",
  });
  assert(response.status === 200);
  await http.stop();
});

Deno.test("lophn-agent/extensions#R18: (assignment, server)마다 연결 하나이고 다른 assignment와 공유하지 않는다", async () => {
  childPath = childPath ?? await writeChild();
  const conns = createMcpConnections(connectionsDeps(childPath));
  try {
    const server = stdioServer();
    const first = await conns.acquire(
      "assignment-1",
      server,
      new AbortController().signal,
    );
    assert(first.ok, `acquire 실패: ${first.ok ? "" : first.error.message}`);
    assertEquals(first.value.state, "connected");
    // 같은 (assignment, server)의 두 번째 acquire은 같은 연결이다.
    const again = await conns.acquire(
      "assignment-1",
      server,
      new AbortController().signal,
    );
    assert(again.ok);
    assertEquals(again.value, first.value);
    // 다른 assignment는 별도 연결이다(R18).
    const other = await conns.acquire(
      "assignment-2",
      server,
      new AbortController().signal,
    );
    assert(other.ok);
    assert(other.value.owner[0] === "assignment-2");
    assertEquals(conns.views().length, 2);
    // 한 assignment를 끝내면 그 연결만 닫힌다.
    await conns.endAssignment("assignment-1");
    const views = conns.views().map((view) => view.owner[0]);
    assertEquals(views, ["assignment-2"]);
  } finally {
    await conns.endAll();
  }
});

Deno.test("lophn-agent/extensions#R19: 연결+initialize·목록·호출 기한은 단조이고 전달 뒤 기한 초과는 uncertain이다", async () => {
  childPath = childPath ?? await writeChild();
  const conns = createMcpConnections(connectionsDeps(childPath));
  try {
    const server = stdioServer();
    const acquired = await conns.acquire(
      "assignment-1",
      server,
      new AbortController().signal,
    );
    assert(
      acquired.ok,
      `acquire 실패: ${acquired.ok ? "" : acquired.error.message}`,
    );
    assertEquals(acquired.value.state, "connected");
    // 전체 목록은 검증을 지난 도구를 준다(R22와 같은 흐름).
    const list = await conns.toolList("assignment-1", "notes");
    assert(list.ok, `toolList 실패: ${list.ok ? "" : list.error.message}`);
    assertEquals(list.value.tools.map((tool) => tool.original), ["a", "b"]);
    // 정상 호출은 success다.
    const good = await conns.call(
      "assignment-1",
      "notes",
      "a",
      {},
      new AbortController().signal,
      60_000,
    );
    assertEquals(good.kind, "success");
    // 기한 상수다(R19): 연결+initialize 30초, 전체 목록 30초다. deps.deadline이
    // 어떤 ms를 받는지 본다. deadline은 실제 ms를 존중한다(deno 기동을 기다린다).
    const seen: number[] = [];
    const probed = createMcpConnections({
      ...connectionsDeps(childPath),
      deadline: (ms: number, signal: AbortSignal) => {
        seen.push(ms);
        return new Promise<"elapsed" | "aborted">((resolve) => {
          const t = setTimeout(
            () => resolve(signal.aborted ? "aborted" : "elapsed"),
            Math.min(ms, 10_000),
          );
          signal.addEventListener(
            "abort",
            () => {
              clearTimeout(t);
              resolve("aborted");
            },
            { once: true },
          );
        });
      },
    });
    try {
      const probedAcquired = await probed.acquire(
        "assignment-0",
        stdioServer(),
        new AbortController().signal,
      );
      assert(probedAcquired.ok);
      await probed.toolList("assignment-0", "notes");
      assertEquals(seen[0], CONNECT_TIMEOUT_MS, "연결 기한은 30초다(R19)");
      assert(
        seen.includes(LIST_TIMEOUT_MS),
        "목록 기한은 30초다(R19)",
      );
    } finally {
      await probed.endAll();
    }
    const timed = createMcpConnections({
      ...connectionsDeps(childPath),
      deadline: (ms: number, signal: AbortSignal) => {
        // 곧 기한이 지난다(R19: progress로 늘지 않는다). deno 기동 시간을
        // 피하려고 1초로 둔다. 기한은 ms 그대로 흘러 elapsed다.
        return new Promise<"elapsed" | "aborted">((resolve) => {
          setTimeout(
            () => resolve(signal.aborted ? "aborted" : "elapsed"),
            Math.min(ms, 1_000),
          );
        });
      },
    });
    try {
      const stalled = await timed.acquire(
        "assignment-1",
        server,
        new AbortController().signal,
      );
      assert(stalled.ok);
      // silent-call 모드 child는 tools/call에 답하지 않는다. 기한이 지나 uncertain이다.
      const silent = stdioServer();
      silent.stdio.args = [
        "-c",
        `deno run --allow-read --allow-env ${childPath} silent-call`,
      ];
      const silentAcquired = await timed.acquire(
        "assignment-2",
        silent,
        new AbortController().signal,
      );
      assert(silentAcquired.ok);
      const outcome = await timed.call(
        "assignment-2",
        "notes",
        "a",
        {},
        new AbortController().signal,
        60_000,
      );
      assertEquals(outcome.kind, "uncertain");
    } finally {
      await timed.endAll();
    }
  } finally {
    await conns.endAll();
  }
});

Deno.test("lophn-agent/extensions#R20: 재연결은 1·2·4초 세 번이고 auth 거절은 재연결하지 않는다", async () => {
  childPath = childPath ?? await writeChild();
  // 대기 시각을 기록하는 wait다(R20).
  const waits: number[] = [];
  const conns = createMcpConnections({
    ...connectionsDeps(childPath),
    wait: (ms) => {
      waits.push(ms);
      return Promise.resolve("elapsed" as const);
    },
  });
  try {
    // 일부러 시작하지 못하는 executable이다(끊김 다시 연결 경로).
    const dead = stdioServer();
    dead.stdio.executable = "/nonexistent/lophn-fake";
    dead.stdio.args = [];
    const failed = await conns.acquire(
      "assignment-1",
      dead,
      new AbortController().signal,
    );
    assert(!failed.ok);
    // 대기가 1초·2초·4초로 늘어난다(R20). 재연결은 세 번이고 네 번째는
    // 시도조차 하지 않는다.
    const first = await conns.reconnect("assignment-1", "notes");
    assert(!first.ok || first.ok);
    await conns.reconnect("assignment-1", "notes");
    await conns.reconnect("assignment-1", "notes");
    const refused = await conns.reconnect("assignment-1", "notes");
    assert(!refused.ok, "재연결 한도를 넘었다");
    assertEquals(
      waits,
      [...RECONNECT_DELAYS_MS],
      "재연결 대기는 1·2·4초다(R20)",
    );
    // auth 거절은 실패한 연결로 본다. HTTP 401을 말하는 transport 실패다(R20).
    const connsAuth = createMcpConnections({
      ...connectionsDeps(childPath),
      openStdio: () =>
        Promise.resolve(
          err({ code: "forbidden", message: "서버가 401로 답했다" }),
        ),
    });
    try {
      const authServer = stdioServer();
      const authAcquire = await connsAuth.acquire(
        "assignment-1",
        authServer,
        new AbortController().signal,
      );
      assert(!authAcquire.ok);
      const view = connsAuth.views()[0];
      assertEquals(view.state, "failed_auth");
      // auth 거절 연결의 재연결은 거절이다(R20: 자동 재연결 없음).
      const refused = await connsAuth.reconnect("assignment-1", "notes");
      assert(!refused.ok);
      assertEquals(refused.error.code, "forbidden");
      // 아직 실패한 연결의 call은 재전송이 아니라 no_connection이다(R20).
      const outcome = await connsAuth.call(
        "assignment-1",
        "notes",
        "a",
        {},
        new AbortController().signal,
        60_000,
      );
      assertEquals(outcome.kind, "no_connection");
    } finally {
      await connsAuth.endAll();
    }
  } finally {
    await conns.endAll();
  }
});

Deno.test("lophn-agent/extensions#R21: detach는 새 call 차단→cancel→close·stdio 5초 뒤 kill이다", async () => {
  childPath = childPath ?? await writeChild();
  const conns = createMcpConnections(connectionsDeps(childPath));
  try {
    const silent = stdioServer();
    silent.stdio.args = [
      "-c",
      `deno run --allow-read --allow-env ${childPath} silent-call`,
    ];
    const acquired = await conns.acquire(
      "assignment-1",
      silent,
      new AbortController().signal,
    );
    assert(
      acquired.ok,
      `acquire 실패: ${acquired.ok ? "" : acquired.error.message}`,
    );
    // 응답이 없는 call을 진행 중으로 둔다(R21: cancel 대상).
    const pendingCall = conns.call(
      "assignment-1",
      "notes",
      "a",
      {},
      new AbortController().signal,
      600_000,
    );
    // detach다. 새 call은 막히고 진행 call은 취소된다(R21).
    await conns.detach("assignment-1", "notes");
    const blocked = await conns.call(
      "assignment-1",
      "notes",
      "a",
      {},
      new AbortController().signal,
      60_000,
    );
    assertEquals(blocked.kind, "not_executed");
    if (blocked.kind === "not_executed") {
      assertEquals(blocked.code, "configuration_revoked");
    }
    // 진행 중이던 call은 uncertain으로 끝난다(취소는 서버에 요청했다).
    const pendingOutcome = await pendingCall;
    assertEquals(pendingOutcome.kind, "uncertain");
    // views는 disconnected다(R21: 닫았다).
    const view = conns.views().find((entry) =>
      entry.owner[0] === "assignment-1"
    );
    assertEquals(view?.state, "disconnected");
  } finally {
    await conns.endAll();
  }
  // 5초 뒤 kill이다: close()가 stdin을 닫고 grace를 기다린 뒤 SIGKILL이다.
  // grace 값은 STDIO_KILL_GRACE_MS다.
  assertEquals(STDIO_KILL_GRACE_MS, 5_000);
});

Deno.test("lophn-agent/extensions#R22: 모든 page 검증 뒤에만 목록을 주고 잘못이면 전체 미제공이다", async () => {
  childPath = childPath ?? await writeChild();
  const conns = createMcpConnections(connectionsDeps(childPath));
  try {
    // 여러 page가 모두 검증을 지나면 목록 전체가 온다(R22).
    const server = stdioServer();
    server.stdio.args = [
      "-c",
      `deno run --allow-read --allow-env ${childPath} many-pages`,
    ];
    const acquired = await conns.acquire(
      "assignment-1",
      server,
      new AbortController().signal,
    );
    assert(acquired.ok);
    const good = await conns.toolList("assignment-1", "notes");
    assert(good.ok, `toolList 실패: ${good.ok ? "" : good.error.message}`);
    assertEquals(
      good.value.tools.map((tool) => tool.original),
      ["t0", "t1", "t2", "t3"],
    );
    assertEquals(good.value.hash.length, 64);
    await conns.detach("assignment-1", "notes");
    // 반복 cursor면 목록 전체를 내지 않는다(R22).
    const loop = stdioServer();
    loop.stdio.args = [
      "-c",
      `deno run --allow-read --allow-env ${childPath} repeated-cursor`,
    ];
    const loopAcquired = await conns.acquire(
      "assignment-2",
      loop,
      new AbortController().signal,
    );
    assert(loopAcquired.ok);
    const repeated = await conns.toolList("assignment-2", "notes");
    assert(!repeated.ok, "반복 cursor가 통과됐다");
    await conns.detach("assignment-2", "notes");
    // 중복 원래 이름이면 목록 전체를 내지 않는다(R22).
    const dup = stdioServer();
    dup.stdio.args = [
      "-c",
      `deno run --allow-read --allow-env ${childPath} duplicate`,
    ];
    const dupAcquired = await conns.acquire(
      "assignment-3",
      dup,
      new AbortController().signal,
    );
    assert(dupAcquired.ok);
    const duplicate = await conns.toolList("assignment-3", "notes");
    assert(!duplicate.ok, "중복 이름이 통과됐다");
    await conns.detach("assignment-3", "notes");
    // 잘못된 schema가 하나면 목록 전체를 내지 않는다(R22).
    const bad = stdioServer();
    bad.stdio.args = [
      "-c",
      `deno run --allow-read --allow-env ${childPath} bad-schema`,
    ];
    const badAcquired = await conns.acquire(
      "assignment-4",
      bad,
      new AbortController().signal,
    );
    assert(badAcquired.ok);
    const invalid = await conns.toolList("assignment-4", "notes");
    assert(!invalid.ok, "잘못된 schema가 통과됐다");
    await conns.detach("assignment-4", "notes");
    // tool이 없는 server는 도구 0개다. 오류가 아니다(R22).
    const empty = stdioServer();
    empty.stdio.args = [
      "-c",
      `deno run --allow-read --allow-env ${childPath} no-tools-capability`,
    ];
    const emptyAcquired = await conns.acquire(
      "assignment-5",
      empty,
      new AbortController().signal,
    );
    assert(emptyAcquired.ok);
    const none = await conns.toolList("assignment-5", "notes");
    assert(
      none.ok,
      `tool 없는 server가 실패했다: ${none.ok ? "" : none.error.message}`,
    );
    assertEquals(none.value.tools.length, 0);
  } finally {
    await conns.endAll();
  }
  // 상한 값이다(질문 Q14).
  assertEquals(LIST_PAGE_MAX, 100);
  assertEquals(LIST_TOOLS_MAX, 2048);
  assertEquals(LIST_BYTES_MAX, 10 * 1024 * 1024);
  assertEquals(SCHEMA_DEPTH_MAX, 32);
  assertEquals(STDERR_MAX_BYTES, 64 * 1024);
});

Deno.test("lophn-agent/extensions#R25: 서버의 reverse 요청에 -32601로 답하고 capabilities는 비어 있다", async () => {
  childPath = childPath ?? await writeChild();
  const conns = createMcpConnections(connectionsDeps(childPath));
  try {
    const reverse = stdioServer();
    reverse.stdio.args = [
      "-c",
      `deno run --allow-read --allow-env ${childPath} reverse`,
    ];
    const acquired = await conns.acquire(
      "assignment-1",
      reverse,
      new AbortController().signal,
    );
    assert(
      acquired.ok,
      `acquire 실패: ${acquired.ok ? "" : acquired.error.message}`,
    );
    // 등록 기능 요청(logging/setLevel)은 -32601로 답한다(fake child가 그렇다).
    // transport의 reverse stream은 비어 있지 않을 수 있으므로 읽지 않고 닫는다.
    const list = await conns.toolList("assignment-1", "notes");
    assert(list.ok, `toolList 실패: ${list.ok ? "" : list.error.message}`);
  } finally {
    await conns.endAll();
  }
  // initialize capabilities는 비어 있다(R25: sampling·elicitation·roots 미지원).
  const body = initializeBody();
  assertEquals(
    (body.params as Record<string, unknown>)["capabilities"],
    {},
  );
  const reply = unsupportedReverseResponse(7);
  assertEquals(reply, {
    jsonrpc: "2.0",
    id: 7,
    error: { code: -32601, message: "method not found" },
  });
});
