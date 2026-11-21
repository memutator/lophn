import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { RequestContext, Sql, Tx } from "../../../protocol/server/mod.ts";
import { createProviderCommands } from "./commands.ts";
import { builtinProviderDefinition } from "./definitions.ts";
import {
  providerMultiCredentialsSchemaSteps,
  providerReportedModelLimitsSchemaSteps,
  providerSchemaSteps,
} from "./schema.ts";
import { loadProvider } from "./store.ts";

const ID = "pvd_00000000000000000000000001";
const CRD_1 = "crd_00000000000000000000000001";
const CRD_2 = "crd_00000000000000000000000002";
const CRD_3 = "crd_00000000000000000000000003";
const user = { actor: "user" } as RequestContext;

function fakeTx(): { tx: Tx; inserts: unknown[][] } {
  const inserts: unknown[][] = [];
  const tx = {
    now: () => "2026-01-01T00:00:00.000Z",
    sql: {
      get: () => undefined,
      run: (_query: string, params: unknown[]) => inserts.push(params),
    },
  } as unknown as Tx;
  return { tx, inserts };
}

function connect(secret: string) {
  const definition = builtinProviderDefinition("anthropic");
  assert.ok(definition.ok);
  const { tx, inserts } = fakeTx();
  const result = createProviderCommands().connect.handle(
    tx,
    user,
    {
      id: ID,
      name: "Anthropic",
      definition: definition.value,
      endpoint: "https://api.anthropic.com",
      protocol: "anthropic-messages",
      auth_kind: "api_key",
      credential: { secret },
    } as never,
    undefined as never,
  );
  return { result, inserts };
}

test("Connect는 provider.<crd_id>가 아닌 secret 이름을 거절하고 row를 남기지 않는다", () => {
  for (const name of [
    "app.other.token",
    "provider.crd_00000000000000000000000002",
  ]) {
    const { result, inserts } = connect(name);
    assert.ok(!result.ok);
    assert.deepStrictEqual(result.error.code, "invalid_input");
    assert.deepStrictEqual(inserts, []);
  }
  const { result, inserts } = connect(`provider.${CRD_1}`);
  assert.ok(result.ok);
  assert.deepStrictEqual(result.value.provider.credential.secret_ref, {
    name: `provider.${CRD_1}`,
  });
  assert.deepStrictEqual(inserts.length, 2);
});

test("다중 credential 추가·활성 전환(endpoint 변경)·OAuth 계정 upsert·제거 승계와 마지막 1개 보호", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of [
    ...providerSchemaSteps,
    ...providerReportedModelLimitsSchemaSteps,
    ...providerMultiCredentialsSchemaSteps,
  ]) {
    db.exec(step.sql);
  }
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  let tick = 0;
  const tx = {
    now: () => `2026-11-21T00:00:0${++tick}.000Z`,
    sql,
  } as unknown as Tx;
  const commands = createProviderCommands();
  const openai = builtinProviderDefinition("openai");
  assert.ok(openai.ok);

  // 1) API key로 OpenAI 연결
  const c1 = commands.connect.handle(
    tx,
    user,
    {
      id: ID,
      name: "OpenAI",
      definition: openai.value,
      endpoint: "https://api.openai.com/v1",
      protocol: "openai-responses",
      auth_kind: "api_key",
      credential: { secret: `provider.${CRD_1}` },
      key_hint: "sk-…1111",
    } as never,
    undefined as never,
  );
  assert.ok(c1.ok);
  assert.equal(c1.value.provider.credential.key_hint, "sk-…1111");
  assert.equal(c1.value.provider.credentials.length, 1);

  // 마지막 남은 credential 제거는 conflict로 거절
  const remLast = commands.removeCredential.handle(
    tx,
    user,
    { provider: ID, credential: CRD_1 } as never,
    { revision: c1.value.provider.revision },
  );
  assert.ok(!remLast.ok && remLast.error.code === "conflict");

  // 2) ChatGPT OAuth 계정 추가 → active 전환 + endpoint가 Codex backend로 변경
  const added = commands.addCredential.handle(
    tx,
    user,
    {
      provider: ID,
      credential_id: CRD_2,
      auth_kind: "oauth",
      credential: { secret: `provider.${CRD_2}` },
      expires_at: "2026-11-21T01:00:00.000Z",
      account: {
        id: "acct-a",
        email: "a@example.com",
        organization_id: null,
        organization_name: "Team A",
        project_id: null,
      },
      activate: true,
    } as never,
    { revision: c1.value.provider.revision },
  );
  assert.ok(added.ok);
  assert.equal(added.value.credential_id, CRD_2);
  assert.equal(added.value.provider.credential.id, CRD_2);
  assert.equal(
    added.value.provider.endpoint,
    "https://chatgpt.com/backend-api/codex",
  );
  assert.equal(added.value.provider.credentials.length, 2);

  // 3) 같은 OAuth 계정(acct-a)으로 다시 로그인하면 새 row 대신 기존 CRD_2를 갱신(upsert)
  const upserted = commands.addCredential.handle(
    tx,
    user,
    {
      provider: ID,
      credential_id: CRD_3,
      auth_kind: "oauth",
      credential: { secret: `provider.${CRD_3}` },
      expires_at: "2026-11-21T02:00:00.000Z",
      account: {
        id: "acct-a",
        email: "a@example.com",
        organization_id: null,
        organization_name: "Team A Updated",
        project_id: null,
      },
      activate: true,
    } as never,
    { revision: added.value.provider.revision },
  );
  assert.ok(upserted.ok);
  assert.equal(upserted.value.credential_id, CRD_2);
  assert.equal(upserted.value.provider.credentials.length, 2);
  assert.equal(
    upserted.value.provider.credential.account?.organization_name,
    "Team A Updated",
  );

  // 4) API key(CRD_1)로 수동 전환 → endpoint가 api.openai.com/v1로 복귀
  const switched = commands.activateCredential.handle(
    tx,
    user,
    { provider: ID, credential: CRD_1 } as never,
    { revision: upserted.value.provider.revision },
  );
  assert.ok(switched.ok);
  assert.equal(switched.value.provider.credential.id, CRD_1);
  assert.equal(switched.value.provider.endpoint, "https://api.openai.com/v1");

  // 5) 활성(CRD_1) 제거 → 남은 CRD_2로 자동 승계 + endpoint Codex로 전환
  const removed = commands.removeCredential.handle(
    tx,
    user,
    { provider: ID, credential: CRD_1 } as never,
    { revision: switched.value.provider.revision },
  );
  assert.ok(removed.ok);
  assert.equal(removed.value.provider.credential.id, CRD_2);
  assert.equal(
    removed.value.provider.endpoint,
    "https://chatgpt.com/backend-api/codex",
  );
  const reloaded = loadProvider(sql, ID);
  assert.ok(reloaded.ok && reloaded.value !== null);
  assert.equal(reloaded.value.credentials.length, 1);
});
