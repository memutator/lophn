import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { err, ok } from "../../../base/mod.ts";
import { routePath } from "../../../protocol/base/mod.ts";
import {
  type CatalogEntry,
  providerRead,
  type ProviderRecord,
  type UserModelInfo,
  userModelInfoRead,
} from "../../../protocol/lophn-agent/mod.ts";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import { createModelCommands } from "./commands.ts";
import { createModelReads } from "./reads.ts";
import { createModelResolver } from "./resolve.ts";
import { modelSchemaSteps } from "./schema.ts";
import { GLOBAL_SCOPE, loadChoice, loadUserModels } from "./store.ts";
import { checkEntryOf, userEntryOf } from "./user-entry.ts";
import { createCatalogRead } from "./work.ts";
import type { ReadSnapshot } from "../../../protocol/server/mod.ts";
import { providerSchemaSteps } from "../providers/schema.ts";

const DEFINITION = "my-hive";
const PROVIDER = "pvd_00000000000000000000000000";
const MODEL = "deepseek-v4";
const user = { actor: "user" } as RequestContext;

function open() {
  const db = new DatabaseSync(":memory:");
  for (const step of modelSchemaSteps) db.exec(step.sql);
  const sql = {
    run: (query: string, params: never[]) => {
      const result = db.prepare(query).run(...params);
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    },
    get: (query: string, params: never[]) =>
      db.prepare(query).get(...params) as Record<string, never> | undefined,
    all: (query: string, params: never[]) =>
      db.prepare(query).all(...params) as Record<string, never>[],
  };
  const tx = { sql, now: () => "2026-10-18T00:00:00.000Z" } as unknown as Tx;
  const commands = createModelCommands({
    definitionKey: () => DEFINITION,
    catalogEntry: (definition, name) => checkEntryOf(sql, [], definition, name),
    workspaceExists: () => true,
  });
  return { db, sql, tx, commands };
}

const info = (overrides: Partial<UserModelInfo> = {}): UserModelInfo => ({
  context_limit: null,
  input_limit: null,
  output_limit: null,
  supports_tools: null,
  input_media: ["text", "image"],
  output_media: ["text"],
  effort: { values: ["low", "high", "maximum"], default_value: null },
  price: null,
  ...overrides,
});

const catalogEntry = (context_limit: number): CatalogEntry => ({
  ...userEntryOf({
    provider_definition: DEFINITION,
    model_name: MODEL,
    info: info(),
    saved_at: "2026-10-18T00:00:00.000Z",
  }),
  context_limit,
  options: null,
  source: "models_dev",
});

test("저장한 user 정보는 catalog가 바뀌어도 같은 열쇠의 catalog 항목을 이긴다", () => {
  const { db, sql, tx, commands } = open();
  try {
    const saved = commands.saveUserInfo.handle(
      tx,
      user,
      {
        provider_definition: DEFINITION,
        model_name: MODEL,
        info: info({ context_limit: 1_000_000 }),
      },
      { seq: "0" },
    );
    assert.ok(saved.ok);
    // refresh 앞뒤로 derived catalog의 내용이 달라도 사람이 적은 항목이 남는다.
    for (const catalogContext of [8000, 64000]) {
      const read = createCatalogRead({
        readDerived: () => null,
        snapshot: { entries: [catalogEntry(catalogContext)], hash: "h" },
        userEntries: (s) =>
          loadUserModels(s).items.map((record) => userEntryOf(record)),
      });
      const result = read.handle(
        { sql, as_of_seq: 1 } as unknown as ReadSnapshot,
        user,
        { provider_definition: DEFINITION },
      );
      assert.ok(result.ok);
      assert.deepStrictEqual(result.value.entries.length, 1);
      assert.deepStrictEqual(result.value.entries[0].source, "user");
      assert.deepStrictEqual(result.value.entries[0].context_limit, 1_000_000);
    }
  } finally {
    db.close();
  }
});

test("user 항목의 effort 값은 저장 검사를 통과해 chat 요청의 reasoning_effort가 되고 안 적은 한도는 기본값이다", async () => {
  const { db, sql, tx, commands } = open();
  try {
    const choice = {
      provider: PROVIDER,
      model_name: MODEL,
      option_values: { effort: "maximum" },
    };
    // 정보를 적기 전에는 effort를 고를 수 없다.
    assert.deepStrictEqual(
      commands.changeDefault.handle(tx, user, { default: choice }, {}).ok,
      false,
    );
    const save = (overrides: Partial<UserModelInfo>, seq: string) =>
      commands.saveUserInfo.handle(
        tx,
        user,
        {
          provider_definition: DEFINITION,
          model_name: MODEL,
          info: info(overrides),
        },
        { seq },
      );
    assert.ok(save({}, "0").ok);
    assert.ok(
      commands.changeDefault.handle(tx, user, { default: choice }, {}).ok,
    );

    const provider = {
      id: PROVIDER,
      name: "mine",
      definition: {
        key: DEFINITION,
        display_name: DEFINITION,
        protocols: ["openai-chat-completions"],
        auth_kinds: ["none"],
        models_endpoint: null,
        oauth: null,
        revision: "test",
      },
      endpoint: "http://127.0.0.1:1",
      protocol: "openai-chat-completions",
      credential: {
        kind: "none",
        secret_ref: null,
        revision: 1,
        state: "available",
        unavailable_reason: null,
        until: null,
        expires_at: null,
        logged_in_at: null,
        refreshed_at: null,
        model_blocks: [],
        reported_models: null,
        account: null,
      },
      revision: 1,
    } as unknown as ProviderRecord;
    const resolve = createModelResolver({
      machine: (path) =>
        Promise.resolve(
          path === routePath(providerRead)
            ? ok({ provider, as_of_seq: "0", next_cursor: null })
            : path === routePath(userModelInfoRead)
              ? ok({
                  ...loadUserModels(sql),
                  as_of_seq: "0",
                  next_cursor: null,
                })
              : err({ code: "not_found", message: path }),
        ),
      catalog: () => Promise.resolve(ok([])),
    });
    const bodyOf = async () => {
      const bound = await resolve({ model: choice });
      assert.ok(bound.ok, JSON.stringify(bound));
      const packed = bound.value.pack({
        system: [{ layer: "workspace_kind", text: "x" }],
        tools: [],
        messages: [{ role: "user", parts: [{ kind: "text", text: "hi" }] }],
      });
      return {
        bound: bound.value,
        body: packed.body as Record<string, unknown>,
      };
    };

    const defaults = await bodyOf();
    assert.deepStrictEqual(defaults.body["reasoning_effort"], "max");
    assert.deepStrictEqual(defaults.bound.call.limits.context_limit, 131072);
    assert.deepStrictEqual(defaults.bound.call.limits.input_limit, 131072);
    assert.deepStrictEqual(defaults.bound.call.limits.output_limit, 4096);
    assert.deepStrictEqual(defaults.body["max_tokens"], 4096);
    assert.ok(defaults.bound.inputMedia.includes("image"));

    assert.ok(
      save({ context_limit: 1_000_000, output_limit: 100_000 }, "1").ok,
    );
    const set = await bodyOf();
    assert.deepStrictEqual(set.bound.call.limits.context_limit, 1_000_000);
    assert.deepStrictEqual(set.bound.call.limits.input_limit, 1_000_000);
    assert.deepStrictEqual(set.body["max_tokens"], 100_000);
  } finally {
    db.close();
  }
});

test("seq가 낡은 저장과 지움은 쓰지 않는다", () => {
  const { db, sql, tx, commands } = open();
  try {
    const key = { provider_definition: DEFINITION, model_name: MODEL };
    const stale = commands.saveUserInfo.handle(
      tx,
      user,
      {
        ...key,
        info: info(),
      },
      { seq: "7" },
    );
    assert.ok(!stale.ok);
    assert.deepStrictEqual(stale.error.code, "conflict");
    assert.deepStrictEqual(loadUserModels(sql).items, []);

    const saved = commands.saveUserInfo.handle(
      tx,
      user,
      {
        ...key,
        info: info(),
      },
      { seq: "0" },
    );
    assert.ok(saved.ok);
    assert.deepStrictEqual(saved.value.seq, "1");

    const removed = commands.removeUserInfo.handle(tx, user, key, {
      seq: "0",
    });
    assert.ok(!removed.ok);
    assert.deepStrictEqual(removed.error.code, "conflict");
    assert.deepStrictEqual(loadUserModels(sql).items.length, 1);
  } finally {
    db.close();
  }
});

test("modelDefaultRead는 끊긴 provider를 가리키는 전역 기본을 null로 돌려주고 같은 id가 돌아오면 다시 보인다", () => {
  const { db, sql, tx, commands } = open();
  try {
    for (const step of providerSchemaSteps) db.exec(step.sql);
    const insertProvider = (id: string) =>
      db
        .prepare(
          `insert into providers (id, name, definition_key, definition, endpoint, protocol, revision)
           values (?, ?, ?, '{}', 'https://api.anthropic.com', 'anthropic-messages', 1)`,
        )
        .run(id, "Anthropic", "anthropic");
    const reads = createModelReads({
      workspaceExists: () => true,
      readDerived: () => null,
    });
    const readDefault = () =>
      reads.modelDefault.handle(
        { sql, as_of_seq: 1 } as unknown as ReadSnapshot,
        user,
        {},
      );
    const choice = {
      provider: PROVIDER,
      model_name: MODEL,
      option_values: {},
    };

    insertProvider(PROVIDER);
    assert.ok(
      commands.changeDefault.handle(
        tx,
        user,
        { default: choice },
        undefined as never,
      ).ok,
    );
    const connected = readDefault();
    assert.ok(connected.ok);
    assert.deepStrictEqual(connected.value.default, choice);

    // provider가 Disconnect로 사라지면 DB의 model_choices 줄은 남되 modelDefaultRead는 null을 돌려준다.
    db.prepare("delete from providers where id = ?").run(PROVIDER);
    const disconnected = readDefault();
    assert.ok(disconnected.ok);
    assert.deepStrictEqual(disconnected.value.default, null);
    assert.deepStrictEqual(loadChoice(sql, GLOBAL_SCOPE), choice);

    // 다른 provider가 연결돼도 낡은 전역 기본을 돌려주지 않는다(새 기본 model을 고르게 한다).
    const otherId = "pvd_00000000000000000000000002";
    insertProvider(otherId);
    const other = readDefault();
    assert.ok(other.ok);
    assert.deepStrictEqual(other.value.default, null);

    // 같은 provider id로 다시 연결되면 전역 기본이 그대로 복원된다.
    insertProvider(PROVIDER);
    const reconnected = readDefault();
    assert.ok(reconnected.ok);
    assert.deepStrictEqual(reconnected.value.default, choice);
  } finally {
    db.close();
  }
});
