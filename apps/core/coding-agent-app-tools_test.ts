// coding-agent#T21 끝에서 끝까지: coding agent가 MCP tool `lophn_app`으로 앱을 등록하고 source를
// 연결하고 읽는다. core는 실제 자식 프로세스이고 tools/call은 실제 MCP handler와 core client를
// 지나므로 입력 검사·actor·scope 판정이 그대로 응답에 닿는다. 앱 하나 범위 연결과 전체 범위
// 연결의 credential은 platform 인증 context의 모양(conditions.app)으로 직접 만든다(실제 발급은
// coding-agent#T36). 데이터 root·작업 폴더는 temp dir이고 사람 데이터 root는 열지 않는다.
// 아직 core가 서빙하지 않는 route(preview·release 준비)는 성공으로 꾸미지 않고 실패로 읽힌다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import type { AuthenticatedContext } from "../../packages/protocol/server/mod.ts";
import { createCoreClient } from "../../packages/coding-agent/connection/client/core.ts";
import { createHandler } from "../../packages/coding-agent/mcp-server/server.ts";
import { resolveRoute } from "../../packages/coding-agent/mcp-server/registry.ts";
import { createAppTool } from "../../packages/coding-agent/mcp-server/tools/app.ts";
import { type Core, startCore } from "./core.ts";
import type { TeamModule } from "./registration.ts";
import { createLedgerRegistration } from "./documents.ts";
import { createLedgerRegistration as createAppsRegistration } from "./apps.ts";

const teams: TeamModule[] = [
  { createLedgerRegistration },
  { createLedgerRegistration: createAppsRegistration },
];
const CAC = "cac_01arz3ndektsv4rrffq69g5fav";
const CAC_SCOPED = "cac_01arz3ndektsv4rrffq69g5faw";
const ALL_TOKEN = "a".repeat(43);
const SCOPED_TOKEN = "b".repeat(43);
const ABSENT = "app_01arz3ndektsv4rrffq69g5fb9";
const OPERATIONS = [
  "app.create",
  "app.connect_source",
  "app.list",
  "app.get",
  "app.runtime",
  "app.logs",
  "invocations.list",
  "invocations.get",
  "previews.get",
];

type Reply = {
  isError: boolean;
  summary: string;
  data: Record<string, unknown>;
  next: string[];
};

type Opened = {
  core: Core;
  call(
    who: "all" | "scoped",
    args: Record<string, unknown>,
  ): Promise<Reply>;
  scope(app: string): Promise<void>;
  work: string;
  dispose(): Promise<void>;
};

async function open(): Promise<Opened> {
  const home = await Deno.makeTempDir({ prefix: "lophn-app-tools-" });
  const work = await Deno.realPath(
    await Deno.makeTempDir({ prefix: "lophn-app-tools-work-" }),
  );
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams,
    teamModules: [
      new URL("./documents.ts", import.meta.url).href,
      new URL("./apps.ts", import.meta.url).href,
    ],
    clock: manualClock(Date.UTC(2024, 0, 1)),
    random: seededRandom(71),
    testCredentials: true,
  });
  assert(started.ok, started.ok ? "" : started.error.message);
  const core = started.value;
  async function accept(
    credential: string,
    token: string,
    // 앱 하나 범위 연결은 target과 조건이 같은 앱을 가리킨다.
    app?: string,
  ) {
    const cac = app === undefined ? CAC : CAC_SCOPED;
    const context: AuthenticatedContext = {
      principal: `coding_agent:${cac}`,
      actor: `coding_agent:${cac}`,
      scope: {
        operations: OPERATIONS,
        targets: app === undefined ? {} : { app },
      },
      conditions: app === undefined ? {} : { app },
      credential_ref: credential,
    };
    const accepted = await core.acceptTestCredential?.(context, token);
    assert(accepted?.ok);
    const recorded = await core.record(context);
    assert(recorded.ok);
  }
  await accept("cred-all", ALL_TOKEN);
  const handlers = new Map<string, ReturnType<typeof createHandler>>();
  function handlerFor(token: string) {
    const existing = handlers.get(token);
    if (existing !== undefined) return existing;
    const client = createCoreClient({
      baseUrl: `http://127.0.0.1:${core.port}`,
      connection: CAC,
      provider: () => Promise.resolve({ ok: true, value: { token } }),
    });
    const tool = createAppTool({
      client,
      idempotencyKey: () => `app-tools-${crypto.randomUUID()}`,
      wait: { budget_ms: 0, interval_ms: 1 },
    });
    const handler = createHandler({
      toolsets: ["core", "app"],
      callTool: (name, args, context) => {
        const resolved = resolveRoute(name, (args as { op?: string }).op);
        assert(resolved, `route ${name}`);
        return tool(name, resolved.route, args, context);
      },
    });
    handlers.set(token, handler);
    return handler;
  }
  let id = 0;
  return {
    core,
    work,
    async scope(app) {
      await accept("cred-scoped", SCOPED_TOKEN, app);
    },
    async call(who, args) {
      id += 1;
      const response = await handlerFor(
        who === "all" ? ALL_TOKEN : SCOPED_TOKEN,
      )(
        JSON.stringify({
          jsonrpc: "2.0",
          id,
          method: "tools/call",
          params: { name: "lophn_app", arguments: args },
        }),
      );
      assert(response !== undefined);
      assertEquals(response.error, undefined, JSON.stringify(response));
      const result = response.result as {
        isError?: boolean;
        structuredContent: { summary: string; data: unknown; next: string[] };
      };
      return {
        isError: result.isError === true,
        summary: result.structuredContent.summary,
        data: result.structuredContent.data as Record<string, unknown>,
        next: result.structuredContent.next,
      };
    },
    async dispose() {
      await core.shutdown();
      await Deno.remove(home, { recursive: true });
      await Deno.remove(work, { recursive: true });
    },
  };
}

async function register(opened: Opened, slug: string): Promise<string> {
  const done = await opened.call("all", {
    op: "register",
    slug,
    name: slug,
    description: "메모 앱",
  });
  assertEquals(done.isError, false, done.summary);
  return (done.data as { id: string }).id;
}

Deno.test("coding-agent/cli#R25, coding-agent/connection#R4: 전체 범위 연결은 앱을 가볍게 등록하고 앱 하나 범위 연결의 등록은 거절된다", async () => {
  const opened = await open();
  try {
    const first = await opened.call("all", {
      op: "register",
      slug: "notes",
      name: "Notes",
      description: "메모 앱",
    });
    assertEquals(first.isError, false, first.summary);
    const app = first.data as {
      id: string;
      source_path: string | null;
      active_release: string | null;
      run_enabled: boolean;
    };
    // 등록은 code·source·release 없이 성공하고 실행 허가 단계가 생기지 않는다.
    assertEquals(app.source_path, null);
    assertEquals(app.active_release, null);
    assertEquals(app.run_enabled, false);
    assert(first.next[0].includes("source"));

    await opened.scope(app.id);
    const denied = await opened.call("scoped", {
      op: "register",
      slug: "second",
      name: "Second",
      description: "두 번째",
    });
    assertEquals(denied.isError, true);
    assertEquals(denied.data.code, "forbidden");
    assert(denied.next[0].includes("전체 범위 연결"));
    // 거절된 등록은 앱을 만들지 않았다.
    const listed = await opened.call("all", { op: "list" });
    assertEquals((listed.data.apps as unknown[]).length, 1);
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/cli#R25: source 연결은 등록과 따로이고 앱 하나 범위 연결이 자기 앱에 연결한다", async () => {
  const opened = await open();
  try {
    const own = await register(opened, "notes");
    await opened.scope(own);
    const folder = `${opened.work}/notes-source`;
    await Deno.mkdir(folder);
    const linked = await opened.call("scoped", {
      op: "source",
      app: own,
      source_path: folder,
    });
    assertEquals(linked.isError, false, linked.summary);
    assertEquals((linked.data as { source_path: string }).source_path, folder);
    const shown = await opened.call("scoped", { op: "show", app: own });
    assert(shown.summary.includes("source 연결됨"));
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R32: 호출 이력은 한 번에 최대 20개이고 기록이 없으면 빈 목록이다", async () => {
  const opened = await open();
  try {
    const app = await register(opened, "notes");
    const done = await opened.call("all", {
      op: "invocations",
      app,
      limit: 20,
    });
    assertEquals(done.isError, false, done.summary);
    assertEquals(done.data.invocations, []);
    const wide = await opened.call("all", {
      op: "invocations",
      app,
      limit: 21,
    });
    assertEquals(wide.isError, true);
    assertEquals(wide.data.code, "invalid_input");
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/mcp-server#R19: core가 아직 서빙하지 않는 준비 route는 성공으로 꾸미지 않고 실패로 읽힌다", async () => {
  const opened = await open();
  try {
    const app = await register(opened, "notes");
    const validate = await opened.call("all", {
      op: "validate",
      app,
      commit: "c".repeat(40),
      request_key: "req-1",
    });
    assertEquals(validate.isError, true);
    const status = await opened.call("all", { op: "status", app });
    // preview 상태를 읽지 못해도 운영 상태·source는 읽힌다.
    assertEquals(status.isError, false, status.summary);
    assert(status.summary.includes("active release 없음"));
  } finally {
    await opened.dispose();
  }
});

Deno.test("coding-agent/connection#R5, coding-agent/connection#R6: 앱 하나 범위 연결에서 다른 앱은 없는 앱과 같은 응답이고 목록에는 자기 앱만 있다", async () => {
  const opened = await open();
  try {
    const own = await register(opened, "notes");
    const other = await register(opened, "other");
    await opened.scope(own);
    const listed = await opened.call("scoped", { op: "list" });
    assertEquals(
      (listed.data.apps as { id: string }[]).map((app) => app.id),
      [own],
    );
    const folder = `${opened.work}/foreign-source`;
    await Deno.mkdir(folder);
    // op table이 닿는 앱 route마다 다른 앱과 없는 앱의 응답이 같다.
    const cases: Record<string, unknown>[] = [
      { op: "show" },
      { op: "status" },
      { op: "logs" },
      { op: "invocations" },
      { op: "source", source_path: folder },
    ];
    for (const extra of cases) {
      const foreign = await opened.call("scoped", { ...extra, app: other });
      const absent = await opened.call("scoped", { ...extra, app: ABSENT });
      assertEquals(foreign.isError, absent.isError, String(extra.op));
      assertEquals(foreign.summary, absent.summary, String(extra.op));
      assertEquals(foreign.data, absent.data, String(extra.op));
    }
    // 같은 앱 source 연결은 된다. 다른 앱의 source는 연결되지 않았다.
    const linked = await opened.call("scoped", {
      op: "source",
      app: own,
      source_path: folder,
    });
    assertEquals(linked.isError, false, linked.summary);
    const check = await opened.call("all", { op: "show", app: other });
    assert(check.summary.includes("source 미연결"));
    const invocation = await opened.call("scoped", {
      op: "invocation",
      invocation: "inv_01arz3ndektsv4rrffq69g5fav",
    });
    assertEquals(invocation.isError, true);
  } finally {
    await opened.dispose();
  }
});
