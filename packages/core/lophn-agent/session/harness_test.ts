import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { RequestContext, Sql, Tx } from "../../../protocol/server/mod.ts";
import { createConversationCommands } from "./commands.ts";
import { createConversationReads } from "./reads.ts";
import { createHarnessCommands, harnessOf } from "./harness.ts";
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

    // 열 때 정한 harness와 탭 여부는 바뀌지 않는다.
    assert.throws(
      () =>
        db.exec(
          "update sessions set harness = 'opencode' where id = 'ses_codex'",
        ),
      /immutable/,
    );
    assert.throws(
      () =>
        db.exec("update sessions set harness_gui = 1 where id = 'ses_codex'"),
      /immutable/,
    );
    // harness 없는 session은 GUI 탭 팀원이 될 수 없다.
    assert.throws(() =>
      db.exec(`insert into sessions (id, agent, harness, harness_gui, lifecycle, created_seq, state_seq)
        values ('ses_bad', 'lophn', null, 1, 'open', 4, 4)`),
    );
    assert.ok(!harnessOf(loadSession({ sql }, "ses_plain")).ok);
  } finally {
    db.close();
  }
});

// 팀원 session 열기와 harness call 실패 처리는 core(machine)만 부른다. 사람이나 agent는 forbidden이다.
test("only core opens or fails a harness session; a person or an agent is forbidden", () => {
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

// core가 harness call을 실패로 닫는 길은 harness session(탭·background 모두)에만 닿고 일반 lophn session은 거절한다.
test("core fails a call back for any harness session and refuses non-harness sessions", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of [...conversationTestSteps]) db.exec(step.sql);
    db.exec(`
      insert into sessions (id, agent, harness, harness_gui, lifecycle, created_seq, state_seq)
        values ('ses_00000000000000000000000000', 'lophn', null, 0, 'open', 1, 1),
               ('ses_00000000000000000000000001', 'coding_claude', 'claude-code', 0, 'open', 2, 2),
               ('ses_00000000000000000000000002', 'coding_claude', 'claude-code', 1, 'open', 3, 3);
    `);
    const sql: Sql = {
      run: (query, params) => db.prepare(query).run(...params),
      get: (query, params) => db.prepare(query).get(...params) as never,
      all: (query, params) => db.prepare(query).all(...params) as never,
    };
    const failed: string[] = [];
    const commands = createConversationCommands({
      failCall: (_tx: Tx, session: string) => {
        failed.push(session);
        return { ok: true, value: true };
      },
    } as never);
    const machine = { actor: "machine" } as unknown as RequestContext;
    const call = "cal_00000000000000000000000001";
    const plain = commands.memberFail.handle(
      { sql } as unknown as Tx,
      machine,
      { session: "ses_00000000000000000000000000", call } as never,
      {},
    );
    assert.ok(!plain.ok && plain.error.code === "forbidden");
    const background = commands.memberFail.handle(
      { sql } as unknown as Tx,
      machine,
      { session: "ses_00000000000000000000000001", call } as never,
      {},
    );
    assert.ok(background.ok);
    const member = commands.memberFail.handle(
      { sql } as unknown as Tx,
      machine,
      { session: "ses_00000000000000000000000002", call } as never,
      {},
    );
    assert.ok(member.ok);
    assert.deepEqual(failed, [
      "ses_00000000000000000000000001",
      "ses_00000000000000000000000002",
    ]);
  } finally {
    db.close();
  }
});

// GUI 탭 팀원은 그 터미널 탭이 화면의 자리다. 사람의 session 목록에 한 번 더 서면 같은 coding agent가 둘로 보인다.
test("a GUI tab member session is not in the person's session list, and a background one of the same agent is", () => {
  const db = new DatabaseSync(":memory:");
  try {
    for (const step of [...conversationTestSteps]) db.exec(step.sql);
    db.exec(`
      insert into sessions (id, agent, harness, harness_gui, lifecycle, created_seq, state_seq)
        values ('ses_00000000000000000000000001', 'coding_claude', 'claude-code', 0, 'open', 1, 1),
               ('ses_00000000000000000000000002', 'coding_claude', 'claude-code', 1, 'open', 2, 2);
      create table turns (session text, started_at text, finished_at text);
    `);
    const sql: Sql = {
      run: (query, params) => db.prepare(query).run(...params),
      get: (query, params) => db.prepare(query).get(...params) as never,
      all: (query, params) => db.prepare(query).all(...params) as never,
    };
    const listed = createConversationReads().sessions.handle(
      { sql, as_of_seq: "2" } as never,
      { actor: "user", principal: "user" } as never,
      { agent: "coding_claude", workspace: null } as never,
    );
    assert.ok(listed.ok);
    assert.deepEqual(
      listed.value.sessions.map((one) => one.id),
      ["ses_00000000000000000000000001"],
    );
  } finally {
    db.close();
  }
});
