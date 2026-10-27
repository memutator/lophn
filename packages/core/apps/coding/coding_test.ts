import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";

import { ok } from "../../../base/mod.ts";
import type { Tx } from "../../../protocol/server/mod.ts";
import {
  createCallStore,
  installRouterEnvironment,
  ROUTER_SCHEMA_STEPS,
} from "../../router/mod.ts";
import { afterCommit } from "../../storage/ledger/after-commit.ts";
import { CODING_REACTION_TEXTS } from "./close-call.ts";
import { applyHook } from "./hook.ts";
import { createCodingMemory } from "./memory.ts";
import { codingSchemaSteps } from "./schema.ts";
import { applyTerminalExited, applyTerminalResult } from "./terminal.ts";
import { createCodingTransport } from "./transport.ts";

const APP = "app_01hzzzzzzzzzzzzzzzzzz00001";
const SENDER = "ses_01hzzzzzzzzzzzzzzzzzz00001";
const call = (n: number) => `cal_01hzzzzzzzzzzzzzzzzzz0000${n}`;

function setup() {
  const db = new DatabaseSync(":memory:");
  for (
    const step of [
      ...ROUTER_SCHEMA_STEPS,
      ...codingSchemaSteps,
    ]
  ) db.exec(step.sql);
  db.exec("CREATE TABLE apps (id TEXT PRIMARY KEY, source_path TEXT)");
  db.prepare("INSERT INTO apps VALUES (?, '/work/app')").run(APP);
  for (const n of [1, 2]) {
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
  // Router 대역이 받은 입력. 맡긴 App Engineer에게 간 알림을 본다.
  const delivered: {
    session: string;
    kind: string;
    event: string | null;
    body: string;
  }[] = [];
  let counter = 0;
  const ports = new Map<unknown, unknown>([
    [afterCommit, {
      push: (topic: string, data: unknown) => actions.push({ topic, data }),
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
  installRouterEnvironment({
    deps: () => ({
      directory: {
        find: (session: string) => ({
          session,
          transport: "lophn",
          agent: { role: "app_engineer", app: APP },
          accepting: true,
        }),
        openOf: (agent: unknown) => ({
          session: SENDER,
          transport: "lophn",
          agent,
          accepting: true,
        }),
      } as never,
      transport: {
        deliver: (_tx, target, input) => {
          delivered.push({
            session: target.session,
            kind: input.kind,
            event: input.event,
            body: input.body,
          });
          return ok("delivered" as const);
        },
        cancel: () => ok(undefined),
        queued: () => [],
      },
      store: createCallStore(),
    }),
  });
  const frames = (kind: string) =>
    actions.filter((action) => action.topic === "coding_terminal").map((a) =>
      a.data as Record<string, unknown>
    ).filter((request) => request.kind === kind);
  const start = (n: number) =>
    transport.start(tx, {
      call: call(n) as never,
      app: APP,
      prompt: "do it",
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
    delivered,
    sessionOf,
  };
}

test("coding session이 끝나면 맡긴 call은 `done`으로 한 번만 닫히고 맡긴 App Engineer session에 한 번만 알린다", () => {
  const { db, tx, memory, transport, frames, start, revoked, delivered } =
    setup();
  const first = start(1);
  assert.ok(first.ok && first.value.status === "started");
  const firstSession = first.value.session;
  const second = start(2);
  assert.ok(second.ok);
  assert.deepStrictEqual(second.value, { status: "queued" });
  assert.deepStrictEqual(frames("open").length, 1);
  assert.deepStrictEqual(transport.lines()[0]?.waiting.length, 1);

  // 터미널이 열렸다고 알려도 줄은 그대로다.
  const opened = frames("open")[0]!.request as string;
  assert.ok(applyTerminalResult(tx, memory, { request: opened, ok: true }).ok);
  assert.deepStrictEqual(frames("open").length, 1);

  assert.ok(applyTerminalExited(tx, memory, firstSession).ok);
  assert.deepStrictEqual(revoked(), [firstSession]);
  // 같은 끝을 다시 알려도 call은 한 번만 닫히고 알림도 한 번이다.
  assert.ok(applyTerminalExited(tx, memory, firstSession).ok);
  assert.deepStrictEqual(
    db.prepare("SELECT state FROM agent_calls WHERE call = ?").get(call(1))
      ?.state,
    "done",
  );
  assert.deepStrictEqual(delivered.length, 1);
  assert.deepStrictEqual(delivered[0]!.session, SENDER);
  assert.deepStrictEqual(delivered[0]!.kind, "reaction");
  assert.deepStrictEqual(delivered[0]!.event, "CodingSessionEnded");
  assert.deepStrictEqual(delivered[0]!.body, CODING_REACTION_TEXTS.ended);
  const plans = frames("open").map((request) =>
    request.plan as { session: string; env: Record<string, string> }
  );
  assert.deepStrictEqual(plans.length, 2);
  assert.ok(plans[1]!.session !== firstSession);
  assert.deepStrictEqual(transport.lines()[0]?.waiting.length, 0);
  assert.deepStrictEqual(
    db.prepare("SELECT count(*) AS n FROM coding_sessions WHERE ended = 0")
      .get()?.n,
    1,
  );
  db.close();
});

test("메시지는 idle일 때만 넣고 알 수 없는 상태에서는 거절한다", () => {
  const { db, tx, memory, transport, frames, start, hook, sessionOf } = setup();
  const started = start(1);
  assert.ok(started.ok);
  const session = sessionOf();
  const send = (text: string) =>
    transport.send(tx, { session, call: call(1) as never, text });

  const unknown = send("hi");
  assert.ok(!unknown.ok && unknown.error.details?.reason === "state_unknown");

  assert.ok(hook("SessionStart", { session_id: "ext-1" }).ok);
  const delivered = send("one");
  assert.ok(delivered.ok && delivered.value.status === "delivered");
  // 앞 메시지가 turn으로 이어지기 전에 온 메시지는 기다린다.
  const queued = send("two");
  assert.ok(queued.ok && queued.value.status === "queued");
  assert.deepStrictEqual(frames("input").length, 1);

  assert.ok(hook("UserPromptSubmit").ok);
  assert.ok(send("three").ok);
  assert.deepStrictEqual(frames("input").length, 1);
  // turn이 끝나면 대기열에서 하나만 나간다.
  assert.ok(hook("Stop").ok);
  assert.deepStrictEqual(frames("input").map((request) => request.text), [
    "one",
    "two",
  ]);

  const result = applyTerminalResult(tx, memory, {
    request: frames("input")[1]!.request as string,
    ok: true,
  });
  assert.ok(result.ok);
  db.close();
});

// contract: 거절된 권한 물음은 PostToolUse가 오지 않으므로 turn이 끝나면 닫혀 대기가 풀리고 대기열이 흐른다.
// 현실적 회귀: session이 `waiting`에 영영 머물고 쌓인 메시지가 나가지 않는다.
// 왜 지금 못 잡나: 위 행은 권한 물음 없이 turn만 돈다.
test("권한 물음이 열린 채 turn이 끝나면 물음을 닫고 대기열의 메시지를 넣는다", () => {
  const { db, tx, transport, frames, start, hook, sessionOf } = setup();
  assert.ok(start(1).ok);
  const session = sessionOf();
  assert.ok(hook("SessionStart", { session_id: "ext-1" }).ok);
  assert.ok(hook("UserPromptSubmit").ok);
  assert.ok(hook("PermissionRequest", { tool_name: "Bash" }).ok);
  const queued = transport.send(tx, {
    session,
    call: call(1) as never,
    text: "later",
  });
  assert.ok(queued.ok && queued.value.status === "queued");
  assert.deepStrictEqual(frames("input").length, 0);
  assert.ok(hook("Stop").ok);
  assert.deepStrictEqual(frames("input").map((request) => request.text), [
    "later",
  ]);
  db.close();
});
