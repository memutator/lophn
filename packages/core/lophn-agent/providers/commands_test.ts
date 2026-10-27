import assert from "node:assert/strict";
import { test } from "node:test";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import { createProviderCommands } from "./commands.ts";
import { builtinProviderDefinition } from "./definitions.ts";

const ID = "pvd_00000000000000000000000001";
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

test("Connect는 provider.<id>가 아닌 secret 이름을 거절하고 row를 남기지 않는다", () => {
  for (const name of [
    "app.other.token",
    "provider.00000000000000000000000002",
  ]) {
    const { result, inserts } = connect(name);
    assert.ok(!result.ok);
    assert.deepStrictEqual(result.error.code, "invalid_input");
    assert.deepStrictEqual(inserts, []);
  }
  const { result, inserts } = connect("provider.00000000000000000000000001");
  assert.ok(result.ok);
  assert.deepStrictEqual(result.value.provider.credential.secret_ref, {
    name: "provider.00000000000000000000000001",
  });
  assert.deepStrictEqual(inserts.length, 2);
});
