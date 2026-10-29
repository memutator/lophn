import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { RequestContext, Sql, Tx } from "../../../protocol/server/mod.ts";
import { modelSchemaSteps } from "../models/schema.ts";
import { GLOBAL_SCOPE, loadChoice, loadShown } from "../models/store.ts";
import { createConversationCommands } from "./commands.ts";
import { conversationSchemaSteps } from "./model.ts";

const PROVIDER = "pvd_00000000000000000000000000";
const user = { actor: "user" } as RequestContext;

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec("create table providers (id text primary key, definition_key text)");
  for (const step of [...conversationSchemaSteps, ...modelSchemaSteps]) {
    db.exec(step.sql);
  }
  db.prepare("insert into providers (id, definition_key) values (?, ?)").run(
    PROVIDER,
    "openai",
  );
  db.exec(
    `insert into sessions (id, agent, lifecycle, created_seq, state_seq)
     values ('ses_1', 'lophn', 'open', 1, 1)`,
  );
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  const commands = createConversationCommands({
    catalog: () => [],
  } as never);
  return { sql, tx: { sql } as unknown as Tx, commands };
}

const choice = (model_name: string) => ({
  provider: PROVIDER,
  model_name,
  option_values: {},
});

// 처음 고른 model이 기본이 되지 않으면 다음 대화가 model 없이 실패하고, 켜지지 않으면 고른 model이 picker에서 사라진다.
test("전역 기본이 없을 때 session에서 처음 고른 model은 기본이 되고 켠 목록에 들어간다. 기본이 있으면 그대로 둔다", () => {
  const { sql, tx, commands } = setup();
  const change = (model: string, seq: string) =>
    commands.changeModel.handle(
      tx,
      user,
      { session: "ses_1", model: choice(model) },
      { state: "open", state_seq: seq },
    );

  const first = change("gpt-a", "1");
  assert.ok(first.ok);
  assert.deepStrictEqual(loadChoice(sql, GLOBAL_SCOPE), choice("gpt-a"));
  assert.deepStrictEqual(
    loadShown(sql).items.map((item) => item.model_name),
    ["gpt-a"],
  );

  const second = change("gpt-b", first.value.state_seq);
  assert.ok(second.ok);
  assert.deepStrictEqual(loadChoice(sql, GLOBAL_SCOPE), choice("gpt-a"));
  assert.deepStrictEqual(
    loadShown(sql).items.map((item) => item.model_name),
    ["gpt-a", "gpt-b"],
  );
});
