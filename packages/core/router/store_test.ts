import assert from "node:assert/strict";
import { test } from "node:test";
import { DatabaseSync } from "node:sqlite";
import type { Id } from "../../protocol/base/ids.ts";
import type { CallReply } from "../../protocol/lophn-agent/calls.ts";
import type { Sql, Tx } from "../../protocol/server/mod.ts";
import { ROUTER_SCHEMA_STEPS } from "./schema.ts";
import { createCallStore } from "./store.ts";

// 답 없는 call(handoff)이 받는 turn이 가져간 뒤에도 accepted로 남으면, 받는 session을 닫을 때 보낸 쪽에 거짓 실패가 간다.
// 가져가기 전에 끝나 버리면, 켤 때 잃은 call로 닫히지 않고 조용히 사라진다.

const AT = "2026-10-29T00:00:00.000Z";
// 행을 읽을 때 `to`를 schema로 검사하므로 session id는 진짜 모양이어야 한다.
const SENDER: Id<"ses"> = `ses_0${"y".repeat(25)}`;
const RECEIVER: Id<"ses"> = `ses_0${"z".repeat(25)}`;

test("답 없는 call은 받는 turn이 가져갈 때 done이 되고, 가져가기 전이면 켤 때 잃은 call로 남는다", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of ROUTER_SCHEMA_STEPS) db.exec(step.sql);
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
      created_at: AT,
      state_changed_at: AT,
    });
    assert.ok(stored.ok);
  }
  for (const [call, , taken] of calls) {
    if (taken) assert.ok(store.markConsumed(tx, call).ok);
  }

  assert.deepStrictEqual(
    calls.map(([call]) => store.read(tx, call)?.state),
    ["done", "accepted", "accepted", "accepted"],
  );
  // 받는 session이 끝날 때 닫을 것과 켤 때 잃은 것에 가져간 handoff가 없다.
  assert.deepStrictEqual(
    store
      .openReceivedBy(tx, RECEIVER)
      .map((row) => row.call)
      .sort(),
    ["cal_conversation", "cal_none_waiting", "cal_result"],
  );
  assert.deepStrictEqual(
    store.lost(tx).map((row) => row.call),
    ["cal_none_waiting"],
  );
});
