// app command 표 테스트다(T21, cli#R1, R7, R24–R28, R31, R32). 표가 MCP와 같은 소유 route를
// 가리키는지, 사람 전용 command가 route 없이 링크만 내는지, 같은 입력의 실행이 MCP tool과
// 같은 요청·결과인지 본다. core 대신 route별 답을 정한 흐름 client를 쓴다.
import { assert, assertEquals } from "@std/assert";
import { ok } from "../../../base/mod.ts";
import { APP_OP_ROUTES } from "../../connection/mod.ts";
import { scriptedFlow } from "../../connection/testing/mod.ts";
import { COMMANDS, findCommand } from "../registry.ts";
import { APP_COMMANDS, appOpInput, CLI_APP_OPS, runApp } from "./app.ts";

const APP = "app_01arz3ndektsv4rrffq69g5fav";
const HASH = "a".repeat(64);
const COMMIT = "c".repeat(40);

function entry(name: string) {
  const found = findCommand(name);
  if (!found) throw new Error(name);
  return found;
}

const deps = { idempotencyKey: () => "key-0123456789" };

Deno.test("coding-agent/cli#R24: app command 21개가 표에 이름 그대로 있고 route는 MCP와 같은 소유 route다", () => {
  assertEquals(APP_COMMANDS.length, 21);
  for (const item of APP_COMMANDS) {
    assert(COMMANDS.includes(item), item.name);
  }
  // 표의 route는 connection이 공유하는 op route 표 값이다(MCP와 같은 표).
  for (const [name, op] of Object.entries(CLI_APP_OPS)) {
    assertEquals(entry(name).monoRoute, APP_OP_ROUTES[op], name);
  }
  assertEquals(entry("app list").monoRoute?.name, "app.list");
  assertEquals(entry("app test").monoRoute?.name, "RequestTest");
  assertEquals(entry("app preview start").monoRoute?.name, "previews.start");
  assertEquals(
    entry("app release prepare").monoRoute?.name,
    "release.prepare_bundle",
  );
});

Deno.test("coding-agent/cli#R7: 사람 전용 앱 command는 route가 없다", () => {
  for (
    const name of [
      "app start",
      "app stop",
      "app release activate",
      "app automation run",
    ]
  ) {
    const found = entry(name);
    assertEquals(found.monoRoute, undefined, name);
    assertEquals(found.opRoutes, undefined, name);
  }
  // 승인·옵션으로 활성화하는 별칭이 없다.
  for (
    const name of [
      "app activate",
      "app release activate --yes",
      "app approve",
      "app delete",
      "app archive",
      "app grant",
    ]
  ) {
    assertEquals(findCommand(name), undefined, name);
  }
});

Deno.test("coding-agent/cli#R1: 공통 option은 core 입력에서 떼고 소유 field는 남긴다", () => {
  assertEquals(
    appOpInput("app logs", {
      command: "app logs",
      json: true,
      connection: "cac_01arz3ndektsv4rrffq69g5fav",
      daemon_url: "http://127.0.0.1:7431",
      app: APP,
      limit: 5,
      idempotency_key: "k",
    }),
    { op: "logs", app: APP, limit: 5 },
  );
  // preview의 `input`은 공통 입력 source가 아니라 소유 field다.
  assertEquals(
    appOpInput("app preview start", {
      command: "app preview start",
      input: { app: APP, bundle_hash: HASH, release: null, fixture_hash: null },
    }),
    {
      op: "preview_start",
      input: { app: APP, bundle_hash: HASH, release: null, fixture_hash: null },
    },
  );
});

Deno.test("coding-agent/cli#R24: app path는 source 위치만 읽고 미연결은 없는 이유를 낸다", async () => {
  const app = (source: string | null) => ({
    app: { id: APP, slug: "notes", source_path: source, revision: "1" },
  });
  const linked = scriptedFlow({ "app.get": app("/w/notes") });
  const done = await runApp("app path", { command: "app path", app: APP }, {
    client: linked.client,
    ...deps,
  });
  assert(done.ok);
  assertEquals(done.value.data, { app: APP, source_path: "/w/notes" });
  const none = scriptedFlow({ "app.get": app(null) });
  const missing = await runApp("app path", { command: "app path", app: APP }, {
    client: none.client,
    ...deps,
  });
  assert(missing.ok);
  assertEquals(missing.value.summary, "source 미연결");
});

Deno.test("coding-agent/cli#R7: app start·stop·release activate는 결정 화면 링크만 내고 core에 닿지 않는다", async () => {
  const flow = scriptedFlow({});
  for (
    const name of ["app start", "app stop", "app release activate"] as const
  ) {
    const done = await runApp(name, { command: name, app: APP }, {
      client: flow.client,
      ...deps,
    });
    assert(done.ok);
    assertEquals(done.value.isError, true);
    const data = done.value.data as {
      decision_link: string;
      window_opened: boolean;
    };
    assertEquals(data.decision_link, `lophn://things-to-confirm/${APP}`);
    assertEquals(data.window_opened, false);
  }
  assertEquals(flow.sent.length, 0);
});

const TEST_FIELDS = {
  kind: "app_test",
  app: APP,
  target: { bundle_hash: HASH, release: null },
  problem: null,
  basis_seq: null,
  reports: [],
  before: null,
  after: null,
  ticket: null,
  test: "b".repeat(64),
  request_key: "req-test-0123456789",
};

Deno.test("coding-agent/cli#R29: app sync-tools는 검사한 op 입력을 지정 sync port에 넘겨 실행하고 결과를 요약에 담는다", async () => {
  const target = {
    scope_kind: "app",
    environment: { kind: "host", identity: "native" },
    profile_id: null,
    harness_id: "claude",
    app: APP,
    app_realpath: "/w/notes",
  };
  const seen: Record<string, unknown>[] = [];
  const flow = scriptedFlow({});
  const done = await runApp("app sync-tools", {
    command: "app sync-tools",
    app: APP,
    target,
  }, {
    client: flow.client,
    ...deps,
    sync: (opInput) => {
      seen.push(opInput);
      return Promise.resolve(ok({
        status: "complete",
        files: [{
          target: "mcp",
          name: "mcp:app",
          outcome: "changed",
          reason: "MCP 설정을 썼다",
        }],
        notices: [],
      }));
    },
  });
  assert(done.ok);
  assertEquals(done.value.isError, undefined);
  assert(done.value.summary.includes("도구 재배포를 마쳤다"));
  const files = (done.value.data as { files: unknown[] }).files;
  assertEquals(files.length, 1);
  // op는 떼어 보낸다(withoutOp). target·names는 그대로 온다.
  assertEquals(seen[0].op, undefined);
  assertEquals(seen[0].target, target);
  assertEquals(flow.sent.length, 0);
});

Deno.test("coding-agent/cli#R29: sync port가 없는 process의 app sync-tools는 unavailable이다", async () => {
  const flow = scriptedFlow({});
  const done = await runApp("app sync-tools", {
    command: "app sync-tools",
    app: APP,
    target: {
      scope_kind: "app",
      environment: { kind: "host", identity: "native" },
      profile_id: null,
      harness_id: "claude",
      app: APP,
      app_realpath: "/w/notes",
    },
  }, { client: flow.client, ...deps });
  assert(done.ok);
  assertEquals(done.value.isError, true);
  assertEquals((done.value.data as { code: string }).code, "unavailable");
  assertEquals(flow.sent.length, 0);
});

Deno.test("coding-agent/cli#R29: app sync-tools는 같은 입력을 두 번 실행해도 중복 항목이 없다(complete twice)", async () => {
  const target = {
    scope_kind: "app",
    environment: { kind: "host", identity: "native" },
    profile_id: null,
    harness_id: "claude",
    app: APP,
    app_realpath: "/w/notes",
  };
  const first = await runApp("app sync-tools", {
    command: "app sync-tools",
    app: APP,
    target,
  }, {
    client: scriptedFlow({}).client,
    ...deps,
    sync: () =>
      Promise.resolve(ok({
        status: "complete",
        files: [
          {
            target: "mcp",
            name: "mcp:app",
            outcome: "unchanged",
            reason: "이미 같다",
          },
          {
            target: "skill",
            name: "skill:app:lophn-save",
            outcome: "unchanged",
            reason: "이미 같다",
          },
        ],
        notices: [],
      })),
  });
  const second = await runApp("app sync-tools", {
    command: "app sync-tools",
    app: APP,
    target,
  }, {
    client: scriptedFlow({}).client,
    ...deps,
    sync: () =>
      Promise.resolve(ok({
        status: "complete",
        files: [
          {
            target: "mcp",
            name: "mcp:app",
            outcome: "unchanged",
            reason: "이미 같다",
          },
          {
            target: "skill",
            name: "skill:app:lophn-save",
            outcome: "unchanged",
            reason: "이미 같다",
          },
        ],
        notices: [],
      })),
  });
  assert(first.ok && second.ok);
  const one = (first.value.data as { files: { name: string }[] }).files;
  const two = (second.value.data as { files: { name: string }[] }).files;
  assertEquals(one.length, two.length);
  assertEquals(new Set(one.map((f) => f.name)).size, one.length);
  assertEquals(new Set(two.map((f) => f.name)).size, two.length);
});

Deno.test("coding-agent/cli#R26: 실패한 검사는 성공 exit로 처리되지 않는 isError다", async () => {
  const flow = scriptedFlow({
    RequestTest: {
      request_key: "req-test-0123456789",
      accepted: true,
      result_ref: "vrf_01arz3ndektsv4rrffq69g5fav",
    },
    GetVerification: {
      verification: {
        id: "vrf_01arz3ndektsv4rrffq69g5fav",
        kind: "app_test",
        target: { bundle_hash: HASH, release: null },
        result: "fail",
        reason: "check 1",
      },
    },
  });
  const done = await runApp(
    "app test",
    { command: "app test", ...TEST_FIELDS },
    {
      client: flow.client,
      ...deps,
    },
  );
  assert(done.ok);
  assertEquals(done.value.isError, true);
  assertEquals(
    (done.value.data as { state: string }).state,
    "fail",
  );
});

Deno.test("coding-agent/cli#R28: release prepare는 ticket 출처 없이 실행하지 않는다", async () => {
  const flow = scriptedFlow({});
  const input = {
    command: "app release prepare",
    app: APP,
    commit: COMMIT,
    request_key: "req-1",
  };
  const parsed = entry("app release prepare").input.safeParse(input);
  assert(parsed.success);
  const done = await runApp(
    "app release prepare",
    parsed.data as Record<string, unknown>,
    { client: flow.client, ...deps },
  );
  assert(done.ok);
  assertEquals(done.value.isError, true);
  assertEquals(flow.sent.length, 0);
});

Deno.test("coding-agent/cli#R31: app command는 name·환경·timeout·입력 JSON을 MCP command op 입력으로 옮긴다", () => {
  const parsed = entry("app command").input.safeParse({
    command: "app command",
    app: APP,
    name: "usage.read",
    environment: "live",
    timeout_ms: 5_000,
    input: '{"month":10}',
  });
  assert(parsed.success);
  assertEquals(
    appOpInput("app command", parsed.data as Record<string, unknown>),
    {
      op: "command",
      app: APP,
      command: "usage.read",
      environment: "live",
      timeout_ms: 5_000,
    },
  );
});

Deno.test("coding-agent/cli#R31: app command의 입력 JSON이 깨졌으면 앱 통로에 가지 않고 거절한다", async () => {
  const flow = scriptedFlow({});
  const done = await runApp("app command", {
    command: "app command",
    app: APP,
    name: "usage.read",
    input: "{broken",
  }, { client: flow.client, ...deps });
  assert(!done.ok);
  assertEquals(done.error.code, "invalid_input");
  assertEquals(flow.sent.length, 0);
});
