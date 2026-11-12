import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../../base/mod.ts";
import type { AgentEvent } from "../../../protocol/events/mod.ts";
import type { RequestContext, Sql, Tx } from "../../../protocol/server/mod.ts";
import { createTurnCommands } from "./commands.ts";
import { interruptRunningTurns } from "./interrupt.ts";
import { turnSchemaSteps } from "./schema.ts";
import { conversationTestSteps } from "../session/test-steps.ts";
import { toolsSchemaSteps } from "../tools/model.ts";

// harness turn은 basis·result blob 없이 시작하고 끝난다. 그 모양으로도 TurnEnded가 turn마다 한 번이고,
// 재시작이 끝나지 않은 turn을 interrupted(restarted)로 닫은 뒤에는 host의 끝냄이 결과를 덮지 못해야 한다.
const LIMITS = { model_attempts: null, stall_ms: 300_000 };
const HASH = "a".repeat(64);

function setup() {
  const db = new DatabaseSync(":memory:");
  for (const step of [
    ...conversationTestSteps,
    ...turnSchemaSteps,
    ...toolsSchemaSteps,
  ]) {
    db.exec(step.sql);
  }
  db.exec(`
    create table events (seq integer primary key);
    create table blob_refs (owner_kind text, owner_key text, field text, hash text);
    create table erase_windows (table_name text primary key);
    insert into sessions (id, agent, harness, lifecycle, created_seq, state_seq)
      values ('ses_h', 'agt_x', 'codex', 'open', 1, 1);
  `);
  const insert = db.prepare(
    `insert into messages (id, session, from_kind, delivery, body, created_seq, created_at, state_seq)
     values (?, 'ses_h', 'human', 'next_turn', ?, ?, '2026-11-04T00:00:00.000Z', ?)`,
  );
  insert.run("msg_1", HASH, 2, 2);
  insert.run("msg_2", HASH, 3, 3);
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  // 준비한 blob의 등록은 참조 행 하나로 줄여 센다.
  const tx = {
    sql,
    now: () => "2026-11-04T00:00:00.000Z",
    registerBlobRef: (ref: {
      owner_kind: string;
      owner_key: string;
      field: string;
      source: { blob: { hash: string } };
    }) => {
      db.prepare("insert into blob_refs values (?, ?, ?, ?)").run(
        ref.owner_kind,
        ref.owner_key,
        ref.field,
        ref.source.blob.hash,
      );
      return ok(undefined);
    },
  } as unknown as Tx;
  const ended: AgentEvent[] = [];
  const publish = (_tx: Tx, event: AgentEvent) => {
    if (event.type === "TurnEnded") ended.push(event);
  };
  const commands = createTurnCommands({
    turnLimits: () => ok(LIMITS),
    publish,
  });
  const machine = { actor: "machine" } as unknown as RequestContext;
  const start = (id: string, message: string) =>
    commands.start.handle(
      tx,
      machine,
      {
        id,
        session: "ses_h",
        input_message: message,
        basis: HASH,
        limits: LIMITS,
        mode: "attended",
      } as never,
      {},
    );
  const finish = (id: string, seq: string) =>
    commands.finish.handle(
      tx,
      machine,
      {
        turn: id,
        outcome: { kind: "completed", reason: "answer_completed" },
        result: HASH,
      } as never,
      { state_seq: seq },
    );
  const stop = (id: string, seq: string) =>
    commands.stop.handle(
      tx,
      { actor: "user" } as unknown as RequestContext,
      { turn: id, request_key: "k", reason: "user_stopped" } as never,
      { state_seq: seq },
    );
  const checkpoint = (id: string, seq: string, history: string) =>
    commands.checkpoint.handle(
      tx,
      machine,
      {
        turn: id,
        elapsed: { active_ms: 0, stall_ms: 0, checkpoint_at: null },
        history,
        history_size: 10,
      } as never,
      { state_seq: seq },
    );
  return { db, tx, ended, publish, start, finish, stop, checkpoint };
}

test("a harness turn ends once and a restart ends an unfinished one as interrupted", () => {
  const { db, tx, ended, publish, start, finish } = setup();
  try {
    const first = start("trn_1", "msg_1");
    assert.ok(first.ok);
    const done = finish("trn_1", first.value.state_seq);
    assert.ok(done.ok);
    const again = finish("trn_1", first.value.state_seq);
    assert.ok(!again.ok && again.error.code === "conflict");
    assert.equal(ended.length, 1);

    const second = start("trn_2", "msg_2");
    assert.ok(second.ok);
    const closed = interruptRunningTurns(tx, publish, "restarted");
    assert.ok(closed.ok && closed.value === 1);
    const late = finish("trn_2", second.value.state_seq);
    assert.ok(!late.ok && late.error.code === "conflict");
    assert.equal(ended.length, 2);
    const row = db
      .prepare(
        "select outcome_kind, outcome_reason from turns where id = 'trn_2'",
      )
      .get();
    assert.deepEqual(
      { ...row },
      { outcome_kind: "interrupted", outcome_reason: "restarted" },
    );
  } finally {
    db.close();
  }
});

test("a restart closes the open tool calls of the turn it interrupts as uncertain", () => {
  const { db, tx, publish, start } = setup();
  try {
    assert.ok(start("trn_1", "msg_1").ok);
    const insert = db.prepare(
      `insert into tool_calls (id, turn, model_call, response_key, response_order, tool, definition_revision,
         effect, confirm, input, attempt, state, state_seq, started_at)
       values (?, 'trn_1', 'mcl_1', ?, 0, 'file.write', 'r1', 'write', 0, ?, 0, ?, 1, ?)`,
    );
    insert.run("tcl_req", "a", HASH, "requested", null);
    insert.run("tcl_run", "b", HASH, "started", "2026-11-04T00:00:00.000Z");
    const closed = interruptRunningTurns(tx, publish, "restarted");
    assert.ok(closed.ok);
    const calls = db
      .prepare(
        "select id, state, outcome, finished_at from tool_calls order by id",
      )
      .all();
    const turn = db
      .prepare("select finished_at, result_facts from turns where id = 'trn_1'")
      .get() as { finished_at: string; result_facts: string };
    for (const call of calls) {
      assert.equal(call.state, "finished");
      assert.equal(call.outcome, '{"kind":"uncertain","code":"uncertain"}');
      assert.equal(call.finished_at, turn.finished_at);
    }
    assert.deepEqual(JSON.parse(turn.result_facts).unknown_effects, [
      "tcl_req",
      "tcl_run",
    ]);
  } finally {
    db.close();
  }
});

test("a stopped turn takes a history-only checkpoint until the next turn of the session starts", () => {
  const { db, start, finish, stop, checkpoint } = setup();
  try {
    const first = start("trn_1", "msg_1");
    assert.ok(first.ok);
    const stopped = stop("trn_1", first.value.state_seq);
    assert.ok(stopped.ok);
    const kept = checkpoint("trn_1", stopped.value.state_seq, "b".repeat(64));
    assert.ok(kept.ok && kept.value.state === "finished");
    const refs = () =>
      db
        .prepare("select hash from blob_refs where owner_key = 'trn_1'")
        .all()
        .map((row) => row.hash);
    assert.deepEqual(refs(), ["b".repeat(64)]);

    const second = start("trn_2", "msg_2");
    assert.ok(second.ok);
    // 다음 turn이 시작했으니 앞 turn의 이력은 바뀌지 않는다.
    const late = checkpoint("trn_1", stopped.value.state_seq, "c".repeat(64));
    assert.ok(!late.ok && late.error.code === "conflict");
    assert.deepEqual(refs(), ["b".repeat(64)]);
    const done = finish("trn_2", second.value.state_seq);
    assert.ok(done.ok);
    // 사람이 멈추지 않고 끝난 turn은 이력을 받지 않는다.
    const after = checkpoint("trn_2", done.value.state_seq, "d".repeat(64));
    assert.ok(!after.ok && after.error.code === "conflict");
  } finally {
    db.close();
  }
});
