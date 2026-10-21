import { assert, assertEquals } from "@std/assert";
import { DatabaseSync } from "node:sqlite";
import { ok } from "../../../base/mod.ts";
import { TicketSessionEnd } from "../../../protocol/coding-agent/ticket/ports.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import { ROUTER_SCHEMA_STEPS } from "../../router/mod.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import { ticketSchemaSteps } from "../tickets/schema.ts";
import { applyHook } from "./hook.ts";
import { createCodingMemory } from "./memory.ts";
import { codingSchemaSteps } from "./schema.ts";
import { applyTerminalExited, applyTerminalResult } from "./terminal.ts";
import { createCodingTransport } from "./transport.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzz00001";
const SENDER = "ses_01hzzzzzzzzzzzzzzzzzz00001";
const ticket = (n: number) => `tkt_01hzzzzzzzzzzzzzzzzzz0000${n}`;
const call = (n: number) => `cal_01hzzzzzzzzzzzzzzzzzz0000${n}`;

function setup() {
  const db = new DatabaseSync(":memory:");
  for (
    const step of [
      ...ticketSchemaSteps,
      ...ROUTER_SCHEMA_STEPS,
      ...codingSchemaSteps,
    ]
  ) db.exec(step.sql);
  db.exec("CREATE TABLE apps (id TEXT PRIMARY KEY, source_path TEXT)");
  db.prepare("INSERT INTO apps VALUES (?, '/work/app')").run(APP);
  for (const n of [1, 2]) {
    db.prepare(
      `INSERT INTO tickets (id, app, state, goal, acceptance_check, revision)
       VALUES (?, ?, 'open', 'goal', '{"kind":"app_test"}', '1')`,
    ).run(ticket(n), APP);
    db.prepare(
      `INSERT INTO agent_calls (call, from_session, "to", reply, state, consumed, created_at, state_at)
       VALUES (?, ?, ?, 'result', 'accepted', 0, 't', 't')`,
    ).run(
      call(n),
      SENDER,
      JSON.stringify({ kind: "open_session", session: SENDER }),
    );
  }
  const actions: { topic: string; data: unknown }[] = [];
  const settled: string[] = [];
  let counter = 0;
  const ports = new Map<unknown, unknown>([
    [afterCommit, {
      push: (topic: string, data: unknown) => actions.push({ topic, data }),
    }],
    [TicketSessionEnd, {
      settle: (session: string) => {
        settled.push(session);
        return ok({ ticket: ticket(1), reported: false });
      },
    }],
  ]);
  const sql = {
    run: (text: string, params: never[]) => {
      const result = db.prepare(text).run(...params);
      return {
        changes: result.changes,
        lastInsertRowid: result.lastInsertRowid,
      };
    },
    get: (text: string, params: never[]) =>
      db.prepare(text).get(...params) as Record<string, never> | undefined,
    all: (text: string, params: never[]) =>
      db.prepare(text).all(...params) as Record<string, never>[],
  };
  const tx = {
    sql,
    emit: () => "1",
    now: () => "2026-10-16T00:00:00.000Z",
    newId: (prefix: string) =>
      `${prefix}_01hzzzzzzzzzzzzzzzzzz${String(++counter).padStart(5, "0")}`,
    port: (key: unknown) => ports.get(key),
  } as unknown as Tx;
  const memory = createCodingMemory();
  memory.detections.set("claude", {
    harness_id: "claude",
    discovery: "detected",
    selected_executable: "/usr/bin/claude",
  } as never);
  const transport = createCodingTransport(memory, () => sql);
  const frames = (kind: string) =>
    actions.filter((action) => action.topic === "coding_terminal").map((a) =>
      a.data as Record<string, unknown>
    ).filter((request) => request.kind === kind);
  const start = (n: number) =>
    transport.start(tx, {
      call: call(n) as never,
      app: APP,
      ticket: ticket(n),
      options: { harness: "claude" },
    });
  const hook = (event: string, payload: object = {}) =>
    applyHook(tx, memory, {
      session: sessionOf(),
      harness: "claude",
      event,
      payload,
    });
  const sessionOf = () =>
    String(
      db.prepare("SELECT session FROM coding_sessions WHERE ended = 0")
        .get()?.session,
    );
  return {
    db,
    tx,
    memory,
    transport,
    frames,
    start,
    hook,
    revoked: () =>
      actions.filter((action) => action.topic === "coding_revoke").map((a) =>
        (a.data as { session: string }).session
      ),
    settled,
    sessionOf,
  };
}

Deno.test("앱 하나에 session은 하나뿐이고 끝나면 줄의 다음 call이 새 session으로 열린다", () => {
  const { db, tx, memory, transport, frames, start, revoked, settled } =
    setup();
  const first = start(1);
  assert(first.ok && first.value.status === "started");
  const firstSession = first.value.session;
  const second = start(2);
  assert(second.ok);
  assertEquals(second.value, { status: "queued" });
  assertEquals(frames("open").length, 1);
  assertEquals(transport.lines()[0]?.waiting.length, 1);

  // 터미널이 열렸다고 알려도 줄은 그대로다.
  const opened = frames("open")[0]!.request as string;
  assert(applyTerminalResult(tx, memory, { request: opened, ok: true }).ok);
  assertEquals(frames("open").length, 1);

  assert(applyTerminalExited(tx, memory, firstSession).ok);
  assertEquals(revoked(), [firstSession]);
  assertEquals(settled, [firstSession]);
  const plans = frames("open").map((request) =>
    request.plan as { session: string; env: Record<string, string> }
  );
  assertEquals(plans.length, 2);
  assert(plans[1]!.session !== firstSession);
  assertEquals(transport.lines()[0]?.waiting.length, 0);
  assertEquals(
    db.prepare("SELECT count(*) AS n FROM coding_sessions WHERE ended = 0")
      .get()?.n,
    1,
  );
  db.close();
});

Deno.test("메시지는 idle일 때만 넣고 알 수 없는 상태에서는 거절한다", () => {
  const { db, tx, memory, transport, frames, start, hook, sessionOf } = setup();
  const started = start(1);
  assert(started.ok);
  const session = sessionOf();
  const send = (text: string) =>
    transport.send(tx, { session, call: call(1) as never, text });

  const unknown = send("hi");
  assert(!unknown.ok && unknown.error.details?.reason === "state_unknown");

  assert(hook("SessionStart", { session_id: "ext-1" }).ok);
  const delivered = send("one");
  assert(delivered.ok && delivered.value.status === "delivered");
  // 앞 메시지가 turn으로 이어지기 전에 온 메시지는 기다린다.
  const queued = send("two");
  assert(queued.ok && queued.value.status === "queued");
  assertEquals(frames("input").length, 1);

  assert(hook("UserPromptSubmit").ok);
  assert(send("three").ok);
  assertEquals(frames("input").length, 1);
  // turn이 끝나면 대기열에서 하나만 나간다.
  assert(hook("Stop").ok);
  assertEquals(frames("input").map((request) => request.text), ["one", "two"]);

  const result = applyTerminalResult(tx, memory, {
    request: frames("input")[1]!.request as string,
    ok: true,
  });
  assert(result.ok);
  db.close();
});
