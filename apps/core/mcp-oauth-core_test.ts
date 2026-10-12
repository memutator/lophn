// lophn-agent/extensions#R16 #R17 [agent-I52]: 실제 core(임시 LOPHN_HOME, 실제 ledger·HTTP route)에서 MCP OAuth 로그인이
// 끝까지 이어진다. 사람 token으로 `agent-mcp-auth` memory route를 부르고, 로그인이 끝나면 전역 서버는 settings에,
// 자리 서버는 그 자리 `mcp-servers.json`에 token 참조가 쓰이며, core를 다시 띄워도 상태가 keychain과 설정에서 읽힌다.
// keychain은 fake이고 발급자는 이 시험이 연 localhost server다. 사람의 실제 keychain·browser에 닿지 않는다.
import { assert, assertEquals } from "@std/assert";
import { manualClock, seededRandom } from "../../packages/base/mod.ts";
import { mcpServersSetting } from "../../packages/contracts/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../packages/contracts/platform/mod.ts";
import { mcpTokenRef } from "../../packages/lophn-agent/extensions/mod.ts";
import { createFakeKeychain } from "../../packages/platform/secrets/mod.ts";
import { type Core, startCore } from "./core.ts";
import { createLedgerRegistration as documentsRegistration } from "./documents.ts";
import {
  createLedgerRegistration,
  lophnAgentDefinitions,
} from "./lophn-agent.ts";
import { call, command, type Server } from "./testing/approvals-fixture.ts";
import { MACHINE_TOKEN, USER_TOKEN } from "./testing/tool-judgment-world.ts";

const PROJECT = "prj_01arz3ndektsv4rrffq69g5fav";
const ISSUER = "https://issuer.example.test";

const USER_OPERATIONS = [
  "SettingsDefinitions",
  "GetSettings",
  "ApplySettings",
  "project.create",
  "ChangePlaceExtensionSettings",
  "ReadPlaceExtensionSettings",
  "BeginMcpAuth",
  "CompleteMcpAuth",
  "CancelMcpAuth",
  "ReadMcpAuthState",
];

function context(
  actor: string,
  operations: readonly string[],
  ref: string,
): AuthenticatedContext {
  return {
    principal: actor,
    actor,
    scope: { operations: [...operations], targets: {} },
    conditions: {},
    credential_ref: `cred-${actor}-${ref}`,
  } as AuthenticatedContext;
}

function oauthServer(url: string, name: string) {
  return {
    name,
    revision: 1,
    enabled: true,
    transport: "http",
    call_timeout_ms: 60_000,
    classifications: {},
    http: {
      url,
      headers: {},
      auth: {
        kind: "oauth2",
        issuer: ISSUER,
        client_id: "lophn",
        client_secret_ref: null,
        scopes: ["read"],
        token_ref: null,
      },
    },
  };
}

type Booted = {
  core: Core;
  server: Server;
  stop(): Promise<void>;
};

async function boot(
  home: string,
  keychain: ReturnType<typeof createFakeKeychain>,
  issuerFetch: (url: string, init: RequestInit) => Promise<Response>,
  round: string,
): Promise<Booted> {
  const clock = manualClock(Date.UTC(2026, 9, 12));
  const started = await startCore({
    lophnHome: home,
    port: 0,
    teams: [
      { lophnAgentDefinitions, createLedgerRegistration },
      { createLedgerRegistration: documentsRegistration },
    ],
    teamModules: [
      new URL("./lophn-agent.ts", import.meta.url).href,
      new URL("./documents.ts", import.meta.url).href,
    ],
    clock,
    random: seededRandom(71),
    testCredentials: true,
    secretKeychain: keychain,
    mcpAuthFetch: issuerFetch,
  });
  assert(started.ok, started.ok ? "" : JSON.stringify(started.error));
  const core = started.value;
  for (
    const [ctx, token] of [
      [context("machine", ["ReadMcpAuthState"], round), MACHINE_TOKEN],
      [context("user", USER_OPERATIONS, round), USER_TOKEN],
    ] as const
  ) {
    const accepted = await core.acceptTestCredential?.(ctx, token);
    assert(accepted?.ok, JSON.stringify(accepted));
    assert((await core.record(ctx)).ok);
  }
  return {
    core,
    server: {
      port: core.port,
      dataRoot: core.dataRoot,
      clock,
      confirmation: (body) =>
        Promise.resolve(core.confirmation?.(body as never) as never),
    },
    stop: () => core.shutdown(),
  };
}

async function comeBack(port: number, code: string, state: string) {
  const response = await fetch(
    `http://127.0.0.1:${port}/callback?code=${code}&state=${state}`,
  );
  await response.body?.cancel();
  return response.status;
}

async function stateOf(
  server: Server,
  servers: { name: string; place: unknown }[],
) {
  const read = await call(server, "agent-mcp-auth/state", USER_TOKEN, {
    servers,
  });
  assertEquals(read.status, 200, JSON.stringify(read.body));
  return (read.body as { servers: unknown[] }).servers;
}

async function signIn(
  server: Server,
  target: { name: string; place: unknown },
) {
  const begun = await call(server, "agent-mcp-auth/begin", USER_TOKEN, {
    ...target,
    client_id: "lophn",
    scopes: ["read"],
  });
  assertEquals(begun.status, 200, JSON.stringify(begun.body));
  const url = new URL(begun.body["url"] as string);
  const port = begun.body["callback_port"] as number;
  const completing = call(server, "agent-mcp-auth/complete", USER_TOKEN, {
    ...target,
    callback_port: port,
  });
  assertEquals(
    await comeBack(port, "the-code", url.searchParams.get("state")!),
    200,
  );
  return await completing;
}

Deno.test("lophn-agent/extensions#R16 #R17 [agent-I52]: a real core signs in a global and a place OAuth server, writes each token reference into its own setting, tells the state, and still tells it after a restart", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-mcp-oauth-core-" });
  const keychain = createFakeKeychain();
  const exchanged: Record<string, string>[] = [];
  const issuer = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    async (request) => {
      exchanged.push(
        Object.fromEntries(
          new URLSearchParams(await request.text()).entries(),
        ),
      );
      return Response.json({
        access_token:
          `access-${exchanged.length}-teal-orchard-${crypto.randomUUID()}`,
        refresh_token:
          `refresh-${exchanged.length}-saffron-${crypto.randomUUID()}`,
        expires_in: 3600,
      });
    },
  );
  const issuerFetch = (url: string, init: RequestInit) =>
    fetch(
      url.replace(ISSUER, `http://127.0.0.1:${issuer.addr.port}`),
      init,
    );
  let booted = await boot(home, keychain, issuerFetch, "one");
  try {
    let { server } = booted;
    const globalTarget = { name: "notes", place: null };
    const placeTarget = {
      name: "scoped",
      place: { kind: "project", id: PROJECT },
    };

    // 사람이 전역 서버를 등록한다(settings/apply).
    const definitions = await call(server, "settings/definitions", USER_TOKEN, {
      keys: [mcpServersSetting.key],
    });
    assertEquals(definitions.status, 200);
    const defaultsRevision = definitions.body["defaults_revision"] as string;
    const registered = await call(server, "settings/apply", USER_TOKEN, {
      input: {
        changes: [{
          layer: "common",
          key: mcpServersSetting.key,
          action: "set",
          value: [oauthServer("https://mcp.example.test/rpc", "notes")],
        }],
      },
      idempotency_key: "oauth-core-apply-1",
      compare: { revision: 0, defaults_revision: defaultsRevision },
      prepared: [],
    });
    assertEquals(registered.status, 200, JSON.stringify(registered.body));
    // 같은 core에 project와 그 자리 서버를 등록한다(place-extension-settings/change).
    const created = await call(
      server,
      "projects/create",
      USER_TOKEN,
      command({
        id: PROJECT,
        name: "alpha",
        title: "alpha",
        purpose: "",
        folders: [],
        tracking: { enabled: false, patterns: [], use_gitignore: false },
      }),
    );
    assertEquals(created.status, 200, JSON.stringify(created.body));
    const placed = await call(
      server,
      "place-extension-settings/change",
      USER_TOKEN,
      command({
        place: placeTarget.place,
        mcp_servers: [oauthServer("https://mcp.example.test/scoped", "scoped")],
      }, { compare: { hash: null } }),
    );
    assertEquals(placed.status, 200, JSON.stringify(placed.body));

    const both = [globalTarget, placeTarget];
    assertEquals(
      await stateOf(server, both),
      [
        { ...globalTarget, state: "none", reason: null },
        { ...placeTarget, state: "none", reason: null },
      ],
    );
    // 사람 자격만 부른다: machine은 거절이다.
    const machine = await call(server, "agent-mcp-auth/state", MACHINE_TOKEN, {
      servers: both,
    });
    assertEquals(machine.status, 403, JSON.stringify(machine.body));

    // 전역 서버 로그인.
    const first = await signIn(server, globalTarget);
    assertEquals(first.status, 200, JSON.stringify(first.body));
    assertEquals(first.body, { completed: true });
    const settings = await call(server, "settings/get", USER_TOKEN, {
      keys: [mcpServersSetting.key],
    });
    assertEquals(settings.status, 200, JSON.stringify(settings.body));
    const effective = (settings.body["settings"] as {
      key: string;
      value: {
        revision: number;
        http: { auth: { token_ref: string | null } };
      }[];
    }[]).find((entry) => entry.key === mcpServersSetting.key)!;
    assertEquals(
      effective.value[0]!.http.auth.token_ref,
      mcpTokenRef({ place: null, name: "notes" }),
    );
    assertEquals(effective.value[0]!.revision, 2);

    // 자리 서버 로그인: 그 자리 파일에 쓰인다.
    const second = await signIn(server, placeTarget);
    assertEquals(second.status, 200, JSON.stringify(second.body));
    const placeRead = await call(
      server,
      "place-extension-settings/read",
      USER_TOKEN,
      { place: placeTarget.place },
    );
    assertEquals(placeRead.status, 200, JSON.stringify(placeRead.body));
    const scoped = (placeRead.body["settings"] as {
      mcp_servers: {
        revision: number;
        http: { auth: { token_ref: string | null } };
      }[];
    }).mcp_servers[0]!;
    assertEquals(
      scoped.http.auth.token_ref,
      mcpTokenRef({ place: placeTarget.place, name: "scoped" } as never),
    );
    assertEquals(scoped.revision, 2);
    const file = JSON.parse(
      await Deno.readTextFile(`${home}/projects/${PROJECT}/mcp-servers.json`),
    );
    assertEquals(
      file.mcp_servers[0].http.auth.token_ref,
      mcpTokenRef({ place: placeTarget.place, name: "scoped" } as never),
    );
    assertEquals(exchanged.length, 2);
    assertEquals(
      await stateOf(server, both),
      [
        { ...globalTarget, state: "signed_in", reason: null },
        { ...placeTarget, state: "signed_in", reason: null },
      ],
    );
    // 값은 keychain에만 있다: ledger의 어느 응답에도 token이 없다.
    const dump = JSON.stringify([settings.body, placeRead.body, first.body]);
    assert(!dump.includes("access-") && !dump.includes("refresh-"));
    assert(keychain.stored.size >= 6);

    // core를 다시 띄워도 로그인 상태는 keychain과 설정에서 읽힌다.
    await booted.stop();
    booted = await boot(home, keychain, issuerFetch, "two");
    server = booted.server;
    assertEquals(
      await stateOf(server, both),
      [
        { ...globalTarget, state: "signed_in", reason: null },
        { ...placeTarget, state: "signed_in", reason: null },
      ],
    );
  } finally {
    await booted.stop();
    await issuer.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("lophn-agent/extensions#R16 [agent-I52]: through a real core a waiting sign-in is cancelled by the person and a wrong state is rejected, and signing in works again after each", async () => {
  const home = await Deno.makeTempDir({ prefix: "lophn-mcp-oauth-cancel-" });
  const keychain = createFakeKeychain();
  const issuer = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen: () => {} },
    () =>
      Response.json({
        access_token: `access-teal-orchard-${crypto.randomUUID()}`,
        refresh_token: `refresh-saffron-${crypto.randomUUID()}`,
        expires_in: 3600,
      }),
  );
  const issuerFetch = (url: string, init: RequestInit) =>
    fetch(
      url.replace(ISSUER, `http://127.0.0.1:${issuer.addr.port}`),
      init,
    );
  const booted = await boot(home, keychain, issuerFetch, "one");
  try {
    const { server } = booted;
    const target = { name: "notes", place: null };
    const definitions = await call(server, "settings/definitions", USER_TOKEN, {
      keys: [mcpServersSetting.key],
    });
    const applied = await call(server, "settings/apply", USER_TOKEN, {
      input: {
        changes: [{
          layer: "common",
          key: mcpServersSetting.key,
          action: "set",
          value: [oauthServer("https://mcp.example.test/rpc", "notes")],
        }],
      },
      idempotency_key: "oauth-cancel-apply-1",
      compare: {
        revision: 0,
        defaults_revision: definitions.body["defaults_revision"],
      },
      prepared: [],
    });
    assertEquals(applied.status, 200, JSON.stringify(applied.body));

    // 시작만 하고 browser가 열리지 않은 채 남은 로그인이다. 다시 시작하면 충돌이다.
    const begun = await call(server, "agent-mcp-auth/begin", USER_TOKEN, {
      ...target,
      client_id: "lophn",
      scopes: [],
    });
    assertEquals(begun.status, 200, JSON.stringify(begun.body));
    assertEquals((await stateOf(server, [target]))[0], {
      ...target,
      state: "in_progress",
      reason: null,
    });
    const busy = await call(server, "agent-mcp-auth/begin", USER_TOKEN, {
      ...target,
      client_id: "lophn",
      scopes: [],
    });
    assertEquals(busy.status, 409, JSON.stringify(busy.body));
    // 사람이 그만둔다.
    const cancelled = await call(
      server,
      "agent-mcp-auth/cancel",
      USER_TOKEN,
      target,
    );
    assertEquals(cancelled.status, 200, JSON.stringify(cancelled.body));
    assertEquals(cancelled.body, { cancelled: true });
    assertEquals((await stateOf(server, [target]))[0], {
      ...target,
      state: "none",
      reason: null,
    });

    // 잘못된 state는 거절이고 이유가 상태에 남는다.
    const second = await call(server, "agent-mcp-auth/begin", USER_TOKEN, {
      ...target,
      client_id: "lophn",
      scopes: [],
    });
    assertEquals(second.status, 200, JSON.stringify(second.body));
    const port = second.body["callback_port"] as number;
    const completing = call(server, "agent-mcp-auth/complete", USER_TOKEN, {
      ...target,
      callback_port: port,
    });
    await comeBack(port, "the-code", "the-evil-state");
    const rejected = await completing;
    assertEquals(rejected.status, 400, JSON.stringify(rejected.body));
    assertEquals((await stateOf(server, [target]))[0], {
      ...target,
      state: "failed",
      reason: "state_mismatch",
    });
    assertEquals(keychain.stored.size, 0);

    // 이제 정상 로그인이 끝까지 간다.
    const done = await signIn(server, target);
    assertEquals(done.status, 200, JSON.stringify(done.body));
    assertEquals((await stateOf(server, [target]))[0], {
      ...target,
      state: "signed_in",
      reason: null,
    });
  } finally {
    await booted.stop();
    await issuer.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
