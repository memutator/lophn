import assert from "node:assert/strict";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import {
  type ProviderRecord,
  refreshProviderModels,
} from "../../../protocol/lophn-agent/mod.ts";
import type { AuthenticatedContext } from "../../../protocol/server/mod.ts";
import type { Writer } from "../../storage/ledger/mod.ts";
import { builtinProviderDefinition } from "./definitions.ts";
import { withProviderModelList } from "./model-list.ts";

const ID = "pvd_00000000000000000000000001";
const WHO = { actor: "user" } as AuthenticatedContext;

function custom(): ProviderRecord {
  return {
    id: ID,
    name: "Local",
    definition: {
      key: "custom",
      display_name: "Custom",
      protocols: ["openai-chat-completions"],
      auth_kinds: ["api_key"],
      models_endpoint: null,
      oauth: null,
      revision: "1",
    },
    endpoint: "http://127.0.0.1:9000/v1/",
    protocol: "openai-chat-completions",
    credential: {
      kind: "api_key",
      secret_ref: { name: `provider.${ID.slice(4)}` },
      revision: 1,
      state: "available",
      unavailable_reason: null,
      until: null,
      expires_at: null,
      logged_in_at: null,
      refreshed_at: null,
      model_blocks: [],
      reported_models: ["old"],
    },
    revision: 1,
  } as ProviderRecord;
}

// 목록 읽기가 실패하면 앞서 저장한 reported_models가 그대로이고, 성공하면 새 목록으로 바뀐다.
// key는 요청 header에만 간다.
test("custom provider 목록 읽기는 실패하면 앞 목록을 남기고 성공하면 바꾼다", async () => {
  let record = custom();
  const sent: { url: string; authorization: string | null }[] = [];
  let answer: () => Response = () =>
    Response.json({ data: [{ id: "b" }, { id: "a" }] });
  const writer = {
    command: (_ctx, envelope) => {
      const input = envelope.input as { models: string[] };
      record = {
        ...record,
        revision: record.revision + 1,
        credential: { ...record.credential, reported_models: input.models },
      };
      return Promise.resolve(ok({
        result: { provider: record },
        replayed: false,
        first_seq: null,
        last_seq: null,
      }));
    },
  } as Writer;
  const listed = withProviderModelList(writer, {
    http: (url, init) => {
      sent.push({
        url,
        authorization: new Headers(init.headers).get("authorization"),
      });
      return Promise.resolve(answer());
    },
    secrets: { get: () => ok("SECRET-KEY") },
    readProvider: () => Promise.resolve(ok(record)),
    newKey: () => crypto.randomUUID(),
  });
  const refresh = () =>
    listed.command(WHO, {
      command: refreshProviderModels.name,
      input: { provider: ID },
      idempotency_key: "k",
      compare: {},
      prepared: [],
    });

  const failures: [string, () => Response][] = [
    ["200이 아님", () => new Response("{}", { status: 500 })],
    ["파싱 실패", () => new Response("<html>")],
    ["던짐", () => {
      throw new Error("deadline");
    }],
  ];
  for (const [name, fail] of failures) {
    answer = fail;
    const done = await refresh();
    assert.ok(!done.ok && done.error.code === "unavailable", name);
    assert.deepStrictEqual(record.credential.reported_models, ["old"], name);
  }

  answer = () => Response.json({ data: [{ id: "b" }, { id: "a" }] });
  const done = await refresh();
  assert.ok(done.ok);
  assert.deepStrictEqual(record.credential.reported_models, ["a", "b"]);
  assert.deepStrictEqual(sent.at(-1), {
    url: "http://127.0.0.1:9000/v1/models",
    authorization: "Bearer SECRET-KEY",
  });

  // 내장 provider는 읽지 않는다.
  const builtin = builtinProviderDefinition("anthropic");
  assert.ok(builtin.ok);
  record = { ...custom(), definition: builtin.value } as ProviderRecord;
  const refused = await refresh();
  assert.ok(!refused.ok && refused.error.code === "invalid_input");
});
