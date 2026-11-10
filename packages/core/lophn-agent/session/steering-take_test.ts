import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import { takeSteering } from "./model.ts";
import { conversationTestSteps } from "./test-steps.ts";

// [Send now]로 올린 메시지는 접수 때 next_turn이라 checkpoint가 있다. model 요청에 실리는 순간 turn이 정해지고
// rewind 시점에서 빠져야 한다. 이미 turn이 정해진 메시지는 건드리지 않는다.
test("model 요청이 가져간 steer는 turn이 정해지고 checkpoint를 잃는다", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of [...conversationTestSteps]) db.exec(step.sql);
    db.exec(`
      create table model_calls (id text primary key, turn text);
      create table checkpoints (message text primary key);
      insert into model_calls values ('mcl_1', 'trn_1');
      insert into sessions (id, agent, lifecycle, created_seq, state_seq)
        values ('ses_x', 'lophn', 'open', 1, 1);
    `);
    const insert = db.prepare(
      `insert into messages (id, session, from_kind, delivery, turn, body,
         created_seq, created_at, state_seq)
       values (?, 'ses_x', 'human', ?, ?, ?, ?, '2026-10-31T00:00:00.000Z', ?)`,
    );
    insert.run("msg_queued", "next_turn", null, "0".repeat(64), 2, 2);
    insert.run("msg_direct", "steer", null, "1".repeat(64), 3, 3);
    insert.run("msg_old", "next_turn", "trn_0", "2".repeat(64), 4, 4);
    db.exec("insert into checkpoints values ('msg_queued'), ('msg_old')");
    const sql: Sql = {
      run: (query, params) => db.prepare(query).run(...params),
      get: (query, params) => db.prepare(query).get(...params) as never,
      all: (query, params) => db.prepare(query).all(...params) as never,
    };
    const taken = takeSteering({ sql } as unknown as Tx, {
      messages: ["msg_queued", "msg_direct", "msg_old"],
      call: "mcl_1",
    });
    assert.ok(taken.ok);
    const turns = db
      .prepare("select id, turn from messages order by created_seq")
      .all();
    assert.deepEqual(
      turns.map((row) => [row["id"], row["turn"]]),
      [
        ["msg_queued", "trn_1"],
        ["msg_direct", "trn_1"],
        ["msg_old", "trn_0"],
      ],
    );
    const left = db.prepare("select message from checkpoints").all();
    assert.deepEqual(
      left.map((row) => row["message"]),
      ["msg_old"],
    );
  } finally {
    db.close();
  }
});
