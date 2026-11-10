import assert from "node:assert/strict";
import { test } from "node:test";

import { ok } from "../../../../base/mod.ts";
import type { Workspace } from "../../../../protocol/lophn-agent/workspaces.ts";
import { createSecretSlots } from "./secret-slot.ts";

const APP = `app_${"0".repeat(26)}`;
const OTHER = `app_${"1".repeat(26)}`;
const app = (id: string) => ({ kind: "app", id }) as Workspace;
const project = { kind: "project", id: `prj_${"0".repeat(26)}` } as Workspace;

function setup(connected: { id: string; key: string }[] = []) {
  return createSecretSlots({
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
                },
                {
                  key: "chatgpt",
                  display_name: "ChatGPT",
                  protocols: ["openai-responses"],
                  auth_kinds: ["oauth"],
                  models_endpoint: null,
                },
              ],
            }
          : key === "providers/list"
            ? {
                providers: connected.map((one) => ({
                  id: one.id,
                  endpoint: "https://openrouter.ai/api/v1",
                  definition: { key: one.key },
                  credential: {},
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
                        oauth: {},
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
    configured: (name) => name === "provider.old",
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
    code(await slots.resolve(project, { provider: "openrouter" })),
    "forbidden",
  );
  assert.equal(
    code(await slots.resolve(app(APP), { provider: "openrouter" })),
    "forbidden",
  );
  assert.equal(
    code(await slots.resolve(app(OTHER), { app: APP, secret: "notion" })),
    "forbidden",
  );
  assert.equal(
    code(await slots.resolve(project, { app: APP, secret: "notion" })),
    "forbidden",
  );

  // 없는 자리와 값을 넣는 자리가 아닌 것.
  assert.equal(
    code(await slots.resolve(null, { provider: "nope" })),
    "not_found",
  );
  assert.equal(
    code(await slots.resolve(null, { provider: "chatgpt" })),
    "invalid_input",
  );
  assert.equal(
    code(await slots.resolve(app(APP), { app: APP, secret: "undeclared" })),
    "not_found",
  );
  assert.equal(
    code(await slots.resolve(app(APP), { app: APP, secret: "gdrive" })),
    "invalid_input",
  );

  const mine = await slots.resolve(app(APP), { app: APP, secret: "notion" });
  assert.ok(mine.ok);
  assert.equal(mine.value.name, "notion");
  assert.deepEqual(mine.value.destinations, ["api.notion.com:443"]);
  assert.equal(mine.value.connect, null);
  assert.equal(
    code(await slots.resolve(null, { app: APP, secret: "notion" })),
    "ok",
  );

  // 새 provider는 새 id의 이름과 연결 입력을 싣고, 이미 연결된 provider는 그 key 자리만 가리킨다.
  const fresh = await slots.resolve(null, { provider: "openrouter" });
  assert.ok(fresh.ok);
  assert.equal(fresh.value.name, "provider.new");
  assert.deepEqual(fresh.value.destinations, ["https://openrouter.ai/api/v1"]);
  assert.equal((fresh.value.connect as { id: string }).id, "pvd_new");
  assert.equal(fresh.value.configured, false);
  const again = await setup([{ id: "pvd_old", key: "openrouter" }]).resolve(
    null,
    { provider: "openrouter" },
  );
  assert.ok(again.ok);
  assert.equal(again.value.name, "provider.old");
  assert.equal(again.value.connect, null);
  assert.equal(again.value.configured, true);
});
