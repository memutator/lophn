import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { err, ok } from "../../../base/mod.ts";
import type { RequestContext, Sql, Tx } from "../../../protocol/server/mod.ts";
import { createProviderCommands } from "./commands.ts";
import { builtinProviderDefinition } from "./definitions.ts";
import { createProviderRefresher } from "./oauth-refresh.ts";
import { loadProvider } from "./store.ts";
import { providerSchemaSteps } from "./schema.ts";

const ID = "pvd_00000000000000000000000001";
const ACCESS = "provider.00000000000000000000000001";
const MODELS_URL = "https://api.openai.com/v1/models";
const NOW = Date.parse("2026-10-17T00:00:00.000Z");
const at = (ms: number) => new Date(ms).toISOString();

// 실제 provider 표에 ChatGPT 로그인으로 연결한 provider 하나를 두고, 그 token 셋을 가짜 저장소에 둔다.
function setup(expiresAtMs: number) {
  const db = new DatabaseSync(":memory:");
  for (const step of providerSchemaSteps) db.exec(step.sql);
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  const tx = { now: () => at(NOW), sql } as unknown as Tx;
  const commands = createProviderCommands();
  const definition = builtinProviderDefinition("openai");
  assert.ok(definition.ok);
  const connected = commands.connect.handle(
    tx,
    { actor: "user" } as RequestContext,
    {
      id: ID,
      name: "OpenAI",
      definition: definition.value,
      endpoint: "https://api.openai.com/v1",
      protocol: "openai-responses",
      auth_kind: "oauth",
      credential: { secret: ACCESS },
      expires_at: at(expiresAtMs),
    } as never,
    undefined as never,
  );
  assert.ok(connected.ok);
  const secrets = new Map([
    [ACCESS, "OLD-ACCESS"],
    [`${ACCESS}.refresh`, "OLD-REFRESH"],
    [`${ACCESS}.meta`, JSON.stringify({ client_id: "oaiapp_x", subject: "u" })],
  ]);
  const read = () => {
    const found = loadProvider(sql, ID);
    assert.ok(found.ok && found.value !== null);
    return found.value;
  };
  // models: 계정 model 목록 GET의 답이다(없으면 발급자 대기열이 닿지 못한 것처럼 던진다).
  const refresher = (answer: Response, models?: () => Response) =>
    createProviderRefresher({
      readProvider: (provider) => Promise.resolve(loadProvider(sql, provider)),
      secrets: {
        get: (name) =>
          secrets.has(name)
            ? ok(secrets.get(name)!)
            : err({ code: "not_found", message: "없다" }),
        put: (name, value) => {
          secrets.set(name, String(value));
          return Promise.resolve(ok({ names: [] }) as never);
        },
        delete: (name) => {
          secrets.delete(name);
          return Promise.resolve(ok({ names: [] }) as never);
        },
      },
      http: (url) => {
        if (url !== MODELS_URL) return Promise.resolve(answer);
        return models === undefined
          ? Promise.reject(new Error("no runtime"))
          : Promise.resolve(models());
      },
      recordModels: (provider, list) =>
        Promise.resolve(commands.recordModels.handle(
          tx,
          { actor: "machine" } as RequestContext,
          { provider: provider.id, models: list } as never,
          { revision: provider.revision },
        )),
      record: (provider, result) =>
        Promise.resolve(commands.refreshCredential.handle(
          tx,
          { actor: "machine" } as RequestContext,
          {
            provider: provider.id,
            expires_at: "expires_at" in result ? result.expires_at : null,
            unavailable_reason: "unavailable_reason" in result
              ? result.unavailable_reason
              : null,
          } as never,
          { revision: provider.revision },
        )),
      nowMs: () => NOW,
      leadMs: 5 * 60_000,
    });
  const expire = (ms: number) =>
    db.prepare(
      "update provider_credentials set expires_at = ? where provider = ?",
    )
      .run(at(ms), ID);
  return { secrets, read, refresher, expire };
}

const use = {
  name: ACCESS,
  destination: { kind: "https" as const, origin: "https://api.openai.com" },
};

test("갱신은 회전한 refresh token을 저장하고, invalid_grant면 credential을 revoked로 하고 token을 내주지 않는다", async () => {
  // 만료 1분 전: 회전한 refresh와 새 access를 저장하고 만료를 올린다.
  const rotated = setup(NOW + 60_000);
  const fresh = await rotated.refresher(Response.json({
    access_token: "NEW-ACCESS",
    refresh_token: "NEW-REFRESH",
    expires_in: 3600,
  })).prepareToken(use);
  assert.deepStrictEqual(fresh, ok(undefined));
  assert.deepStrictEqual(
    [
      rotated.secrets.get(ACCESS),
      rotated.secrets.get(`${ACCESS}.refresh`),
      rotated.read().credential.state,
      rotated.read().credential.expires_at,
    ],
    ["NEW-ACCESS", "NEW-REFRESH", "available", at(NOW + 3_600_000)],
  );

  // 발급자가 grant를 거절하면 revoked가 되고 token을 내주지 않는다.
  const dead = setup(NOW + 60_000);
  const refused = await dead.refresher(
    Response.json({ error: "invalid_grant" }, { status: 400 }),
  ).prepareToken(use);
  assert.deepStrictEqual(
    refused?.ok === false && refused.error.code,
    "forbidden",
  );
  const credential = dead.read().credential;
  assert.deepStrictEqual(
    [credential.state, credential.unavailable_reason],
    ["revoked", "refresh_revoked"],
  );

  // 만료가 lead보다 멀면 갱신하지 않는다.
  const later = setup(NOW + 3_600_000);
  const untouched = await later.refresher(Response.json({
    access_token: "NEW-ACCESS",
    refresh_token: "NEW-REFRESH",
  })).prepareToken(use);
  assert.deepStrictEqual(
    [untouched, later.secrets.get(`${ACCESS}.refresh`), later.read().revision],
    [undefined, "OLD-REFRESH", 1],
  );
});

test("갱신하면 계정 model 목록이 저장되고, 읽기가 틀려도 갱신은 성공하며 앞서 저장한 목록이 남는다", async () => {
  const token = () =>
    Response.json({ access_token: "A", refresh_token: "R", expires_in: 3600 });
  const listed = () =>
    Response.json({
      data: [
        { id: "gpt-5", visibility: "list" },
        { id: "gpt-5-pro", visibility: "hide" },
        { id: "gpt-5-mini" },
      ],
    });
  const kept = ["gpt-5", "gpt-5-mini"];
  const t = setup(NOW + 60_000);
  const first = t.refresher(token(), listed);
  assert.deepStrictEqual(await first.prepareToken(use), ok(undefined));
  await first.idle();
  assert.deepStrictEqual(t.read().credential.reported_models, kept);

  // 다시 갱신할 때 읽기가 던지거나 모양이 틀려도 token은 새로 저장되고 목록은 그대로다.
  for (const broken of [undefined, () => Response.json({ nope: 1 })]) {
    t.secrets.set(ACCESS, "OLD-ACCESS");
    t.expire(NOW + 60_000);
    const again = t.refresher(token(), broken);
    assert.deepStrictEqual(await again.prepareToken(use), ok(undefined));
    await again.idle();
    assert.deepStrictEqual(t.secrets.get(ACCESS), "A");
    assert.deepStrictEqual(t.read().credential.reported_models, kept);
  }
});
