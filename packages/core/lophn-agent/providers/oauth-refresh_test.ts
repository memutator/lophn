import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { err, ok } from "../../../base/mod.ts";
import type { RequestContext, Sql, Tx } from "../../../protocol/server/mod.ts";
import { createProviderCommands } from "./commands.ts";
import { builtinProviderDefinition } from "./definitions.ts";
import { createProviderRefresher } from "./oauth-refresh.ts";
import { loadProvider } from "./store.ts";
import {
  providerReportedModelLimitsSchemaSteps,
  providerSchemaSteps,
} from "./schema.ts";

const ID = "pvd_00000000000000000000000001";
const ACCESS = "provider.00000000000000000000000001";
const ENDPOINT = "https://chatgpt.com/backend-api/codex";
const MODELS_URL = `${ENDPOINT}/models?client_version=0.159.0`;
const NOW = Date.parse("2026-10-17T00:00:00.000Z");
const at = (ms: number) => new Date(ms).toISOString();

// 실제 provider 표에 구독 로그인으로 연결한 provider 하나를 두고, 그 token 셋을 가짜 저장소에 둔다.
function setup(expiresAtMs: number, product: "chatgpt" | "claude" = "chatgpt") {
  const db = new DatabaseSync(":memory:");
  for (const step of providerSchemaSteps) db.exec(step.sql);
  for (const step of providerReportedModelLimitsSchemaSteps) db.exec(step.sql);
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  const tx = { now: () => at(NOW), sql } as unknown as Tx;
  const commands = createProviderCommands();
  const definition = builtinProviderDefinition(
    product === "chatgpt" ? "openai" : "anthropic",
  );
  assert.ok(definition.ok);
  const connected = commands.connect.handle(
    tx,
    { actor: "user" } as RequestContext,
    {
      id: ID,
      name: "OpenAI",
      definition: definition.value,
      endpoint:
        product === "chatgpt" ? ENDPOINT : "https://api.anthropic.com/v1",
      protocol:
        product === "chatgpt" ? "openai-responses" : "anthropic-messages",
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
    [`${ACCESS}.meta`, JSON.stringify({ subject: "u" })],
  ]);
  // broken이면 저장이 모두 실패한다.
  const store = { broken: false };
  const read = () => {
    const found = loadProvider(sql, ID);
    assert.ok(found.ok && found.value !== null);
    return found.value;
  };
  // models: 계정 model 목록 GET의 답이다(없으면 발급자 대기열이 닿지 못한 것처럼 던진다).
  const sent: { url: string; init: RequestInit }[] = [];
  const refresher = (
    answer: Response | (() => Promise<Response>),
    models?: () => Response,
  ) =>
    createProviderRefresher({
      readProvider: (provider) => Promise.resolve(loadProvider(sql, provider)),
      secrets: {
        get: (name) =>
          secrets.has(name)
            ? ok(secrets.get(name)!)
            : err({ code: "not_found", message: "없다" }),
        put: (name, value) => {
          if (store.broken) {
            return Promise.resolve(
              err({ code: "unavailable", message: "막혔다" }),
            );
          }
          secrets.set(name, String(value));
          return Promise.resolve(ok({ names: [] }) as never);
        },
        delete: (name) => {
          secrets.delete(name);
          return Promise.resolve(ok({ names: [] }) as never);
        },
      },
      http: (url, init) => {
        sent.push({ url, init });
        if (url !== MODELS_URL) {
          return typeof answer === "function"
            ? answer()
            : Promise.resolve(answer);
        }
        return models === undefined
          ? Promise.reject(new Error("no runtime"))
          : Promise.resolve(models());
      },
      recordModels: (provider, roster) =>
        Promise.resolve(
          commands.recordModels.handle(
            tx,
            { actor: "machine" } as RequestContext,
            {
              provider: provider.id,
              models: roster.models,
              model_limits: roster.limits,
            } as never,
            { revision: provider.revision },
          ),
        ),
      record: (provider, result) =>
        Promise.resolve(
          commands.refreshCredential.handle(
            tx,
            { actor: "machine" } as RequestContext,
            {
              provider: provider.id,
              expires_at: "expires_at" in result ? result.expires_at : null,
              unavailable_reason:
                "unavailable_reason" in result
                  ? result.unavailable_reason
                  : null,
            } as never,
            { revision: provider.revision },
          ),
        ),
      nowMs: () => NOW,
      leadMs: 5 * 60_000,
    });
  const expire = (ms: number) =>
    db
      .prepare(
        "update provider_credentials set expires_at = ? where provider = ?",
      )
      .run(at(ms), ID);
  const disconnect = () => {
    const removed = commands.disconnect.handle(
      tx,
      { actor: "user" } as RequestContext,
      { provider: ID } as never,
      { revision: read().revision },
    );
    assert.ok(removed.ok);
    secrets.clear();
  };
  return { secrets, read, refresher, expire, sent, disconnect, store };
}

const use = {
  name: ACCESS,
  destination: { kind: "https" as const, origin: "https://chatgpt.com" },
};

test("갱신은 회전한 refresh token을 저장하고, invalid_grant면 credential을 revoked로 하고 token을 내주지 않는다", async () => {
  // 만료 1분 전: 회전한 refresh와 새 access를 저장하고 만료를 올린다.
  const rotated = setup(NOW + 60_000);
  const fresh = await rotated
    .refresher(
      Response.json({
        access_token: "NEW-ACCESS",
        refresh_token: "NEW-REFRESH",
        expires_in: 3600,
      }),
    )
    .prepareToken(use);
  assert.deepStrictEqual(fresh, ok(undefined));
  const grant = rotated.sent[0]!;
  assert.deepStrictEqual(
    [
      grant.url,
      Object.fromEntries(new URLSearchParams(String(grant.init.body))),
      rotated.secrets.get(ACCESS),
      rotated.secrets.get(`${ACCESS}.refresh`),
      rotated.read().credential.state,
      rotated.read().credential.expires_at,
    ],
    [
      "https://auth.openai.com/oauth/token",
      {
        grant_type: "refresh_token",
        client_id: "app_EMoamEEZ73f0CkXaXp7hrann",
        refresh_token: "OLD-REFRESH",
      },
      "NEW-ACCESS",
      "NEW-REFRESH",
      "available",
      at(NOW + 3_600_000),
    ],
  );

  // 발급자가 grant를 거절하면 revoked가 되고 token을 내주지 않는다.
  const dead = setup(NOW + 60_000);
  const refused = await dead
    .refresher(Response.json({ error: "invalid_grant" }, { status: 400 }))
    .prepareToken(use);
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
  const untouched = await later
    .refresher(
      Response.json({
        access_token: "NEW-ACCESS",
        refresh_token: "NEW-REFRESH",
      }),
    )
    .prepareToken(use);
  assert.deepStrictEqual(
    [untouched, later.secrets.get(`${ACCESS}.refresh`), later.read().revision],
    [undefined, "OLD-REFRESH", 1],
  );
});

test("갱신하면 계정 model 목록과 Codex가 밝힌 한도가 저장되고, 읽기가 틀려도 앞서 저장한 것이 남는다", async () => {
  const token = () =>
    Response.json({ access_token: "A", refresh_token: "R", expires_in: 3600 });
  const listed = () =>
    Response.json({
      models: [
        {
          slug: "gpt-5",
          visibility: "list",
          context_window: 272000,
          max_context_window: 400000,
          max_output_tokens: 128000,
        },
        { slug: "gpt-5-pro", visibility: "hide", context_window: 1 },
        { slug: "gpt-5-mini", context_window: 128000, max_output_tokens: 0 },
      ],
    });
  const kept = ["gpt-5", "gpt-5-mini"];
  const keptLimits = {
    "gpt-5": {
      context_limit: 272000,
      max_context_limit: 400000,
      output_limit: 128000,
    },
    "gpt-5-mini": {
      context_limit: 128000,
      max_context_limit: null,
      output_limit: null,
    },
  };
  const t = setup(NOW + 60_000);
  const first = t.refresher(token(), listed);
  assert.deepStrictEqual(await first.prepareToken(use), ok(undefined));
  await first.idle();
  assert.deepStrictEqual(t.read().credential.reported_models, kept);
  assert.deepStrictEqual(t.read().credential.reported_model_limits, keptLimits);

  // 다시 갱신할 때 읽기가 던지거나 모양이 틀려도 token은 새로 저장되고 목록·한도는 그대로다.
  for (const broken of [undefined, () => Response.json({ nope: 1 })]) {
    t.secrets.set(ACCESS, "OLD-ACCESS");
    t.expire(NOW + 60_000);
    const again = t.refresher(token(), broken);
    assert.deepStrictEqual(await again.prepareToken(use), ok(undefined));
    await again.idle();
    assert.deepStrictEqual(t.secrets.get(ACCESS), "A");
    assert.deepStrictEqual(t.read().credential.reported_models, kept);
    assert.deepStrictEqual(
      t.read().credential.reported_model_limits,
      keptLimits,
    );
  }

  // 성공했지만 한도를 밝히지 않으면 앞서 저장한 한도는 지워진다(목록은 그대로다).
  t.secrets.set(ACCESS, "OLD-ACCESS");
  t.expire(NOW + 60_000);
  const bare = t.refresher(token(), () =>
    Response.json({ models: [{ slug: "gpt-5" }, { slug: "gpt-5-mini" }] }),
  );
  assert.deepStrictEqual(await bare.prepareToken(use), ok(undefined));
  await bare.idle();
  assert.deepStrictEqual(t.read().credential.reported_models, kept);
  assert.equal(t.read().credential.reported_model_limits, undefined);
});

test("Claude 갱신은 JSON grant를 보내고 refresh token이 안 오면 지금 것을 지키며, 기다리는 동안 끊은 연결은 되살리지 않는다", async () => {
  const claude = {
    ...use,
    destination: {
      kind: "https" as const,
      origin: "https://api.anthropic.com",
    },
  };
  const kept = setup(NOW + 60_000, "claude");
  const fresh = await kept
    .refresher(Response.json({ access_token: "NEW-ACCESS", expires_in: 3600 }))
    .prepareToken(claude);
  assert.deepStrictEqual(fresh, ok(undefined));
  const grant = kept.sent[0]!;
  const headers = new Headers(grant.init.headers);
  assert.deepStrictEqual(
    [
      grant.url,
      headers.get("content-type"),
      headers.get("anthropic-beta"),
      JSON.parse(String(grant.init.body)),
      kept.secrets.get(ACCESS),
      kept.secrets.get(`${ACCESS}.refresh`),
    ],
    [
      "https://api.anthropic.com/v1/oauth/token",
      "application/json",
      "oauth-2025-04-20",
      {
        grant_type: "refresh_token",
        client_id: "9d1c250a-e61b-44d9-88ed-5944d1962f5e",
        refresh_token: "OLD-REFRESH",
      },
      "NEW-ACCESS",
      "OLD-REFRESH",
    ],
  );

  // 발급자의 답을 기다리는 사이 사람이 연결을 끊었다. 늦게 온 token은 저장하지 않는다.
  const gone = setup(NOW + 60_000, "claude");
  let answer: (response: Response) => void = () => {};
  const late = new Promise<Response>((resolve) => {
    answer = resolve;
  });
  const pending = gone.refresher(() => late).prepareToken(claude);
  await new Promise((resolve) => setTimeout(resolve, 0));
  gone.disconnect();
  answer(
    Response.json({
      access_token: "LATE-ACCESS",
      refresh_token: "LATE-REFRESH",
      expires_in: 3600,
    }),
  );
  const result = await pending;
  assert.deepStrictEqual([result?.ok, [...gone.secrets.keys()]], [false, []]);
});

test("JSON이 아닌 400은 credential을 revoked로 하지 않고 살아 있는 token을 건넨다", async () => {
  const t = setup(NOW + 60_000);
  const waf = await t
    .refresher(new Response("<html>blocked</html>", { status: 400 }))
    .prepareToken(use);
  assert.deepStrictEqual(waf, ok(undefined));
  assert.deepStrictEqual(t.read().credential.state, "available");
});

test("회전한 refresh token을 저장하지 못하면 다음 갱신이 옛 token이 아니라 그 token을 보낸다", async () => {
  const t = setup(NOW + 60_000);
  const grants: string[] = [];
  // 저장소가 잠깐 막혔다가 풀린다.
  t.store.broken = true;
  const refresher = t.refresher(() => {
    grants.push(
      new URLSearchParams(String(t.sent.at(-1)!.init.body)).get(
        "refresh_token",
      )!,
    );
    return Promise.resolve(
      Response.json({
        access_token: `A${grants.length}`,
        refresh_token: `R${grants.length}`,
        expires_in: 3600,
      }),
    );
  });
  const first = await refresher.prepareToken(use);
  assert.deepStrictEqual(first?.ok, false);
  t.store.broken = false;
  t.expire(NOW + 60_000);
  assert.deepStrictEqual(await refresher.prepareToken(use), ok(undefined));
  assert.deepStrictEqual(grants, ["OLD-REFRESH", "R1"]);
  assert.deepStrictEqual(t.secrets.get(`${ACCESS}.refresh`), "R2");
});

test("force면 만료가 멀어도 갱신한다", async () => {
  const t = setup(NOW + 3_600_000);
  const refresher = t.refresher(
    Response.json({ access_token: "NEW-ACCESS", expires_in: 3600 }),
  );
  assert.deepStrictEqual(await refresher.prepareToken(use), undefined);
  assert.deepStrictEqual(
    await refresher.prepareToken(use, { force: true }),
    ok(undefined),
  );
  assert.deepStrictEqual(t.secrets.get(ACCESS), "NEW-ACCESS");
});
