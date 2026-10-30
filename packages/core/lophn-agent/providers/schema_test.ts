import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { providerSchemaSteps } from "./schema.ts";
import { loadProvider } from "./store.ts";

// 사람의 ledger에 남은 옛 ChatGPT 연결(공식 Sign in with ChatGPT 정의)이 새 판에서 읽히지 않으면 provider 목록과 그
// provider를 고른 agent가 모두 깨진다. 옮긴 뒤에는 읽히고, 옛 token은 쓰지 않도록 revoked다. 다른 provider는 그대로다.
test("옛 ChatGPT 연결은 새 정의로 옮겨 읽히고 다시 로그인하게 revoked가 되며, 다른 provider는 그대로다", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(providerSchemaSteps[0]!.sql);
  const oldChatGpt = {
    key: "openai",
    display_name: "OpenAI",
    protocols: ["openai-responses", "openai-chat-completions"],
    auth_kinds: ["api_key", "oauth"],
    models_endpoint: "https://api.openai.com/v1/models",
    oauth: {
      product: "chatgpt",
      issuer: "https://auth.openai.com",
      authorization_endpoint: "https://auth.openai.com/api/accounts/authorize",
      token_endpoint: "https://auth.openai.com/api/accounts/oauth/token",
      jwks_uri: "https://auth.openai.com/.well-known/jwks.json",
      resource: "https://api.openai.com/v1",
      scopes: ["openid", "chatgpt.tokens.use.direct"],
    },
    revision: "2026-10",
  };
  const apiKey = { ...oldChatGpt, auth_kinds: ["api_key"], oauth: null };
  const insert = (id: string, definition: unknown, kind: string) => {
    db.prepare(
      `insert into providers (id, name, definition_key, definition, endpoint, protocol, revision)
       values (?, 'OpenAI', 'openai', ?, 'https://api.openai.com/v1', 'openai-responses', 1)`,
    ).run(id, JSON.stringify(definition));
    db.prepare(
      `insert into provider_credentials (provider, kind, secret_name, revision, state, reported_models)
       values (?, ?, ?, 1, 'available', '["gpt-5"]')`,
    ).run(id, kind, `provider.${id.slice(4)}`);
  };
  insert("pvd_00000000000000000000000001", oldChatGpt, "oauth");
  insert("pvd_00000000000000000000000002", apiKey, "api_key");
  const sql = {
    get: (q: string, p: unknown[]) => db.prepare(q).get(...(p as never[])),
    all: (q: string, p: unknown[]) => db.prepare(q).all(...(p as never[])),
    run: (q: string, p: unknown[]) => db.prepare(q).run(...(p as never[])),
  } as never;
  assert.deepStrictEqual(
    loadProvider(sql, "pvd_00000000000000000000000001").ok,
    false,
  );

  db.exec(providerSchemaSteps[1]!.sql);

  const moved = loadProvider(sql, "pvd_00000000000000000000000001");
  const untouched = loadProvider(sql, "pvd_00000000000000000000000002");
  assert.ok(moved.ok && moved.value !== null);
  assert.ok(untouched.ok && untouched.value !== null);
  assert.deepStrictEqual(
    {
      endpoint: moved.value.endpoint,
      client:
        moved.value.definition.oauth?.product === "chatgpt"
          ? moved.value.definition.oauth.client_id
          : null,
      state: moved.value.credential.state,
      reason: moved.value.credential.unavailable_reason,
      models: moved.value.credential.reported_models,
    },
    {
      endpoint: "https://chatgpt.com/backend-api/codex",
      client: "app_EMoamEEZ73f0CkXaXp7hrann",
      state: "revoked",
      reason: "refresh_revoked",
      models: null,
    },
  );
  assert.deepStrictEqual(
    [
      untouched.value.endpoint,
      untouched.value.credential.state,
      untouched.value.revision,
    ],
    ["https://api.openai.com/v1", "available", 1],
  );
});
