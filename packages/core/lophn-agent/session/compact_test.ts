import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { RequestContext, Sql, Tx } from "../../../protocol/server/mod.ts";
import { turnSchemaSteps } from "../run-loop/schema.ts";
import { usageSchemaSteps } from "../usage/model.ts";
import { createCompactCommands } from "./compact.ts";
import { conversationSchemaSteps } from "./model.ts";

// 도는 turn이 있는 session은 그 turn 자신(machine)만 Compact를 열고 확정한다. 다른 turn이나 turn 없는 요청, 사람이
// turn을 흉내 낸 요청이 열면 사람의 대화가 turn 도중에 요약으로 바뀐다.
const HASH = "a".repeat(64);

function setup() {
  const db = new DatabaseSync(":memory:");
  for (const step of [
    ...conversationSchemaSteps,
    ...turnSchemaSteps,
    ...usageSchemaSteps,
  ]) {
    db.exec(step.sql);
  }
  db.exec(`
    create table events (seq integer primary key);
    insert into sessions (id, agent, lifecycle, created_seq, state_seq)
      values ('ses_h', 'agt_x', 'open', 1, 1);
    insert into messages (id, session, from_kind, delivery, body, created_seq, created_at, state_seq)
      values ('msg_1', 'ses_h', 'human', 'next_turn', '${HASH}', 2, '2026-11-04T00:00:00.000Z', 2);
    insert into turns (id, session, input_message, state, basis, started_at, limits, mode, state_seq)
      values ('trn_1', 'ses_h', 'msg_1', 'running', '${HASH}', '2026-11-04T00:00:00.000Z', '{}', 'attended', 1);
    insert into model_calls (id, session, model_use, purpose, attempt_kind, attempt_order, provider,
        model_name, protocol, call_model, input, context_basis, output, state, state_seq, started_seq,
        started_at, finished_at, outcome, usage, cost)
      values ('mcl_1', 'ses_h', 'organizing', 'conversation_compression', 'initial', 1, 'p',
        'm', 'anthropic-messages', '{}', 'i', 'b', 'o', 'finished', 2, 1,
        '2026-11-04T00:00:00.000Z', '2026-11-04T00:00:01.000Z', '{"kind":"complete"}', '{}', '{}');
  `);
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  const published: unknown[] = [];
  const tx = {
    sql,
    now: () => "2026-11-04T00:00:00.000Z",
    port: () => ({
      push: (_topic: string, event: unknown) => published.push(event),
    }),
  } as unknown as Tx;
  const commands = createCompactCommands();
  const as = (actor: string) => ({ actor }) as unknown as RequestContext;
  const stateSeq = () =>
    String(
      (
        db
          .prepare("select state_seq from sessions where id = 'ses_h'")
          .get() as {
          state_seq: number;
        }
      ).state_seq,
    );
  const request = (actor: string, turn?: string) =>
    commands.requestCompact.handle(
      tx,
      as(actor),
      { session: "ses_h", ...(turn === undefined ? {} : { turn }) } as never,
      { state: "open", state_seq: stateSeq() } as never,
    );
  const confirm = (actor: string, requestSeq: string, turn?: string) =>
    commands.compact.handle(
      tx,
      as(actor),
      {
        session: "ses_h",
        summary_call: "mcl_1",
        through_seq: "2",
        ...(turn === undefined ? {} : { turn }),
      } as never,
      { state: "open", request_seq: requestSeq } as never,
    );
  return { db, published, request, confirm };
}

test("only the running turn compacts its own session while it runs", () => {
  const { db, published, request, confirm } = setup();
  try {
    const refused = [
      request("machine"),
      request("machine", "trn_other"),
      request("user", "trn_1"),
    ];
    assert.deepEqual(
      refused.map((result) => !result.ok && result.error.code),
      ["conflict", "conflict", "conflict"],
    );

    const opened = request("machine", "trn_1");
    assert.ok(opened.ok);
    const seq = opened.value.request_seq;
    assert.deepEqual(published, [
      {
        session: "ses_h",
        type: "CompactStarted",
        at: "2026-11-04T00:00:00.000Z",
        payload: { turn: "trn_1" },
      },
    ]);

    const wrong = [
      confirm("machine", seq),
      confirm("machine", seq, "trn_other"),
    ];
    assert.deepEqual(
      wrong.map((result) => !result.ok && result.error.code),
      ["conflict", "conflict"],
    );
    const confirmed = confirm("machine", seq, "trn_1");
    assert.ok(confirmed.ok);
    const row = db
      .prepare(
        "select compaction_through_seq as through, compaction_summary_call as call from sessions where id = 'ses_h'",
      )
      .get();
    assert.deepEqual({ ...row }, { through: 2, call: "mcl_1" });
  } finally {
    db.close();
  }
});
