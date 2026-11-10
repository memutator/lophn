import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { Sql } from "../../../protocol/server/mod.ts";
import { revertSchemaSteps } from "./rewind/mod.ts";
import { ok } from "../../../base/mod.ts";
import type { RequestContext, Tx } from "../../../protocol/server/mod.ts";
import {
  createMessageCommands,
  unstartedHumanMessages,
} from "./message-commands.ts";
import { receivedParts } from "../run-loop/input-text.ts";
import { loadMessage, receivedMessageOf } from "./model.ts";
import { conversationTestSteps } from "./test-steps.ts";

function setup() {
  const db = new DatabaseSync(":memory:");
  for (const step of [...conversationTestSteps, ...revertSchemaSteps]) {
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

// shell 기록이 queue에 들거나 켤 때 되돌아가면 사람이 친 `!`마다 model 호출(turn)이 하나씩 생긴다.
test("RecordShellMessage로 쓴 메시지는 Router에 넣지 않고 켤 때 queue에 되돌리지도 않는다", () => {
  const { sql, session } = setup();
  session("ses_shell", false);
  let routed = 0;
  const published: string[] = [];
  const { shell } = createMessageCommands({
    router: {
      route: () => {
        routed += 1;
        return ok({ session: null });
      },
    },
    directory: {
      find: () => ({ accepting: true }) as never,
      app: () => null,
    },
    publish: (_tx, event) => published.push(event.type),
  });
  const tx = {
    sql,
    now: () => "2026-10-17T00:00:00.000Z",
    registerBlobRef: () => ok(undefined),
  } as unknown as Tx;
  const ctx = { principal: "user:me", actor: "user" } as RequestContext;
  const done = shell.handle(
    tx,
    ctx,
    {
      id: "msg_shell",
      session: "ses_shell",
      command: "echo hi",
      exit_code: 0,
      timed_out: false,
      stdout: "hi",
      stderr: "",
      truncated: false,
      duration_ms: 3,
    },
    {} as never,
  );

  assert.equal(done instanceof Promise ? false : done.ok, true);
  assert.equal(routed, 0);
  assert.deepStrictEqual(published, ["ShellRan"]);
  assert.deepStrictEqual(unstartedHumanMessages(sql), []);
});

const SES = "ses_01hzzzzzzzzzzzzzzzzzzzzzza";
const CHAT = "msg_01hzzzzzzzzzzzzzzzzzzzzzza";
const VIEW = "msg_01hzzzzzzzzzzzzzzzzzzzzzzb";
// 앱 화면이 보낸 사람 메시지는 이름표만 붙는다. 보낸 쪽은 그대로 사람이고 model이 받는 글(받은 turn과 이력)은 채팅 탭에서 보낸 같은 메시지와 같다.
test("앱 화면이 보낸 메시지는 보낸 앱을 이름표로 얼리고 model이 받는 글은 채팅 탭에서 보낸 것과 같다", () => {
  const { sql, session } = setup();
  session(SES, false);
  const routed: unknown[] = [];
  const { send } = createMessageCommands({
    router: {
      route: (_tx, input) => {
        routed.push(input);
        return ok({ session: null });
      },
    },
    directory: {
      find: () => ({ accepting: true }) as never,
      app: () => ({ slug: "masup" }),
    },
  });
  const tx = {
    sql,
    now: () => "2026-10-17T00:00:00.000Z",
    registerBlobRef: () => ok(undefined),
  } as unknown as Tx;
  const ctx = { principal: "user:me", actor: "user" } as RequestContext;
  const app = "app_01hzzzzzzzzzzzzzzzzzzzzzza";
  const make = (id: string, via?: string) =>
    send.handle(
      tx,
      ctx,
      {
        id,
        session: SES,
        content: [{ type: "text", text: "go on" }],
        delivery: "next_turn",
        refs: [],
        ...(via === undefined ? {} : { via_app: via }),
      } as never,
      {} as never,
    );
  assert.ok((make(CHAT) as { ok: boolean }).ok);
  assert.ok((make(VIEW, app) as { ok: boolean }).ok);

  const rows = sql.all(
    "select id, from_kind, origin_app from messages order by created_seq",
    [],
  );
  assert.deepStrictEqual(
    rows.map((row) => [row["id"], row["from_kind"], row["origin_app"]]),
    [
      [CHAT, "human", null],
      [VIEW, "human", `${app}|masup`],
    ],
  );
  // Router에는 보낸 쪽 human 그대로 가고 이름표만 따로 간다.
  assert.deepStrictEqual(
    routed.map((input) => [
      (input as { from: unknown }).from,
      (input as { via: unknown }).via,
    ]),
    [
      [{ kind: "human" }, null],
      [{ kind: "human" }, { app, slug: "masup" }],
    ],
  );
  const textOf = (id: string) => {
    const row = loadMessage({ sql }, id)!;
    const received = receivedMessageOf(row);
    assert.deepStrictEqual(received.from, { kind: "human" });
    return JSON.stringify(
      receivedParts(received, [{ type: "text", text: "go on" }]),
    );
  };
  assert.equal(textOf(VIEW), textOf(CHAT));
  assert.deepStrictEqual(receivedMessageOf(loadMessage({ sql }, VIEW)!).via, {
    app,
    slug: "masup",
  });
  // 한 번 쓴 이름표는 바뀌지 않는다.
  assert.throws(() =>
    sql.run("update messages set origin_app = null where id = ?", [VIEW]),
  );
});
