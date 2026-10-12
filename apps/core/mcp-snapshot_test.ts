import { assert, assertEquals } from "@std/assert";
import { ok } from "../../packages/base/mod.ts";
import {
  type McpServerConfig,
  mcpServersSetting,
} from "../../packages/contracts/lophn-agent/mod.ts";
import {
  PLACE_MCP_FILE,
  serializePlaceMcpFile,
} from "../../packages/lophn-agent/extensions/mod.ts";
import { startAgentRuntimeChild } from "./agent-runtime.ts";
import { agentRuntimeLaunchSpec, createMcpAuthControl } from "./lophn-agent.ts";
import { mcpServerSnapshot, registeredMcpServers } from "./mcp-snapshot.ts";

// 자리 층의 MCP 서버가 core의 snapshot과 agent-runtime child의 권한에 든다(lophn-agent/extensions R32, R33).
// 이웃 packages/lophn-agent/extensions/mcp_allow_net_test.ts처럼 권한 목록은 서버가 선언한 것만 나온다.

const PRJ = "prj_01arz3ndektsv4rrffq69g5fa1";
const PRJ_TWO = "prj_01arz3ndektsv4rrffq69g5fa9";
const APP = "app_01arz3ndektsv4rrffq69g5fa2";

function stdio(name: string, executable: string, enabled = true) {
  return {
    name,
    revision: 1,
    enabled,
    transport: "stdio",
    call_timeout_ms: 60_000,
    classifications: {},
    stdio: { executable, args: [], cwd: null, env: {} },
  };
}

function http(name: string, url: string) {
  return {
    name,
    revision: 1,
    enabled: true,
    transport: "http",
    call_timeout_ms: 60_000,
    classifications: {},
    http: { url, headers: {}, auth: { kind: "none" } },
  };
}

function servers(list: unknown[]): McpServerConfig[] {
  return mcpServersSetting.value_type.parse(list);
}

async function withData(run: (data: string) => Promise<void>) {
  const data = await Deno.makeTempDir({ prefix: "lophn-mcp-snapshot-" });
  try {
    await run(data);
  } finally {
    await Deno.remove(data, { recursive: true });
  }
}

function writePlace(data: string, folder: string, text: unknown[] | string) {
  Deno.mkdirSync(`${data}/${folder}`, { recursive: true });
  Deno.writeTextFileSync(
    `${data}/${folder}/${PLACE_MCP_FILE}`,
    typeof text === "string" ? text : serializePlaceMcpFile({
      revision: 1,
      mcp_servers: servers(text),
    }),
  );
}

const spec = (mcpServers: readonly McpServerConfig[]) =>
  agentRuntimeLaunchSpec({
    dataRoot: "/data/lophn",
    apiPort: 1234,
    socketRoot: "/data/lophn/run/apps",
    mcpServers,
  });

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: place servers join the snapshot and the child's allow-run and allow-net cover what they declare and nothing wider", async () => {
  await withData(async (data) => {
    writePlace(data, `projects/${PRJ}`, [
      stdio("scoped", "/opt/scoped/bin/server"),
      stdio("off", "/opt/off/bin/server", false),
    ]);
    writePlace(data, `apps/${APP}`, [
      http("viewer", "https://viewer.example.test:8443/rpc"),
    ]);
    const snapshot = await mcpServerSnapshot(`${data}/ledger.sqlite`, {
      global: () => ok(servers([stdio("shared", "/opt/global/shared")])),
    });
    assert(snapshot.ok);
    assertEquals(snapshot.value.map((server) => server.name).sort(), [
      "off",
      "scoped",
      "shared",
      "viewer",
    ]);
    const launch = spec(snapshot.value);
    assertEquals(launch.allow_run, [
      "/opt/global/shared",
      "/opt/scoped/bin/server",
    ]);
    const net = launch.allow_net ?? [];
    assert(net.includes("viewer.example.test:8443"));
    assert(!net.some((host) => host.includes("*")));
    assert(!net.includes("viewer.example.test:443"));
    // 전역 서버가 없고 자리 파일도 없으면 MCP 권한은 없다.
    const none = await mcpServerSnapshot(`${data}/nowhere/ledger.sqlite`, {
      global: () => ok([]),
    });
    assert(none.ok);
    assertEquals(none.value, []);
    assertEquals(spec(none.value).allow_run, []);
  });
});

Deno.test("lophn-agent/extensions#R33 lophn-agent/extensions#R12 [agent-I19b]: a global server wins a name clash and a wrong place file drops only that place's servers", async () => {
  await withData(async (data) => {
    writePlace(data, `projects/${PRJ}`, [
      stdio("shared", "/opt/place/shared"),
      stdio("mine", "/opt/place/mine"),
    ]);
    writePlace(data, `projects/${PRJ_TWO}`, "{ not json");
    writePlace(data, `apps/${APP}`, [stdio("viewer", "/opt/app/viewer")]);
    const snapshot = await mcpServerSnapshot(`${data}/ledger.sqlite`, {
      global: () => ok(servers([stdio("shared", "/opt/global/shared")])),
    });
    assert(snapshot.ok);
    assertEquals(
      snapshot.value.map((server) =>
        server.transport === "stdio"
          ? [server.name, server.stdio.executable]
          : [server.name]
      ),
      [
        ["shared", "/opt/global/shared"],
        ["mine", "/opt/place/mine"],
        ["viewer", "/opt/app/viewer"],
      ],
    );
    assertEquals(spec(snapshot.value).allow_run, [
      "/opt/app/viewer",
      "/opt/global/shared",
      "/opt/place/mine",
    ]);
  });
});

Deno.test("lophn-agent/extensions#R32 [agent-I19b]: when a place's server list changes the core starts the child again with the new allow-run", async () => {
  await withData(async (data) => {
    writePlace(data, `projects/${PRJ}`, [stdio("scoped", "/opt/scoped/one")]);
    const specs: { allow_run: readonly string[] }[] = [];
    const io = {
      start: (launch: { allow_run: readonly string[] }) => {
        specs.push(launch);
        return Promise.resolve(ok(undefined));
      },
      updateSpec: (launch: { allow_run: readonly string[] }) => {
        specs.push(launch);
        return Promise.resolve(ok(undefined));
      },
      send: () => Promise.resolve(ok(undefined)),
    };
    const registry = {
      issue: () =>
        Promise.resolve(ok({ token: "token", credential_ref: "ref" })),
      revalidate: () =>
        ok({ actor: "machine", scope: { operations: [], targets: {} } }),
      endBy: () => {},
      end: () => {},
    };
    const started = await startAgentRuntimeChild({
      io,
      registry,
      record: () => Promise.resolve(ok(undefined)),
      epoch: "epoch",
      dataRoot: data,
      apiPort: 1234,
      gauge: {} as never,
      prepareBlob: () => Promise.resolve(ok({} as never)),
      readProviders: () => Promise.resolve(ok([])),
      readMcpServers: () =>
        mcpServerSnapshot(`${data}/ledger.sqlite`, {
          global: () => ok([]),
        }),
      read: () => Promise.resolve(ok({})),
      known: () => undefined,
      secrets: {} as never,
      socketRoot: `${data}/run/apps`,
      pollMs: 20,
    } as never);
    assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
    try {
      assertEquals(specs.length, 1);
      assertEquals(specs[0].allow_run, ["/opt/scoped/one"]);
      // 같은 목록이면 다시 띄우지 않고, 바뀌면 새 목록으로 다시 띄운다.
      await new Promise((resolve) => setTimeout(resolve, 100));
      assertEquals(specs.length, 1);
      writePlace(data, `projects/${PRJ}`, [
        stdio("scoped", "/opt/scoped/two"),
      ]);
      for (let tries = 0; tries < 100 && specs.length < 2; tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assertEquals(specs.length, 2);
      assertEquals(specs[1].allow_run, ["/opt/scoped/two"]);
    } finally {
      started.value.stop();
    }
  });
});

function oauth(name: string, issuer: string) {
  return {
    ...http(name, "https://oauth.example.test/rpc"),
    http: {
      url: "https://oauth.example.test/rpc",
      headers: {},
      auth: {
        kind: "oauth2",
        issuer,
        client_id: "lophn",
        client_secret_ref: null,
        scopes: [],
        token_ref: null,
      },
    },
  };
}

const placeOf = {
  prj: { kind: "project", id: PRJ },
  prjTwo: { kind: "project", id: PRJ_TWO },
  app: { kind: "app", id: APP },
} as const;

function authControl(data: string, global: McpServerConfig[] = []) {
  return createMcpAuthControl({
    nowMs: () => 0,
    registered: () =>
      registeredMcpServers(`${data}/ledger.sqlite`, {
        global: () => ok(global),
      }),
    openListener: () =>
      Promise.resolve(ok({
        port: () => 4321,
        receive: () => new Promise(() => {}),
        close: () => Promise.resolve(),
      })),
  });
}

const beginInput = (name: string, place: unknown) => ({
  name,
  client_id: "lophn",
  scopes: [],
  place,
});

Deno.test("lophn-agent/extensions#R16 [agent-I50]: starting OAuth finds the server registered in the place the input names, and a place without that name is not found", async () => {
  await withData(async (data) => {
    writePlace(data, `projects/${PRJ}`, [
      oauth("scoped-oauth", "https://one.example.test"),
    ]);
    const control = authControl(data);
    try {
      const begin = control.handlers.get("agent-mcp-auth/begin")!;
      const begun = await begin({}, beginInput("scoped-oauth", placeOf.prj));
      assert(begun.ok, begun.ok ? "" : JSON.stringify(begun.error));
      assertEquals(
        (begun.value as { callback_port: number }).callback_port,
        4321,
      );
      // 이름은 있어도 다른 자리, 전역, 아무도 등록하지 않은 이름은 모두 없는 서버다.
      for (
        const missing of [
          beginInput("scoped-oauth", placeOf.prjTwo),
          beginInput("scoped-oauth", placeOf.app),
          beginInput("scoped-oauth", null),
          beginInput("nobody", placeOf.prj),
        ]
      ) {
        const result = await begin({}, missing);
        assert(!result.ok);
        assertEquals(result.error.code, "not_found");
      }
    } finally {
      control.endAll();
    }
  });
});

Deno.test("lophn-agent/extensions#R16 [agent-I50]: two places with a server of the same name start OAuth with the server of the place that was picked", async () => {
  await withData(async (data) => {
    // 자리 id 순으로는 PRJ가 첫 서버다. 고른 자리가 이긴다는 것을 보이려 뒤 자리와 앱을 고른다.
    writePlace(data, `projects/${PRJ}`, [
      oauth("shared", "https://one.example.test"),
    ]);
    writePlace(data, `projects/${PRJ_TWO}`, [
      oauth("shared", "https://two.example.test"),
    ]);
    writePlace(data, `apps/${APP}`, [
      oauth("shared", "https://app.example.test"),
    ]);
    const control = authControl(data);
    try {
      const begin = control.handlers.get("agent-mcp-auth/begin")!;
      const hostOf = async (place: unknown) => {
        const begun = await begin({}, beginInput("shared", place));
        assert(begun.ok, begun.ok ? "" : JSON.stringify(begun.error));
        return new URL((begun.value as { url: string }).url).host;
      };
      assertEquals(await hostOf(placeOf.prjTwo), "two.example.test");
      assertEquals(await hostOf(placeOf.app), "app.example.test");
      assertEquals(await hostOf(placeOf.prj), "one.example.test");
    } finally {
      control.endAll();
    }
  });
});

Deno.test("lophn-agent/extensions#R16 [agent-I50]: a global server is picked with a null place, and a place server hidden by a global name is not found", async () => {
  await withData(async (data) => {
    writePlace(data, `projects/${PRJ}`, [
      oauth("global-oauth", "https://place.example.test"),
      oauth("mine", "https://mine.example.test"),
    ]);
    const control = authControl(
      data,
      servers([oauth("global-oauth", "https://global.example.test")]),
    );
    try {
      const begin = control.handlers.get("agent-mcp-auth/begin")!;
      const global = await begin({}, beginInput("global-oauth", null));
      assert(global.ok, global.ok ? "" : JSON.stringify(global.error));
      assertEquals(
        new URL((global.value as { url: string }).url).host,
        "global.example.test",
      );
      // 전역과 이름이 겹친 자리 서버는 쓰지 않는다(R33): 그 자리로는 시작하지 못한다.
      const hidden = await begin({}, beginInput("global-oauth", placeOf.prj));
      assert(!hidden.ok);
      assertEquals(hidden.error.code, "not_found");
      const mine = await begin({}, beginInput("mine", placeOf.prj));
      assert(mine.ok);
    } finally {
      control.endAll();
    }
  });
});

Deno.test("lophn-agent/extensions#R16 [agent-I50]: completing OAuth looks the server up in the place too, and a place without it is not found", async () => {
  await withData(async (data) => {
    writePlace(data, `projects/${PRJ}`, [
      oauth("shared", "https://one.example.test"),
    ]);
    const control = authControl(data);
    try {
      const complete = control.handlers.get("agent-mcp-auth/complete")!;
      const missing = await complete(
        {},
        { name: "shared", callback_port: 4321, place: placeOf.prjTwo },
      );
      assert(!missing.ok);
      assertEquals(missing.error.code, "not_found");
      // 서버는 있으나 시작한 적이 없고 token 교환 눈도 없으면 not_found가 아니라 다른 오류다.
      const found = await complete(
        {},
        { name: "shared", callback_port: 4321, place: placeOf.prj },
      );
      assert(!found.ok);
      assert(found.error.code !== "not_found");
    } finally {
      control.endAll();
    }
  });
});
