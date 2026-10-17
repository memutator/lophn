import { assert, assertEquals } from "@std/assert";
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
  assert(definition.ok);
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
  assert(connected.ok);
  const secrets = new Map([
    [ACCESS, "OLD-ACCESS"],
    [`${ACCESS}.refresh`, "OLD-REFRESH"],
    [`${ACCESS}.meta`, JSON.stringify({ client_id: "oaiapp_x", subject: "u" })],
  ]);
  const read = () => {
    const found = loadProvider(sql, ID);
    assert(found.ok && found.value !== null);
    return found.value;
  };
  const refresher = (answer: Response) =>
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
      http: () => Promise.resolve(answer),
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
  return { secrets, read, refresher };
}

const use = {
  name: ACCESS,
  destination: { kind: "https" as const, origin: "https://api.openai.com" },
};

Deno.test("갱신은 회전한 refresh token을 저장하고, invalid_grant면 credential을 revoked로 하고 token을 내주지 않는다", async () => {
  // 만료 1분 전: 회전한 refresh와 새 access를 저장하고 만료를 올린다.
  const rotated = setup(NOW + 60_000);
  const fresh = await rotated.refresher(Response.json({
    access_token: "NEW-ACCESS",
    refresh_token: "NEW-REFRESH",
    expires_in: 3600,
  })).prepareToken(use);
  assertEquals(fresh, ok(undefined));
  assertEquals(
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
  assertEquals(refused?.ok === false && refused.error.code, "forbidden");
  const credential = dead.read().credential;
  assertEquals(
    [credential.state, credential.unavailable_reason],
    ["revoked", "refresh_revoked"],
  );

  // 만료가 lead보다 멀면 갱신하지 않는다.
  const later = setup(NOW + 3_600_000);
  const untouched = await later.refresher(Response.json({
    access_token: "NEW-ACCESS",
    refresh_token: "NEW-REFRESH",
  })).prepareToken(use);
  assertEquals(
    [untouched, later.secrets.get(`${ACCESS}.refresh`), later.read().revision],
    [undefined, "OLD-REFRESH", 1],
  );
});
