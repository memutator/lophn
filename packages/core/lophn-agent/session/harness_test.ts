import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { RequestContext, Sql, Tx } from "../../../protocol/server/mod.ts";
import { createConversationCommands } from "./commands.ts";
import { createHarnessCommands, harnessOf, harnessTaker } from "./harness.ts";
import { loadSession } from "./model.ts";
import { conversationTestSteps } from "./test-steps.ts";

// host route는 runtime이 harness인 session만 고친다. 아니면 session 행이 그대로여야 한다.
test("harness host binding cannot change a session whose runtime is not a harness", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of [...conversationTestSteps]) db.exec(step.sql);
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

// GUI 탭의 팀원 session은 그 탭만 queue를 가져가고 headless host는 가져가지 않는다. 깨지면 한 CLI session에 GUI의 CLI와 `claude -p`가
// 같이 써서 대화 기록이 섞인다. 표시는 열 때 정해 바뀌지 않는다.
test("only the GUI tab takes a member session's queue and the mark never changes", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of [...conversationTestSteps]) db.exec(step.sql);
    db.exec(`
      insert into sessions (id, agent, harness, harness_gui, lifecycle, created_seq, state_seq)
        values ('ses_plain', 'lophn', null, 0, 'open', 1, 1),
               ('ses_headless', 'coding_claude', 'claude-code', 0, 'open', 2, 2),
               ('ses_member', 'coding_omp', 'omp', 1, 'open', 3, 3);
    `);
    const sql: Sql = {
      run: (query, params) => db.prepare(query).run(...params),
      get: (query, params) => db.prepare(query).get(...params) as never,
      all: (query, params) => db.prepare(query).all(...params) as never,
    };
    const taker = (id: string) => harnessTaker(loadSession({ sql }, id)!);
    assert.equal(taker("ses_plain"), null);
    assert.equal(taker("ses_headless"), "headless");
    assert.equal(taker("ses_member"), "gui");
    for (const flip of [
      "update sessions set harness_gui = 0 where id = 'ses_member'",
      "update sessions set harness_gui = 1 where id = 'ses_headless'",
    ]) {
      assert.throws(() => db.exec(flip), /immutable/);
    }
    // harness 없는 session은 팀원이 될 수 없다.
    assert.throws(() =>
      db.exec(`insert into sessions (id, agent, harness, harness_gui, lifecycle, created_seq, state_seq)
        values ('ses_bad', 'lophn', null, 1, 'open', 4, 4)`),
    );
  } finally {
    db.close();
  }
});

// 팀원 session은 core 안 GUI 연결만 연다. 사람이나 agent가 열면 headless 설정을 건너뛴 harness session을 마음대로 만든다.
test("only core opens or fails a GUI member session; a person or an agent is forbidden", () => {
  const commands = createConversationCommands({} as never);
  const input = {
    id: "ses_00000000000000000000000001",
    harness: "omp",
    project: "prj_00000000000000000000000001",
    external_session_id: null,
  } as never;
  const fail = {
    session: "ses_00000000000000000000000001",
    call: "cal_00000000000000000000000001",
  } as never;
  for (const actor of ["user", "agent"]) {
    const ctx = { actor } as unknown as RequestContext;
    const opened = commands.memberOpen.handle({} as Tx, ctx, input, {});
    assert.ok(!opened.ok && opened.error.code === "forbidden", actor);
    const failed = commands.memberFail.handle({} as Tx, ctx, fail, {});
    assert.ok(!failed.ok && failed.error.code === "forbidden", actor);
  }
});
