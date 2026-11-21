import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { Id } from "../../protocol/base/ids.ts";
import type {
  AgentCallRow,
  CallReply,
} from "../../protocol/lophn-agent/calls.ts";
import type { Sql, Tx } from "../../protocol/server/mod.ts";
import { appSenderSchemaSteps } from "./app-sender-schema.ts";
import { remoteSenderCallsSchemaSteps } from "./remote-sender-schema.ts";
import { ROUTER_SCHEMA_STEPS } from "./schema.ts";
import {
  callsOfSession,
  createCallStore,
  deleteAppCallsReceivedBy,
  deleteCallsSentByApp,
} from "./store.ts";

// 답 없는 call(handoff)이 받는 turn이 가져간 뒤에도 accepted로 남으면, 받는 session을 닫을 때 보낸 쪽에 거짓 실패가 간다.
// 가져가기 전에 끝나 버리면, 켤 때 잃은 call로 닫히지 않고 조용히 사라진다.

const AT = "2026-10-29T00:00:00.000Z";
// 행을 읽을 때 `to`를 schema로 검사하므로 session id는 진짜 모양이어야 한다.
const SENDER: Id<"ses"> = `ses_0${"y".repeat(25)}`;
const RECEIVER: Id<"ses"> = `ses_0${"z".repeat(25)}`;

test("답 없는 call은 받는 turn이 가져갈 때 done이 되고, 가져가기 전이면 켤 때 잃은 call로 남는다", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of ROUTER_SCHEMA_STEPS) db.exec(step.sql);
  // messages 표가 없는 이 test는 agent_calls를 짜는 step만 더한다.
  db.exec(
    appSenderSchemaSteps.find(
      (step) => step.id === "router.app-sender.agent-calls",
    )!.sql,
  );
  db.exec(remoteSenderCallsSchemaSteps[0]!.sql);
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  const tx = { sql, now: () => AT } as unknown as Tx;
  const store = createCallStore();
  const calls: [Id<"cal">, CallReply, boolean][] = [
    ["cal_none", "none", true],
    ["cal_result", "result", true],
    ["cal_conversation", "conversation", true],
    ["cal_none_waiting", "none", false],
    // 부모가 가져간 ask call도 켤 때 잃은 것이다: 자식의 request는 메모리라 사라졌다.
    ["cal_ask", "result", true],
  ];
  for (const [call, reply] of calls) {
    const stored = store.insert(tx, {
      call,
      from: { kind: "agent", session: SENDER },
      to: { kind: "open_session", session: RECEIVER },
      receiver_session: RECEIVER,
      reply,
      state: "accepted",
      fail_reason: null,
      dedup: call,
      unattended: false,
      ask: call === "cal_ask" ? "approval" : null,
      created_at: AT,
      state_changed_at: AT,
      result: null,
      delivery: null,
      remote_session: null,
    });
    assert.ok(stored.ok);
  }
  for (const [call, , taken] of calls) {
    if (taken) assert.ok(store.markConsumed(tx, call).ok);
  }

  assert.deepStrictEqual(
    calls.map(([call]) => store.read(tx, call)?.state),
    ["done", "accepted", "accepted", "accepted", "accepted"],
  );
  // 받는 session이 끝날 때 닫을 것과 켤 때 잃은 것에 가져간 handoff가 없다.
  assert.deepStrictEqual(
    store
      .openReceivedBy(tx, RECEIVER)
      .map((row) => row.call)
      .sort(),
    ["cal_ask", "cal_conversation", "cal_none_waiting", "cal_result"],
  );
  assert.deepStrictEqual(
    store.lost(tx).map((row) => row.call),
    ["cal_ask", "cal_none_waiting"],
  );
});

// 앱이 보낸 call 행은 답 글을 담는다. 받은 session을 지우면 글이 남지 않고, 앱이 보낸 call은 앱을 지울 때 간다. 같은 key는 같은 앱 안에서만 같은 call이다.
test("앱이 받은 답 글은 받은 session을 지울 때 같이 지워지고 dedup key는 앱마다 따로다", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of ROUTER_SCHEMA_STEPS) db.exec(step.sql);
  db.exec(
    appSenderSchemaSteps.find(
      (step) => step.id === "router.app-sender.agent-calls",
    )!.sql,
  );
  db.exec(remoteSenderCallsSchemaSteps[0]!.sql);
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  const tx = { sql, now: () => AT } as unknown as Tx;
  const store = createCallStore();
  const appA = {
    kind: "app",
    app: `app_0${"a".repeat(25)}`,
    slug: "a",
  } as const;
  const appB = {
    kind: "app",
    app: `app_0${"b".repeat(25)}`,
    slug: "b",
  } as const;
  const row = (
    call: Id<"cal">,
    from: AgentCallRow["from"],
    receiver: Id<"ses">,
    dedup: string | null,
  ) => ({
    call,
    from,
    to: { kind: "open_session" as const, session: receiver },
    receiver_session: receiver,
    reply: "result" as const,
    state: "accepted" as const,
    fail_reason: null,
    dedup,
    unattended: false,
    ask: null,
    created_at: AT,
    state_changed_at: AT,
    result: null,
    delivery: null,
    remote_session: null,
  });
  assert.ok(store.insert(tx, row("cal_a1", appA, RECEIVER, "k")).ok);
  assert.ok(store.insert(tx, row("cal_b1", appB, RECEIVER, "k")).ok);
  assert.ok(
    store.insert(
      tx,
      row("cal_g1", { kind: "agent", session: SENDER }, RECEIVER, null),
    ).ok,
  );
  assert.equal(store.byDedup(tx, appA, "k")?.call, "cal_a1");
  assert.equal(store.byDedup(tx, appB, "k")?.call, "cal_b1");
  assert.equal(
    store.byDedup(tx, { kind: "agent", session: SENDER }, "k"),
    null,
  );
  assert.ok(store.move(tx, "cal_a1", "done", null, "secret answer").ok);

  assert.ok(deleteAppCallsReceivedBy(tx, RECEIVER).ok);
  assert.equal(
    db
      .prepare("select count(*) as n from agent_calls where result is not null")
      .get()?.["n"],
    0,
  );
  // 앱이 보내지 않은 행은 글이 없어 그대로다.
  assert.equal(store.read(tx, "cal_g1")?.call, "cal_g1");

  // 보낸 session의 목록에도 그 session이 보낸 call이 든다(받은 call과 함께).
  assert.deepStrictEqual(
    callsOfSession(tx, SENDER, 10).map((one) => one.call),
    ["cal_g1"],
  );
  assert.ok(store.insert(tx, row("cal_a2", appA, SENDER, null)).ok);
  assert.deepStrictEqual(
    callsOfSession(tx, SENDER, 10)
      .map((one) => one.call)
      .sort(),
    ["cal_a2", "cal_g1"],
  );
  assert.ok(deleteCallsSentByApp(tx, appA.app).ok);
  assert.equal(store.read(tx, "cal_a2"), null);
});

// 끝난 call이 배달 중으로 보이면 화면과 목록이 끝난 일을 아직 가는 중으로 그린다. 끝난 행에 남은 값(옛 판이 쓴 것)도 null로 읽는다.
test("끝난 call의 delivery는 null로 읽힌다", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of ROUTER_SCHEMA_STEPS) db.exec(step.sql);
  db.exec(
    appSenderSchemaSteps.find(
      (step) => step.id === "router.app-sender.agent-calls",
    )!.sql,
  );
  db.exec(remoteSenderCallsSchemaSteps[0]!.sql);
  const sql: Sql = {
    run: (query, params) => db.prepare(query).run(...params),
    get: (query, params) => db.prepare(query).get(...params) as never,
    all: (query, params) => db.prepare(query).all(...params) as never,
  };
  const tx = { sql, now: () => AT } as unknown as Tx;
  const store = createCallStore();
  for (const [call, state] of [
    ["cal_open", "accepted"],
    ["cal_done", "done"],
  ] as const) {
    assert.ok(
      store.insert(tx, {
        call,
        from: { kind: "agent", session: SENDER },
        to: {
          kind: "remote",
          machine: `mch_0${"b".repeat(25)}`,
          computer: "windows",
          address: { session: RECEIVER },
        },
        receiver_session: null,
        reply: "result",
        state,
        fail_reason: null,
        dedup: null,
        unattended: false,
        ask: null,
        created_at: AT,
        state_changed_at: AT,
        result: null,
        delivery: "running",
        remote_session: null,
      }).ok,
    );
  }
  assert.equal(store.read(tx, "cal_open")?.delivery, "running");
  assert.equal(store.read(tx, "cal_done")?.delivery, null);
});
