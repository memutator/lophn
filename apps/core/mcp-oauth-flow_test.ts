// lophn-agent/extensions#R16 #R17 [agent-I52]: MCP OAuth를 core에서 끝까지 이은 흐름이다. 사람이 시작한 로그인(실제
// loopback listener) → token 교환(가짜 발급자) → keychain 보관 → 설정의 token 참조 → 상태 read → 연결 때 token 부착(감독
// pipe의 secret 전송 부착) → 만료 갱신(한 번에 하나)까지 본다. keychain은 fake이고 발급자·MCP server는 이 시험이 연
// localhost server다. 사람의 실제 keychain·browser·OAuth server에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../packages/base/mod.ts";
import {
  type AgentPlace,
  type McpServerConfig,
  mcpServersSetting,
} from "../../packages/protocol/lophn-agent/mod.ts";
import type { ParentMessage } from "../../packages/protocol/platform/mod.ts";
import {
  createMcpConnections,
  createMcpOAuthVault,
  createMcpSecretRefSource,
  type HttpFetch,
  mcpTokenRef,
  PLACE_MCP_FILE,
  serializePlaceMcpFile,
} from "../../packages/core/lophn-agent/extensions/mod.ts";
import { SETTINGS_SCHEMA_STEPS } from "../../packages/core/config/mod.ts";
import {
  createFakeKeychain,
  randomSealedRef,
  SECRET_SCHEMA_STEPS,
} from "../../packages/core/secrets/mod.ts";
import { mcpConnectionsDeps } from "../agent-runtime/product-driver.ts";
import { createSecretLink } from "../agent-runtime/secret-link.ts";
import { createAgentRuntimeSecrets } from "./agent-runtime-secret.ts";
import { createMcpAuthControl, openMcpCallbackListener } from "./mcp-auth.ts";
import { registeredMcpServers } from "./mcp-snapshot.ts";
import { openSecretStore } from "./secret-store.ts";

const PRJ = "prj_01arz3ndektsv4rrffq69g5fa1";
const APP = "app_01arz3ndektsv4rrffq69g5fa2";
const ISSUER = "https://issuer.example.test";
const START = 1_800_000_000_000;

type Behavior = { refresh: "ok" | "reject" };

type World = {
  home: string;
  db: DatabaseSync;
  keychain: ReturnType<typeof createFakeKeychain>;
  clock: { now: number };
  globalServers: McpServerConfig[];
  issuer: {
    server: Deno.HttpServer;
    behavior: Behavior;
    seen: { grant: string; form: Record<string, string> }[];
    issued: string[];
  };
  mcp: {
    server: Deno.HttpServer;
    port: number;
    seen: (string | null)[];
  };
  store: ReturnType<typeof openSecretStore>;
  vault: ReturnType<typeof createMcpOAuthVault>;
  control: ReturnType<typeof createMcpAuthControl>;
  connections: ReturnType<typeof createMcpConnections>;
  token: number;
};

function oauth(
  world: Pick<World, "mcp">,
  name: string,
  tokenRef: string | null = null,
  issuer = ISSUER,
): McpServerConfig {
  return mcpServersSetting.value_type.parse([{
    name,
    revision: 1,
    enabled: true,
    transport: "http",
    call_timeout_ms: 60_000,
    classifications: {},
    http: {
      url: `http://127.0.0.1:${world.mcp.port}/rpc`,
      headers: {},
      auth: {
        kind: "oauth2",
        issuer,
        client_id: "lophn",
        client_secret_ref: null,
        scopes: ["read"],
        token_ref: tokenRef,
      },
    },
  }])[0]!;
}

function withTokenRef(server: McpServerConfig, ref: string | null) {
  if (server.transport !== "http" || server.http.auth.kind !== "oauth2") {
    return server;
  }
  return {
    ...server,
    revision: server.revision + 1,
    http: {
      ...server.http,
      auth: { ...server.http.auth, token_ref: ref },
    },
  } as McpServerConfig;
}

function placeFolder(home: string, place: AgentPlace): string {
  return `${home}/${
    place.kind === "project" ? "projects" : "apps"
  }/${place.id}`;
}

function readPlaceServers(home: string, place: AgentPlace): McpServerConfig[] {
  try {
    const text = Deno.readTextFileSync(
      `${placeFolder(home, place)}/${PLACE_MCP_FILE}`,
    );
    return mcpServersSetting.value_type.parse(
      JSON.parse(text).mcp_servers as unknown[],
    );
  } catch {
    return [];
  }
}

function writePlaceServers(
  home: string,
  place: AgentPlace,
  servers: McpServerConfig[],
) {
  Deno.mkdirSync(placeFolder(home, place), { recursive: true });
  Deno.writeTextFileSync(
    `${placeFolder(home, place)}/${PLACE_MCP_FILE}`,
    serializePlaceMcpFile({ revision: 1, mcp_servers: servers }),
  );
}

async function open(): Promise<World> {
  const home = await Deno.makeTempDir({ prefix: "lophn-mcp-oauth-flow-" });
  const db = new DatabaseSync(`${home}/lophn.db`);
  for (const step of SECRET_SCHEMA_STEPS) db.exec(step.sql);
  for (const step of SETTINGS_SCHEMA_STEPS) db.exec(step.sql);
  const keychain = createFakeKeychain();
  const clock = { now: START };

  const world = { token: 0 } as World;
  world.home = home;
  world.db = db;
  world.keychain = keychain;
  world.clock = clock;
  world.globalServers = [];

  // 가짜 발급자: 교환과 갱신에 새 값을 발급하고 본 요청을 기록한다.
  const behavior: Behavior = { refresh: "ok" };
  const issued: string[] = [];
  const seenIssuer: World["issuer"]["seen"] = [];
  const issuerServer = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const form = Object.fromEntries(
        new URLSearchParams(await request.text()).entries(),
      );
      seenIssuer.push({ grant: form.grant_type ?? "", form });
      if (
        form.grant_type === "refresh_token" && behavior.refresh === "reject"
      ) {
        return new Response("", { status: 400 });
      }
      world.token += 1;
      const access =
        `access-${world.token}-teal-orchard-${crypto.randomUUID()}`;
      issued.push(access);
      return Response.json({
        access_token: access,
        refresh_token:
          `refresh-${world.token}-saffron-meadow-${crypto.randomUUID()}`,
        expires_in: 3600,
      });
    },
  );
  world.issuer = {
    server: issuerServer,
    behavior,
    seen: seenIssuer,
    issued,
  };
  const issuerFetch: HttpFetch = (url, init) =>
    fetch(
      url.replace(ISSUER, `http://127.0.0.1:${issuerServer.addr.port}`),
      init,
    );

  // 가짜 MCP server: 받은 Authorization을 기록하고, 발급자가 낸 최신 token이 아니면 401이다.
  const seenMcp: (string | null)[] = [];
  const mcpServer = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      const authorization = request.headers.get("authorization");
      seenMcp.push(authorization);
      const latest = issued.at(-1);
      if (latest === undefined || authorization !== `Bearer ${latest}`) {
        return new Response("no", { status: 401 });
      }
      const body = JSON.parse(await request.text()) as {
        id?: number;
        method: string;
      };
      if (body.id === undefined) return new Response(null, { status: 202 });
      const result = body.method === "initialize"
        ? {
          protocolVersion: "2025-06-18",
          capabilities: { tools: {} },
          serverInfo: { name: "fake-http", version: "0" },
        }
        : {
          tools: [{
            name: "whoami",
            description: "who",
            inputSchema: { type: "object", properties: {} },
          }],
        };
      return Response.json({ jsonrpc: "2.0", id: body.id, result });
    },
  );
  world.mcp = { server: mcpServer, port: mcpServer.addr.port, seen: seenMcp };

  let serial = 0;
  const vault = createMcpOAuthVault({
    keychain: () => keychain,
    randomRef: () => `${randomSealedRef()}-${++serial}`,
  });
  world.vault = vault;
  world.store = openSecretStore({
    ledgerPath: `${home}/lophn.db`,
    channel: {
      register: () => Promise.resolve(ok(undefined)),
      revoke: () => Promise.resolve(ok(undefined)),
      setReady: () => Promise.resolve(ok(undefined)),
    },
    keychain: () => keychain,
    sources: [createMcpSecretRefSource(() => vault.refs())],
  });
  world.control = createMcpAuthControl({
    fetch: issuerFetch,
    openListener: openMcpCallbackListener,
    registered: () =>
      registeredMcpServers(`${home}/lophn.db`, {
        global: () => ok(world.globalServers),
      }),
    vault,
    nowMs: () => clock.now,
    syncSecrets: () => world.store.sync(),
    writeTokenRef(_ctx, target, ref) {
      if (target.place === null) {
        world.globalServers = world.globalServers.map((server) =>
          server.name === target.name ? withTokenRef(server, ref) : server
        );
      } else {
        writePlaceServers(
          home,
          target.place,
          readPlaceServers(home, target.place).map((server) =>
            server.name === target.name ? withTokenRef(server, ref) : server
          ),
        );
      }
      return Promise.resolve(ok(undefined));
    },
  });
  const secrets = createAgentRuntimeSecrets({
    ledgerPath: `${home}/lophn.db`,
    keychain: () => keychain,
    known: () => world.store.known,
    process: "lophn-agent/runtime",
    task: "lophn-agent",
    mcpOAuth: world.control.tokenUse,
  });
  const link = createSecretLink({
    async send(message) {
      const answer = await secrets.answer(message, () => true);
      if (answer !== undefined) link.onParent(answer as ParentMessage);
    },
    timeoutMs: 2000,
  });
  world.connections = createMcpConnections(mcpConnectionsDeps(link.attach));
  return world;
}

async function close(world: World) {
  await world.connections.endAll();
  world.control.endAll();
  await world.mcp.server.shutdown();
  await world.issuer.server.shutdown();
  world.store.stop();
  world.db.close();
  await Deno.remove(world.home, { recursive: true });
}

type Handler = (ctx: unknown, input: unknown) => Promise<
  { ok: true; value: unknown } | { ok: false; error: { code: string } }
>;

function route(world: World, method: string): Handler {
  return world.control.handlers.get(`agent-mcp-auth/${method}`) as Handler;
}

const NOTES = { name: "notes", place: null };

async function stateOf(
  world: World,
  servers: { name: string; place: AgentPlace | null }[] = [NOTES],
) {
  const read = await route(world, "state")({}, { servers });
  assert(read.ok, JSON.stringify(read));
  return (read.value as {
    servers: {
      name: string;
      place: AgentPlace | null;
      state: string;
      reason: string | null;
    }[];
  }).servers;
}

async function begin(
  world: World,
  target: { name: string; place: AgentPlace | null } = NOTES,
) {
  const begun = await route(world, "begin")({}, {
    ...target,
    client_id: "lophn",
    scopes: ["read"],
  });
  assert(begun.ok, JSON.stringify(begun));
  const value = begun.value as { url: string; callback_port: number };
  return {
    ...value,
    state: new URL(value.url).searchParams.get("state")!,
  };
}

// 사람이 browser에서 돌아오는 요청이다. 실제 loopback listener에 닿는다.
async function comeBack(port: number, code: string, state: string) {
  const response = await fetch(
    `http://127.0.0.1:${port}/callback?code=${code}&state=${state}`,
  );
  await response.body?.cancel();
  return response.status;
}

async function signIn(
  world: World,
  target: { name: string; place: AgentPlace | null } = NOTES,
) {
  const begun = await begin(world, target);
  const completing = route(world, "complete")({}, {
    ...target,
    callback_port: begun.callback_port,
  });
  assertEquals(
    await comeBack(begun.callback_port, "the-code", begun.state),
    200,
  );
  return { begun, done: await completing };
}

async function connect(world: World, server: McpServerConfig, id = "asg-1") {
  return await world.connections.acquire(
    id,
    server,
    new AbortController().signal,
  );
}

function pointedServer(world: World, name: string) {
  const found = world.globalServers.find((server) => server.name === name);
  assert(found !== undefined);
  return found;
}

Deno.test("lophn-agent/extensions#R16 #R17 [agent-I52]: a person signs in from begin to the connection — the code is exchanged, the token is kept in the keychain, the setting points at it, the state says signed_in, and the connection carries it", async () => {
  const world = await open();
  try {
    world.globalServers = [oauth(world, "notes")];
    // 로그인 전: 상태는 none이고 연결은 서버에 닿지 않은 채 인증 실패다.
    assertEquals(await stateOf(world), [
      { name: "notes", place: null, state: "none", reason: null },
    ]);
    const before = await connect(world, pointedServer(world, "notes"));
    assert(!before.ok);
    assertEquals(world.connections.views().at(-1)?.state, "failed_auth");
    assertEquals(world.mcp.seen.length, 0);
    await world.connections.endAssignment("asg-1");

    const { begun, done } = await signIn(world);
    assert(done.ok, JSON.stringify(done));
    assertEquals(done.value, { completed: true });
    // 교환은 시작이 낸 verifier와 짝이고 redirect는 loopback이다.
    assertEquals(world.issuer.seen.length, 1);
    const exchange = world.issuer.seen[0]!.form;
    assertEquals(exchange.grant_type, "authorization_code");
    assertEquals(exchange.code, "the-code");
    assertEquals(
      exchange.redirect_uri,
      `http://127.0.0.1:${begun.callback_port}/callback`,
    );
    const challenge = new URL(begun.url).searchParams.get("code_challenge");
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(exchange.code_verifier),
    );
    assertEquals(
      btoa(String.fromCharCode(...new Uint8Array(digest)))
        .replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""),
      challenge,
    );

    // 설정이 token 참조를 가리키고 서버 판이 올라갔다.
    const pointed = pointedServer(world, "notes");
    assert(pointed.transport === "http" && pointed.http.auth.kind === "oauth2");
    assertEquals(
      pointed.http.auth.token_ref,
      mcpTokenRef({
        place: null,
        name: "notes",
      }),
    );
    assertEquals(pointed.revision, 2);
    // token은 keychain에만 있다: ledger의 secrets 표와 상태 응답에는 값이 없다.
    const access = world.issuer.issued[0]!;
    assert(
      [...world.keychain.stored.values()].some((value) =>
        new TextDecoder().decode(value) === access
      ),
    );
    const state = await stateOf(world);
    assertEquals(state, [
      { name: "notes", place: null, state: "signed_in", reason: null },
    ]);
    assert(!JSON.stringify(state).includes(access));
    assertEquals(world.db.prepare("select * from secrets").all(), []);
    // 알려진 값 안전화가 이 token을 안다.
    assert(world.store.known.ready);
    assert(world.store.known.match(`echo ${access} echo`) !== undefined);

    // 연결이 저장한 token을 Authorization으로 붙인다.
    const connected = await connect(world, pointed);
    assert(connected.ok, connected.ok ? "" : JSON.stringify(connected.error));
    assert((await world.connections.toolList("asg-1", "notes")).ok);
    assert(world.mcp.seen.length >= 2);
    for (const header of world.mcp.seen) {
      assertEquals(header, `Bearer ${access}`);
    }
    assert(!JSON.stringify(world.connections.views()).includes(access));
  } finally {
    await close(world);
  }
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: when the token expires two assignments reconnecting at once cause one refresh request, and the new token is the one attached", async () => {
  const world = await open();
  try {
    world.globalServers = [oauth(world, "notes")];
    const { done } = await signIn(world);
    assert(done.ok);
    const server = pointedServer(world, "notes");
    const first = await connect(world, server, "asg-0");
    assert(first.ok);
    await world.connections.endAssignment("asg-0");
    const refreshToken = world.issuer.seen.length;
    assertEquals(refreshToken, 1);

    // 만료 직후 동시 연결 둘이다.
    world.clock.now += 3600 * 1000 + 1000;
    world.mcp.seen.length = 0;
    const [a, b] = await Promise.all([
      connect(world, server, "asg-a"),
      connect(world, server, "asg-b"),
    ]);
    assert(a.ok, a.ok ? "" : JSON.stringify(a.error));
    assert(b.ok, b.ok ? "" : JSON.stringify(b.error));
    const refreshes = world.issuer.seen.filter((seen) =>
      seen.grant === "refresh_token"
    );
    assertEquals(refreshes.length, 1);
    // 갱신 요청은 보관한 refresh token을 썼다.
    assert(refreshes[0]!.form.refresh_token!.startsWith("refresh-1-"));
    const latest = world.issuer.issued.at(-1)!;
    for (const id of ["asg-a", "asg-b"]) {
      assert((await world.connections.toolList(id, "notes")).ok);
    }
    assert(world.mcp.seen.length >= 4);
    for (const header of world.mcp.seen) {
      assertEquals(header, `Bearer ${latest}`);
    }
    // 새 값도 알려진 값이고 옛 값은 회수됐다.
    assert(world.store.known.match(`x ${latest} x`) !== undefined);
    assertEquals(
      world.store.known.match(`x ${world.issuer.issued[0]!} x`),
      undefined,
    );
    assertEquals((await stateOf(world))[0]!.state, "signed_in");
  } finally {
    await close(world);
  }
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: a refresh the issuer rejects shows up as sign in again — an auth failure for the connection and a failed state with its reason", async () => {
  const world = await open();
  try {
    world.globalServers = [oauth(world, "notes")];
    assert((await signIn(world)).done.ok);
    const server = pointedServer(world, "notes");
    world.clock.now += 3600 * 1000 + 1000;
    world.issuer.behavior.refresh = "reject";
    world.mcp.seen.length = 0;
    const result = await connect(world, server);
    assert(!result.ok);
    assertEquals(result.error.code, "forbidden");
    assertEquals(world.connections.views().at(-1)?.state, "failed_auth");
    assertEquals(world.mcp.seen.length, 0);
    assertEquals(await stateOf(world), [
      {
        name: "notes",
        place: null,
        state: "failed",
        reason: "refresh_rejected",
      },
    ]);
    // 폐기된 token은 안전화에서도 빠지고 keychain에서도 사라진다.
    assertEquals(
      world.store.known.match(`x ${world.issuer.issued[0]!} x`),
      undefined,
    );
    assertEquals(world.keychain.stored.size, 0);
    // 다시 로그인하면 바로 되살아난다.
    world.issuer.behavior.refresh = "ok";
    const again = await signIn(world);
    assert(again.done.ok);
    assertEquals((await stateOf(world))[0]!.state, "signed_in");
    const connected = await connect(world, pointedServer(world, "notes"));
    assert(connected.ok, connected.ok ? "" : JSON.stringify(connected.error));
  } finally {
    await close(world);
  }
});

Deno.test("lophn-agent/extensions#R17 [agent-I52]: when the issuer or the URL in the setting changes the old token is not carried and the server needs sign-in again", async () => {
  const world = await open();
  try {
    world.globalServers = [oauth(world, "notes")];
    assert((await signIn(world)).done.ok);
    const signedIn = pointedServer(world, "notes");
    const old = world.issuer.issued[0]!;
    assert((await connect(world, signedIn)).ok);
    await world.connections.endAssignment("asg-1");
    const sent = world.mcp.seen.length;
    const refs = mcpTokenRef({ place: null, name: "notes" });

    // 같은 이름과 참조에 발급자가 달라졌다.
    world.globalServers = [
      oauth(world, "notes", refs, "https://other-issuer.example.test"),
    ];
    assertEquals((await stateOf(world))[0]!.state, "none");
    const moved = await connect(world, pointedServer(world, "notes"), "asg-2");
    assert(!moved.ok);
    assertEquals(world.connections.views().at(-1)?.state, "failed_auth");
    // 옛 token은 서버에 보내지지 않았고 keychain에서도 사라졌다.
    assertEquals(world.mcp.seen.length, sent);
    assertEquals(world.keychain.stored.size, 0);
    // 원래 설정으로 되돌려도 되살아나지 않는다.
    world.globalServers = [oauth(world, "notes", refs)];
    assertEquals((await stateOf(world))[0]!.state, "none");
    assertEquals(world.store.known.match(`x ${old} x`), undefined);
  } finally {
    await close(world);
  }
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: a state value that is not the one begin made is rejected, the person can cancel a sign-in that is waiting, and begin works again after both", async () => {
  const world = await open();
  try {
    world.globalServers = [oauth(world, "notes")];
    // 잘못된 state.
    const begun = await begin(world);
    const completing = route(world, "complete")({}, {
      ...NOTES,
      callback_port: begun.callback_port,
    });
    await comeBack(begun.callback_port, "the-code", "the-evil-state");
    const rejected = await completing;
    assert(!rejected.ok);
    assertEquals(rejected.error.code, "invalid_input");
    assertEquals(world.issuer.seen.length, 0);
    assertEquals(await stateOf(world), [
      {
        name: "notes",
        place: null,
        state: "failed",
        reason: "state_mismatch",
      },
    ]);
    assertEquals(world.keychain.stored.size, 0);

    // 취소.
    const second = await begin(world);
    assertEquals((await stateOf(world))[0]!.state, "in_progress");
    const busy = await route(world, "begin")({}, {
      ...NOTES,
      client_id: "lophn",
      scopes: [],
    });
    assert(!busy.ok);
    assertEquals(busy.error.code, "conflict");
    const waiting = route(world, "complete")({}, {
      ...NOTES,
      callback_port: second.callback_port,
    });
    const cancelled = await route(world, "cancel")({}, NOTES);
    assert(cancelled.ok);
    assertEquals(cancelled.value, { cancelled: true });
    const ended = await waiting;
    assert(!ended.ok);
    assertEquals(await stateOf(world), [
      { name: "notes", place: null, state: "none", reason: null },
    ]);
    // 이제 다시 시작해 끝까지 간다.
    const again = await signIn(world);
    assert(again.done.ok, JSON.stringify(again.done));
    assertEquals((await stateOf(world))[0]!.state, "signed_in");
    // 할 일이 없을 때의 취소는 아무것도 바꾸지 않는다.
    const none = await route(world, "cancel")({}, NOTES);
    assert(none.ok);
    assertEquals(none.value, { cancelled: false });
    assertEquals((await stateOf(world))[0]!.state, "signed_in");
  } finally {
    await close(world);
  }
});

Deno.test("lophn-agent/extensions#R16 #R17 [agent-I52]: servers of the same name in different places sign in separately, each setting file points at its own token, and a setting that points at another place's token for another address gets nothing", async () => {
  const world = await open();
  try {
    const project: AgentPlace = { kind: "project", id: PRJ };
    const app: AgentPlace = { kind: "app", id: APP };
    writePlaceServers(world.home, project, [oauth(world, "shared")]);
    writePlaceServers(world.home, app, [oauth(world, "shared")]);
    const targetProject = { name: "shared", place: project };
    const targetApp = { name: "shared", place: app };

    assert((await signIn(world, targetProject)).done.ok);
    assertEquals(
      await stateOf(world, [targetProject, targetApp]),
      [
        { ...targetProject, state: "signed_in", reason: null },
        { ...targetApp, state: "none", reason: null },
      ],
    );
    const projectServer = readPlaceServers(world.home, project)[0]!;
    const appServer = readPlaceServers(world.home, app)[0]!;
    assert(
      projectServer.transport === "http" &&
        projectServer.http.auth.kind === "oauth2" &&
        appServer.transport === "http" && appServer.http.auth.kind === "oauth2",
    );
    assertEquals(
      projectServer.http.auth.token_ref,
      mcpTokenRef({ place: project, name: "shared" }),
    );
    assertEquals(appServer.http.auth.token_ref, null);
    assertEquals(projectServer.revision, 2);
    assert((await connect(world, projectServer)).ok);
    await world.connections.endAssignment("asg-1");

    // 앱 쪽 설정을 손으로 project의 참조에 맞추고 다른 주소로 바꿔도 그 token은 건너오지 않는다:
    // token은 로그인한 서버의 URL origin에만 간다.
    const elsewhere = withTokenRef(
      appServer,
      mcpTokenRef({ place: project, name: "shared" }),
    );
    assert(elsewhere.transport === "http");
    const stolen = {
      ...elsewhere,
      http: { ...elsewhere.http, url: "http://127.0.0.1:1/rpc" },
    } as McpServerConfig;
    writePlaceServers(world.home, app, [stolen]);
    world.mcp.seen.length = 0;
    const result = await connect(world, stolen, "asg-app");
    assert(!result.ok);
    assertEquals(result.error.code, "forbidden");
    assertEquals(world.connections.views().at(-1)?.state, "failed_auth");
    assertEquals(world.mcp.seen.length, 0);
    // 자기 자리의 참조가 아닌 설정은 상태에서도 로그인한 것으로 보이지 않는다.
    assertEquals((await stateOf(world, [targetApp]))[0]!.state, "none");
  } finally {
    await close(world);
  }
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: only an http OAuth server registered in the named place can begin, and a keychain that cannot keep the token ends the sign-in as store_failed", async () => {
  const world = await open();
  try {
    world.globalServers = [
      oauth(world, "notes"),
      { ...oauth(world, "off"), enabled: false },
    ];
    const missing = await route(world, "begin")({}, {
      name: "nobody",
      place: null,
      client_id: "lophn",
      scopes: [],
    });
    assert(!missing.ok);
    assertEquals(missing.error.code, "not_found");
    // 전역 서버를 자리로 부르면 없는 서버다.
    const wrongPlace = await route(world, "begin")({}, {
      name: "notes",
      place: { kind: "project", id: PRJ },
      client_id: "lophn",
      scopes: [],
    });
    assert(!wrongPlace.ok);
    assertEquals(wrongPlace.error.code, "not_found");
    // 등록 밖 서버의 상태는 없음이다.
    assertEquals(
      await stateOf(world, [{ name: "nobody", place: null }]),
      [{ name: "nobody", place: null, state: "none", reason: null }],
    );

    // 잠긴 keychain에서는 교환은 되어도 보관이 안 되므로 로그인이 실패한다. 설정은 그대로다.
    world.keychain.setStatus("unavailable");
    const failed = await signIn(world);
    assert(!failed.done.ok);
    assertEquals(failed.done.error.code, "unavailable");
    world.keychain.setStatus("available");
    assertEquals((await stateOf(world))[0], {
      name: "notes",
      place: null,
      state: "failed",
      reason: "store_failed",
    });
    const server = pointedServer(world, "notes");
    assert(server.transport === "http" && server.http.auth.kind === "oauth2");
    assertEquals(server.http.auth.token_ref, null);
    assertEquals(server.revision, 1);
  } finally {
    await close(world);
  }
});
