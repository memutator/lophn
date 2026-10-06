import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type CallResult,
  type ConnectTarget,
  createAppConnector,
} from "./app-connection.ts";

const APP = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const REL = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";
const REL_2 = "rel_01j9zzzzzzzzzzzzzzzzzzzzz2";
const HASH = "a".repeat(64);
const LIVE: ConnectTarget = {
  app: APP,
  mode: "live",
  release: REL,
  screen: "main",
  size: "panel",
};

function connection(overrides: Record<string, unknown> = {}) {
  return {
    app: APP,
    release: REL,
    bundle_hash: HASH,
    mode: "live",
    process_nonce: "nonce-1",
    actor: "user",
    credential_ref: "cred-1",
    screens: ["main"],
    screen_sizes: { main: ["panel"] },
    caller: null,
    commands: [],
    expires_at: "2026-10-06T00:10:00.000Z",
    ...overrides,
  };
}

function core(replies: Record<string, (body: unknown) => CallResult>) {
  const calls: { name: string; body: unknown }[] = [];
  const call = (
    kind: string,
    resource: string,
    method: string,
    body: unknown,
  ) => {
    const name = `${kind}:${resource}/${method}`;
    calls.push({ name, body });
    const reply = replies[name];
    return Promise.resolve(
      reply === undefined
        ? { ok: false as const, error: { code: "forbidden", message: "no" } }
        : reply(body),
    );
  };
  return { calls, connector: createAppConnector(call) };
}

const signed = (value: unknown): CallResult => ({
  ok: true,
  value: {
    endpoint: "/run/a.sock",
    connection: value,
    signature: "s".repeat(86),
  },
});

test("shell/app-frame#R12, shell/app-frame#R20: main이 앱 통로에 screen·size만 요청하고 command 범위 없이 서명된 연결을 그대로 Authorization에 싣는다", async () => {
  const { calls, connector } = core({
    "memory:apps/connect": () => signed(connection()),
  });
  const result = await connector.connect(LIVE);
  assert.equal(result.ok, true);
  assert.deepEqual(calls, [{
    name: "memory:apps/connect",
    body: {
      app: APP,
      mode: "live",
      screens: ["main"],
      screen_sizes: { main: ["panel"] },
      commands: [],
    },
  }]);
  const binding = (result as { ok: true; value: { authorization: string } })
    .value;
  assert.deepEqual(JSON.parse(binding.authorization), {
    payload: connection(),
    signature: "s".repeat(86),
  });
  assert.deepEqual({ ...binding, authorization: undefined }, {
    endpoint: "/run/a.sock",
    authorization: undefined,
    release: REL,
    bundleHash: HASH,
    processNonce: "nonce-1",
    expiresAtMs: Date.parse("2026-10-06T00:10:00.000Z"),
  });
});

test("shell/app-frame#R12: 다른 앱·mode·옛 release·없는 screen size의 연결은 받지 않는다", async () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ app: "app_01j9yyyyyyyyyyyyyyyyyyyyyy" }, "unavailable"],
    [{ mode: "preview" }, "unavailable"],
    [{ release: REL_2 }, "conflict"],
    [{ screens: [] }, "forbidden"],
    [{ screen_sizes: { main: ["full"] } }, "forbidden"],
    [{ bundle_hash: "nothex" }, "unavailable"],
  ];
  for (const [overrides, code] of cases) {
    const { connector } = core({
      "memory:apps/connect": () => signed(connection(overrides)),
    });
    const result = await connector.connect(LIVE);
    assert.equal(result.ok, false, JSON.stringify(overrides));
    assert.equal((result as { error: { code: string } }).error.code, code);
  }
  // 갱신은 지금 채택된 release를 받아들인다.
  const { connector } = core({
    "memory:apps/connect": () => signed(connection({ release: REL_2 })),
  });
  const followed = await connector.connect(LIVE, true);
  assert.equal(followed.ok, true);
  assert.equal(
    (followed as { ok: true; value: { release: string } }).value.release,
    REL_2,
  );
});

test("shell/app-frame#R1: preview는 main이 읽은 지금 preview 프로세스의 nonce로 연결하고 bundle이 다르면 받지 않는다", async () => {
  const observation = {
    app: APP,
    release: null,
    bundle_hash: HASH,
    mode: "preview",
    process_nonce: "preview-1",
    endpoint: "/run/p.sock",
    ready: true,
    accepting: false,
  };
  const preview = (overrides: Record<string, unknown> = {}) =>
    connection({
      mode: "preview",
      release: null,
      process_nonce: "preview-1",
      ...overrides,
    });
  const target: ConnectTarget = { ...LIVE, mode: "preview", release: null };
  const { calls, connector } = core({
    "read:previews/get": () => ({ ok: true, value: { observation } }),
    "memory:apps/connect": () => signed(preview()),
  });
  assert.equal((await connector.connect(target)).ok, true);
  assert.deepEqual(calls.map((call) => call.name), [
    "read:previews/get",
    "memory:apps/connect",
  ]);
  assert.equal(
    (calls[1]!.body as { preview_nonce: string }).preview_nonce,
    "preview-1",
  );
  const other = core({
    "read:previews/get": () => ({ ok: true, value: { observation } }),
    "memory:apps/connect": () =>
      signed(preview({ bundle_hash: "b".repeat(64) })),
  });
  const changed = await other.connector.connect(target);
  assert.equal((changed as { error: { code: string } }).error.code, "conflict");
  const stopped = core({
    "read:previews/get": () => ({ ok: true, value: { observation: null } }),
  });
  const none = await stopped.connector.connect(target);
  assert.equal((none as { error: { code: string } }).error.code, "unavailable");
  assert.deepEqual(stopped.calls.map((call) => call.name), [
    "read:previews/get",
  ]);
});

test("shell/app-frame#R12: 없는 앱과 범위 밖 앱은 같은 unavailable이고 core가 준 그 밖의 오류도 화면 틀 오류로 좁힌다", async () => {
  for (
    const [code, expected] of [
      ["not_found", "unavailable"],
      ["unauthorized", "unavailable"],
      ["internal", "unavailable"],
      ["forbidden", "forbidden"],
      ["invalid_input", "invalid_input"],
    ]
  ) {
    const { connector } = core({
      "memory:apps/connect": () => ({
        ok: false,
        error: { code: code!, message: "x" },
      }),
    });
    const result = await connector.connect(LIVE);
    assert.equal((result as { error: { code: string } }).error.code, expected);
  }
});

test("shell/app-frame#R16: fetch host는 active net.fetch grant이고 지금 release 선언과 같은 scope만 남기며 읽지 못하면 아무것도 열지 않는다", async () => {
  const grant = (host: string, port: number, kind = "net.fetch") => ({
    id: "grt_x",
    app: APP,
    kind,
    scope: kind === "net.fetch"
      ? { kind, host, port }
      : { kind, path: "/tmp", recursive: false },
    status: "active",
  });
  const pages = [
    {
      grants: [grant("API.example.com", 443), grant("old.example.com", 443)],
      display: {
        app: APP,
        release: REL,
        requirements: [
          { kind: "net.fetch", scope: { host: "api.example.com", port: 443 } },
          { kind: "net.fetch", scope: { host: "cdn.example.com", port: 443 } },
        ],
      },
      next_cursor: "c1",
    },
    {
      grants: [grant("cdn.example.com", 443), grant("", 0, "fs.read")],
      display: null,
      next_cursor: null,
    },
  ];
  const { calls, connector } = core({
    "read:grants/list": (body) => ({
      ok: true,
      value: (body as { cursor?: string }).cursor === "c1"
        ? pages[1]
        : pages[0],
    }),
  });
  const hosts = await connector.hosts(APP, REL);
  assert.deepEqual(hosts, {
    ok: true,
    value: [
      { host: "api.example.com", port: 443 },
      { host: "cdn.example.com", port: 443 },
    ],
  });
  assert.deepEqual(calls.map((call) => call.body), [
    { app: APP, status: "active", limit: 200 },
    { app: APP, status: "active", limit: 200, cursor: "c1" },
  ]);
  // preview처럼 선언을 모르면 active grant만이다.
  const preview = await connector.hosts(APP, null);
  assert.equal((preview as { ok: true; value: unknown[] }).value.length, 3);
  const failing = core({});
  assert.equal(
    ((await failing.connector.hosts(APP, REL)) as { error: { code: string } })
      .error.code,
    "unavailable",
  );
});
