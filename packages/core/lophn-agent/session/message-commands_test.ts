import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { Sql } from "../../../protocol/server/mod.ts";
import { conversationSchemaSteps } from "./model.ts";
import { revertSchemaSteps } from "./rewind/mod.ts";
import { unstartedHumanMessages } from "./message-commands.ts";

function setup() {
  const db = new DatabaseSync(":memory:");
  for (const step of [...conversationSchemaSteps, ...revertSchemaSteps]) {
    db.exec(step.sql);
  }
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  const hash = "0".repeat(64);
  let seq = 0;
  const session = (id: string, forked: boolean, lifecycle = "open") =>
    sql.run(
      `insert into sessions (id, agent, lifecycle, forked_from_session,
         forked_from_through_seq, created_seq, state_seq)
       values (?, 'lophn', ?, ?, ?, 1, 1)`,
      [id, lifecycle, forked ? "ses_origin" : null, forked ? 1 : null],
    );
  const message = (
    id: string,
    sessionId: string,
    turn: string | null,
    from = "human",
    unattended = 0,
  ) => {
    seq += 1;
    sql.run(
      `insert into messages (id, session, from_kind, from_ref, turn, unattended,
         body, created_seq, created_at, state_seq)
       values (?, ?, ?, ?, ?, ?, ?, ?, '2026-10-17T00:00:00.000Z', ?)`,
      [
        id,
        sessionId,
        from,
        from === "human" ? null : "ses_x",
        turn,
        unattended,
        hash,
        seq,
        seq,
      ],
    );
  };
  return { sql, session, message };
}

// 재시작 때 queue에 되돌릴 사람 메시지를 가른다. 틀리면 Fork한 session마다 재시작할 때 옛 이력이 새 turn(model 호출)이 된다.
test("재시작 때 되돌리는 사람 메시지는 turn이 가져가지 않은 것만이고 Fork 복사본은 뺀다", () => {
  const { sql, session, message } = setup();
  session("ses_plain", false);
  message("m_taken", "ses_plain", "trn_1");
  message("m_queued", "ses_plain", null);
  message("m_call", "ses_plain", null, "agent");
  session("ses_archived", false, "archived");
  message("m_archived", "ses_archived", null);
  session("ses_fork", true);
  message("m_copy", "ses_fork", null);
  message("m_own_taken", "ses_fork", "trn_2");
  message("m_own_queued", "ses_fork", null);
  session("ses_fork_idle", true);
  message("m_copy_only", "ses_fork_idle", null);

  assert.deepStrictEqual(
    unstartedHumanMessages(sql).map((item) => item.id),
    ["m_queued", "m_own_queued"],
  );
});

// 실패로 닫힌 run의 입력이 켤 때 다시 돌면 attended turn이 생겨 바깥 효과가 두 번 난다.
test("켤 때 unattended 사람 메시지는 queue에 다시 들어가지 않는다. 실패로 닫힌 run의 입력이 다시 돌아 바깥 효과가 두 번 나지 않는다", () => {
  const { sql, session, message } = setup();
  session("ses_run", false);
  message("m_human", "ses_run", null);
  message("m_run", "ses_run", null, "human", 1);

  assert.deepStrictEqual(
    unstartedHumanMessages(sql).map((item) => item.id),
    ["m_human"],
  );
});
