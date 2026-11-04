import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { RequestContext, Sql, Tx } from "../../../protocol/server/mod.ts";
import { createHarnessCommands, harnessOf } from "./harness.ts";
import { conversationSchemaSteps, loadSession } from "./model.ts";

// host route는 runtime이 harness인 session만 고친다. 아니면 session 행이 그대로여야 한다.
test("harness host binding cannot change a session whose runtime is not a harness", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of conversationSchemaSteps) db.exec(step.sql);
    db.exec(`
      insert into sessions (id, agent, harness, lifecycle, created_seq, state_seq)
        values ('ses_plain', 'lophn', null, 'open', 1, 1),
               ('ses_codex', 'agt_x', 'codex', 'open', 2, 2);
    `);
    const sql: Sql = {
      run: (query, params) => db.prepare(query).run(...params),
      get: (query, params) => db.prepare(query).get(...params) as never,
      all: (query, params) => db.prepare(query).all(...params) as never,
    };
    const tx = { sql } as unknown as Tx;
    const machine = { actor: "machine" } as unknown as RequestContext;
    const { bind } = createHarnessCommands();
    const call = (session: string, ctx: RequestContext = machine) =>
      bind.handle(
        tx,
        ctx,
        { session, external_session_id: "ext-1" } as never,
        {},
      );

    const plain = call("ses_plain");
    assert.ok(!plain.ok && plain.error.code === "forbidden");
    assert.equal(loadSession({ sql }, "ses_plain")?.harness_session, null);

    const user = call("ses_codex", { actor: "user" } as RequestContext);
    assert.ok(!user.ok && user.error.code === "forbidden");

    assert.ok(call("ses_codex").ok);
    assert.equal(loadSession({ sql }, "ses_codex")?.harness_session, "ext-1");

    // 열 때 정한 harness는 바뀌지 않는다.
    assert.throws(
      () =>
        db.exec(
          "update sessions set harness = 'opencode' where id = 'ses_codex'",
        ),
      /immutable/,
    );
    assert.ok(!harnessOf(loadSession({ sql }, "ses_plain")).ok);
  } finally {
    db.close();
  }
});
