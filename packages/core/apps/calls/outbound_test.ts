import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { ok, type Result } from "../../../base/mod.ts";
import type { Id } from "../../../protocol/base/ids.ts";
import type { Sql, Tx } from "../../../protocol/server/mod.ts";
import {
  createOutboundCallReads,
  createOutboundCalls,
  listOutboundCalls,
} from "./outbound.ts";
import { OUTBOUND_CALLS_SCHEMA_STEPS } from "./outbound-schema.ts";

const MCH = "mch_0000000000000000000000000a" as Id<"mch">;
const APP = "app_0000000000000000000000000a" as Id<"app">;
const OTHER_APP = "app_0000000000000000000000000b" as Id<"app">;
const CALLER_APP = "app_0000000000000000000000000c" as Id<"app">;
const SES = "ses_0000000000000000000000000a" as Id<"ses">;
const rcl = (n: number) =>
  `rcl_000000000000000000000000${n.toString().padStart(2, "0")}` as Id<"rcl">;

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(OUTBOUND_CALLS_SCHEMA_STEPS[0].sql);
  const sql: Sql = {
    run: (text, params) => db.prepare(text).run(...(params as never[])),
    get: (text, params) =>
      db.prepare(text).get(...(params as never[])) as never,
    all: (text, params) =>
      db.prepare(text).all(...(params as never[])) as never,
  };
  const changed: [string, string | null][] = [];
  const calls = createOutboundCalls({
    transaction: <T>(fn: (tx: Tx) => Result<T>) => fn({ sql } as Tx),
    changed: (app, callerApp) => changed.push([app, callerApp]),
  });
  return { sql, calls, changed };
}

const begin = (id: Id<"rcl">, by: "agent" | "app", app: Id<"app"> = APP) => ({
  id,
  caller:
    by === "agent"
      ? ({ kind: "agent", agent: "agt_x", session: SES, name: "Ada" } as const)
      : ({ kind: "app", app: CALLER_APP } as const),
  machine: MCH,
  computer: "studio",
  app,
  command: "collect",
  at: "2026-10-16T00:00:00.000Z",
});

// 부른 컴퓨터의 기록은 받는 컴퓨터가 꺼져 있어도 남아야 하고, 끝을 못 본 줄은 성공으로 읽히면 안 된다.
test("기록은 시작과 끝이 남고, 끝을 못 본 줄은 기동 때 unknown으로 닫히며 대상 앱·부른 앱·session으로 거른다", () => {
  const t = setup();
  assert.deepEqual(t.calls.begin(begin(rcl(1), "agent", APP)), ok(undefined));
  assert.deepEqual(
    t.calls.begin(begin(rcl(2), "app", OTHER_APP)),
    ok(undefined),
  );
  assert.deepEqual(t.calls.begin(begin(rcl(3), "app", APP)), ok(undefined));
  t.calls.finish(rcl(1), {
    status: "failed",
    error: "x".repeat(1000),
    at: "2026-10-16T00:00:01.000Z",
  });
  t.calls.closeStale("2026-10-16T00:01:00.000Z");
  // 이미 끝난 줄은 닫기가 건드리지 않는다.
  const all = listOutboundCalls(t.sql, {});
  assert.ok(all.ok);
  assert.deepEqual(
    all.value.calls.map((one) => [one.id, one.status]),
    [
      [rcl(3), "unknown"],
      [rcl(2), "unknown"],
      [rcl(1), "failed"],
    ],
  );
  assert.equal(all.value.calls[2].error?.length, 512);

  const byApp = listOutboundCalls(t.sql, { app: OTHER_APP });
  assert.ok(byApp.ok);
  assert.deepEqual(
    byApp.value.calls.map((one) => one.id),
    [rcl(2)],
  );

  const mine = listOutboundCalls(t.sql, { caller_app: CALLER_APP, limit: 1 });
  assert.ok(mine.ok);
  assert.deepEqual(
    mine.value.calls.map((one) => one.id),
    [rcl(3)],
  );
  assert.equal(mine.value.next_cursor, rcl(3));
  const bySession = listOutboundCalls(t.sql, { session: SES });
  assert.ok(bySession.ok);
  assert.deepEqual(
    bySession.value.calls.map((one) => one.id),
    [rcl(1)],
  );
  assert.deepEqual(t.changed.slice(0, 2), [
    [APP, null],
    [OTHER_APP, CALLER_APP],
  ]);

  const badCursor = createOutboundCallReads().list.handle(
    { sql: t.sql, as_of_seq: "1" } as never,
    { actor: "user" } as never,
    { cursor: "not-a-cursor" },
  );
  assert.equal(!badCursor.ok && badCursor.error.code, "invalid_input");
});
