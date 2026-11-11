import assert from "node:assert/strict";
import { test } from "node:test";

import { ok } from "../../../../base/mod.ts";
import type { Workspace } from "../../../../protocol/lophn-agent/workspaces.ts";
import type { RegisteredMcpServer } from "../../../lophn-agent/extensions/mcp-snapshot.ts";
import { createSecretSlots } from "./secret-slot.ts";

const APP = `app_${"0".repeat(26)}`;
const OTHER = `app_${"1".repeat(26)}`;
const app = (id: string) => ({ kind: "app", id }) as Workspace;
const project = { kind: "project", id: `prj_${"0".repeat(26)}` } as Workspace;

const AGENT = "agt_00000000000000000000000000";

// 설정에 있는 MCP server. 소유자(전역, Home, project, agent 정의)만 다르다.
const http = (
  name: string,
  auth: object,
  headers: Record<string, object> = {},
) =>
  ({
    name,
    enabled: true,
    transport: "http",
    http: { url: "https://mcp.notion.com/v1", headers, auth },
  }) as unknown as RegisteredMcpServer["server"];
const entry = (
  server: RegisteredMcpServer["server"],
  owner: Partial<Pick<RegisteredMcpServer, "workspace" | "agent">> = {},
): RegisteredMcpServer => ({ workspace: null, agent: null, ...owner, server });
const bearer = (secret: string) => ({ kind: "bearer", secret });
const OAUTH = {
  kind: "oauth2",
  issuer: "https://auth.notion.com",
  client_id: "cid",
  client_secret: "mcp.global.notion.client",
  scopes: ["read"],
};

function setup(
  connected: { id: string; key: string }[] = [],
  mcp: RegisteredMcpServer[] = [],
) {
  return createSecretSlots({
    mcpServers: () => Promise.resolve(ok(mcp)),
    read: <T>(route: { resource: string; method: string }) => {
      const key = `${route.resource}/${route.method}`;
      const value =
        key === "providers/definitions"
          ? {
              definitions: [
                {
                  key: "openrouter",
                  display_name: "OpenRouter",
                  protocols: ["openai-chat-completions"],
                  auth_kinds: ["api_key"],
                  models_endpoint: "https://openrouter.ai/api/v1/models",
                  oauth: null,
                },
                {
                  key: "chatgpt",
                  display_name: "ChatGPT",
                  protocols: ["openai-responses"],
                  auth_kinds: ["oauth"],
                  models_endpoint: "https://chatgpt.com/models",
                  oauth: {
                    product: "chatgpt",
                    inference_endpoint: "https://chatgpt.com/backend-api/codex",
                  },
                },
                {
                  key: "anthropic",
                  display_name: "Anthropic",
                  protocols: ["anthropic-messages"],
                  auth_kinds: ["api_key", "oauth"],
                  models_endpoint: "https://api.anthropic.com/v1/models",
                  oauth: { product: "claude" },
                },
              ],
            }
          : key === "providers/list"
            ? {
                providers: connected.map((one) => ({
                  id: one.id,
                  endpoint: "https://openrouter.ai/api/v1",
                  definition: { key: one.key },
                  credential: { kind: "api_key" },
                })),
                next_cursor: null,
              }
            : key === "apps/get"
              ? { app: { name: "Notes" } }
              : {
                  grants: [
                    { scope: { kind: "secret.use", name: "notion" } },
                    {
                      scope: {
                        kind: "secret.use",
                        name: "gdrive",
                        oauth: {
                          authorization_endpoint:
                            "https://accounts.google.com/o/oauth2/auth",
                        },
                      },
                    },
                    {
                      scope: {
                        kind: "secret.use",
                        name: "unset",
                        oauth: {
                          authorization_endpoint: "https://x.example/auth",
                        },
                      },
                    },
                    {
                      scope: {
                        kind: "net.fetch",
                        host: "api.notion.com",
                        port: 443,
                      },
                    },
                  ],
                  next_cursor: null,
                };
      return Promise.resolve(ok(value as T));
    },
    newProviderId: () => "pvd_new",
    configured: (name) =>
      name === "provider.old" || name === "app-oauth.gdrive.client_id",
  });
}
const code = (result: { ok: boolean }) =>
  result.ok
    ? "ok"
    : (result as unknown as { error: { code: string } }).error.code;

// 자리를 넓게 받으면 앱·project의 agent가 모든 workspace의 provider를 건드리거나 남의 앱 secret에 값을 넣게 하는 card를 띄운다.
// 이름을 agent가 정하게 두면 값이 agent가 고른 목적지로 나가는 이름에 들어간다.
test("provider 자리는 home만, 앱 자리는 그 앱과 home만 청하고 이름과 목적지는 정의·선언에서 나온다", async () => {
  const slots = setup();
  assert.equal(
    code(await slots.resolve(project, AGENT, { provider: "openrouter" })),
    "forbidden",
  );
  assert.equal(
    code(await slots.resolve(app(APP), AGENT, { provider: "openrouter" })),
    "forbidden",
  );
  assert.equal(
    code(
      await slots.resolve(app(OTHER), AGENT, { app: APP, secret: "notion" }),
    ),
    "forbidden",
  );
  assert.equal(
    code(await slots.resolve(project, AGENT, { app: APP, secret: "notion" })),
    "forbidden",
  );

  // 없는 자리와 값을 넣는 자리가 아닌 것.
  assert.equal(
    code(await slots.resolve(null, AGENT, { provider: "nope" })),
    "not_found",
  );
  assert.equal(
    code(
      await slots.resolve(null, AGENT, {
        provider: "openrouter",
        sign_in: true,
      }),
    ),
    "invalid_input",
  );
  assert.equal(
    code(
      await slots.resolve(app(APP), AGENT, { app: APP, secret: "undeclared" }),
    ),
    "not_found",
  );

  const mine = await slots.resolve(app(APP), AGENT, {
    app: APP,
    secret: "notion",
  });
  assert.ok(mine.ok && mine.value.kind === "secret");
  assert.equal(mine.value.name, "notion");
  assert.deepEqual(mine.value.destinations, ["api.notion.com:443"]);
  assert.equal(mine.value.connect, null);
  assert.equal(
    code(await slots.resolve(null, AGENT, { app: APP, secret: "notion" })),
    "ok",
  );

  // 새 provider는 새 id의 이름과 연결 입력을 싣고, 이미 연결된 provider는 그 key 자리만 가리킨다.
  const fresh = await slots.resolve(null, AGENT, { provider: "openrouter" });
  assert.ok(fresh.ok && fresh.value.kind === "secret");
  assert.equal(fresh.value.name, "provider.new");
  assert.deepEqual(fresh.value.destinations, ["https://openrouter.ai/api/v1"]);
  assert.equal((fresh.value.connect as { id: string }).id, "pvd_new");
  assert.equal(fresh.value.configured, false);
  const again = await setup([{ id: "pvd_old", key: "openrouter" }]).resolve(
    null,
    AGENT,
    { provider: "openrouter" },
  );
  assert.ok(again.ok && again.value.kind === "secret");
  assert.equal(again.value.name, "provider.old");
  assert.equal(again.value.connect, null);
  assert.equal(again.value.configured, true);
});

// 값이 아니라 로그인인 자리는 card의 [Sign in]이 되고, 무엇에 로그인하는지는 core가 정의·선언에서 읽은 target이다.
// API key와 로그인을 둘 다 가진 정의는 기본이 key라서 agent가 flag를 줘야 로그인이다.
test("로그인 자리는 sign_in 요청이 되고 key와 로그인을 둘 다 가진 provider는 기본이 key다", async () => {
  const slots = setup();
  const key = await slots.resolve(null, AGENT, { provider: "anthropic" });
  assert.ok(key.ok);
  assert.equal(key.value.kind, "secret");
  const login = await slots.resolve(null, AGENT, {
    provider: "anthropic",
    sign_in: true,
  });
  assert.ok(login.ok && login.value.kind === "sign_in");
  assert.equal(login.value.target.type, "provider");
  // 구독뿐인 정의는 flag 없이 로그인이고, ChatGPT 로그인은 Codex endpoint로 간다.
  const only = await slots.resolve(null, AGENT, { provider: "chatgpt" });
  assert.ok(only.ok && only.value.kind === "sign_in");
  assert.deepEqual(only.value.destinations, ["https://chatgpt.com"]);
  // 이미 연결된 provider에는 다시 로그인하지 않는다(connect가 conflict라 로그인만 헛돈다).
  const taken = setup([{ id: "pvd_old", key: "anthropic" }]);
  assert.equal(
    code(
      await taken.resolve(null, AGENT, {
        provider: "anthropic",
        sign_in: true,
      }),
    ),
    "conflict",
  );

  const app1 = await slots.resolve(app(APP), AGENT, {
    app: APP,
    secret: "gdrive",
  });
  assert.ok(app1.ok && app1.value.kind === "sign_in");
  assert.deepEqual(app1.value.destinations, ["https://accounts.google.com"]);
  // client id가 아직 없으면 로그인이 시작되지 못하니 agent에게 사람이 할 일을 알린다.
  assert.equal(
    code(await slots.resolve(app(APP), AGENT, { app: APP, secret: "unset" })),
    "conflict",
  );
});

// custom provider는 agent가 base URL을 넘기므로 사람이 card에서 host를 보고 key를 넣는 것이 확인이다.
// key 없는 연결은 이 컴퓨터의 주소에만 있고 요청으로는 만들 수 없다.
test("custom provider는 https 주소만 key와 함께 받고 이름은 core가 정한다", async () => {
  const slots = setup();
  const river = {
    display_name: "River",
    base_url: "https://api.river.ai/v1/",
    protocol: "openai-chat-completions",
  } as const;
  const asked = await slots.resolve(null, AGENT, river);
  assert.ok(asked.ok && asked.value.kind === "secret");
  assert.deepEqual(asked.value.destinations, ["https://api.river.ai/v1"]);
  assert.equal(asked.value.name, "provider.new");
  assert.equal(
    (asked.value.connect as { endpoint: string }).endpoint,
    "https://api.river.ai/v1",
  );
  assert.equal(code(await slots.resolve(project, AGENT, river)), "forbidden");
  for (const base_url of [
    "http://api.river.ai/v1",
    "http://localhost:11434/v1",
    "ftp://x",
  ]) {
    assert.equal(
      code(await slots.resolve(null, AGENT, { ...river, base_url })),
      "invalid_input",
    );
  }
  // 내장 provider의 key를 custom 이름으로 가로채지 못한다.
  assert.equal(
    code(
      await slots.resolve(null, AGENT, {
        ...river,
        display_name: "OpenRouter",
      }),
    ),
    "invalid_input",
  );
});

// MCP server의 값은 그 server를 쓰는 층의 session만 청한다: home은 전역·Home·자기 정의, project·앱은 자기 정의와 자기 workspace.
// 다른 project의 server에 값을 넣게 하는 card를 띄우지 못해야 한다.
test("MCP 자리는 session이 닿는 층의 server만 풀리고 청할 것이 여럿이면 고르게 한다", async () => {
  const other = `prj_${"1".repeat(26)}`;
  const mine = (
    here: Workspace | null,
    slot: { mcp: string; part?: string },
    agent = AGENT,
    layers = [
      entry(http("notion", bearer("mcp.global.notion"))),
      entry(http("home-only", bearer("mcp.home.home-only")), {
        workspace: { kind: "home" },
      }),
      entry(http("proj", bearer("mcp.prj.proj")), {
        workspace: { kind: "project", id: project.id },
      }),
      entry(http("other", bearer("mcp.prj.other")), {
        workspace: { kind: "project", id: other as `prj_${string}` },
      }),
      entry(http("agent-own", bearer("mcp.agt.own")), { agent: AGENT }),
      entry(http("agent-else", bearer("mcp.agt.else")), {
        agent: "agt_11111111111111111111111111",
      }),
    ],
  ) => setup([], layers).resolve(here, agent, slot);

  assert.equal(code(await mine(null, { mcp: "notion" })), "ok");
  assert.equal(code(await mine(null, { mcp: "home-only" })), "ok");
  assert.equal(code(await mine(null, { mcp: "agent-own" })), "ok");
  assert.equal(code(await mine(null, { mcp: "proj" })), "not_found");
  assert.equal(code(await mine(null, { mcp: "agent-else" })), "not_found");
  // project·앱 session은 전역과 Home과 다른 workspace에 닿지 않는다.
  assert.equal(code(await mine(project, { mcp: "notion" })), "not_found");
  assert.equal(code(await mine(project, { mcp: "home-only" })), "not_found");
  assert.equal(code(await mine(project, { mcp: "other" })), "not_found");
  assert.equal(code(await mine(project, { mcp: "proj" })), "ok");
  assert.equal(code(await mine(project, { mcp: "agent-own" })), "ok");
  assert.equal(code(await mine(app(APP), { mcp: "proj" })), "not_found");

  const found = await mine(null, { mcp: "notion" });
  assert.ok(found.ok && found.value.kind === "secret");
  assert.equal(found.value.name, "mcp.global.notion");
  assert.deepEqual(found.value.destinations, ["https://mcp.notion.com"]);

  // 같은 이름이 여러 층에 있으면 실제로 쓰이는 agent 층이 이긴다.
  const shadowed = await mine(null, { mcp: "notion" }, AGENT, [
    entry(http("notion", bearer("mcp.global.notion"))),
    entry(http("notion", bearer("mcp.agt.notion")), { agent: AGENT }),
  ]);
  assert.ok(shadowed.ok && shadowed.value.kind === "secret");
  assert.equal(shadowed.value.name, "mcp.agt.notion");

  // stdio나 값이 없는 server에는 자리가 없다.
  const bare = [
    entry(http("plain", { kind: "none" })),
    entry({
      name: "local",
      enabled: true,
      transport: "stdio",
      stdio: { executable: "/bin/x" },
    } as unknown as RegisteredMcpServer["server"]),
  ];
  assert.equal(
    code(await mine(null, { mcp: "plain" }, AGENT, bare)),
    "not_found",
  );
  assert.equal(
    code(await mine(null, { mcp: "local" }, AGENT, bare)),
    "not_found",
  );

  // 청할 것이 여럿이면 part로 고르고, OAuth는 로그인이다. 이름은 agent가 정하지 못한다.
  const many = [
    entry(
      http("notion", OAUTH, {
        "X-Team": { kind: "secret", secret: "mcp.global.notion.team" },
      }),
    ),
  ];
  assert.equal(
    code(await mine(null, { mcp: "notion" }, AGENT, many)),
    "invalid_input",
  );
  assert.equal(
    code(await mine(null, { mcp: "notion", part: "nope" }, AGENT, many)),
    "invalid_input",
  );
  const login = await mine(
    null,
    { mcp: "notion", part: "sign_in" },
    AGENT,
    many,
  );
  assert.ok(login.ok && login.value.kind === "sign_in");
  assert.deepEqual(login.value.destinations, ["https://auth.notion.com"]);
  const client = await mine(
    null,
    { mcp: "notion", part: "client" },
    AGENT,
    many,
  );
  assert.ok(client.ok && client.value.kind === "secret");
  assert.equal(client.value.name, "mcp.global.notion.client");
  assert.deepEqual(client.value.destinations, ["https://auth.notion.com"]);
  const header = await mine(
    null,
    { mcp: "notion", part: "header:X-Team" },
    AGENT,
    many,
  );
  assert.ok(header.ok && header.value.kind === "secret");
  assert.equal(header.value.name, "mcp.global.notion.team");
});
