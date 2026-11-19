import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type { CallPolicy } from "../../../protocol/lophn-agent/call-policy.ts";
import type { SessionInfo } from "../../../protocol/lophn-agent/session-lifecycle.ts";
import type { RequestContext, Sql, Tx } from "../../../protocol/server/mod.ts";
import { turnSchemaSteps } from "../run-loop/schema.ts";
import { UNWIRED_END_DEPS } from "../workspaces/unwired.ts";
import type { EndDeps } from "../workspaces/ports.ts";
import { createConversationCommands } from "./commands.ts";
import { createSessionLifecycle } from "./lifecycle.ts";
import { conversationTestSteps } from "./test-steps.ts";

const prj = (suffix: string) => `prj_${"0".repeat(24)}${suffix}`;
const app = (suffix: string) => `app_${"0".repeat(24)}${suffix}`;
const OPEN = prj("o1");
const PRIVATE = prj("p1");
const ME = app("m1");

function setup() {
  const db = new DatabaseSync(":memory:");
  db.exec(
    "CREATE TABLE sessions (id TEXT, agent TEXT, project TEXT, app TEXT, workspace_kind TEXT, workspace_id TEXT, title TEXT, lifecycle TEXT, forked_from_session TEXT, forked_from_through_seq TEXT, model_selection TEXT, compaction_through_seq TEXT, compaction_summary_call TEXT, skip INTEGER, harness TEXT, harness_session TEXT, called_from_kind TEXT, called_from_id TEXT, spawned_by TEXT, opened_by_app TEXT, created_seq TEXT, state_seq TEXT);" +
      "CREATE TABLE turns (id TEXT, session TEXT, state TEXT, state_seq TEXT, started_at TEXT, finished_at TEXT);",
  );
  const policy: CallPolicy = {
    private: [{ kind: "project", id: PRIVATE } as never],
    workspaces: [],
    agents: [],
  };
  const emitted: { name: string; info: SessionInfo; sees: boolean }[] = [];
  const interrupted: string[] = [];
  const lifecycle = createSessionLifecycle({
    sql: {
      get: (query, params = []) =>
        db.prepare(query).get(...(params as SQLInputValue[])) as never,
      all: (query, params = []) =>
        db.prepare(query).all(...(params as SQLInputValue[])) as never,
    },
    agent: () => ({ handle: "x", name: "x", runtime: "lophn" }),
    harnessId: (runtime) => runtime,
    waits: () => ({ approval: false, question: false }),
    folders: () => ({ cwd: null, folders: [] }),
    projectFolders: () => [],
    policy: () => policy,
    emit: (name, info, audience) =>
      emitted.push({ name, info, sees: audience(ME) }),
    anySubscriber: () => true,
    interruptTerminal: async (tab) => {
      interrupted.push(tab);
      return ok(undefined);
    },
    stopTurn: async () => ok(undefined),
    recordAppStop: async () => {},
  });
  const report = (project: string, ref: string) => ({
    terminal_ref: ref,
    project: project as never,
    harness: "claude",
    state: "running" as const,
    cli_session: null,
    title: null,
    cwd: null,
    shell_pid: 123,
    view: "tui" as const,
    handoff: null,
    foreground: true,
  });
  lifecycle.reportTerminals([
    report(OPEN, "t-open"),
    report(PRIVATE, "t-private"),
  ]);
  return { lifecycle, emitted, interrupted };
}

// 앱은 그 앱 workspace에 사는 agent가 call로 닿을 수 있는 workspace의 session만 본다. private workspace의 session은 목록에도 event에도
// 없고 멈추기도 없는 session처럼 거절된다.
test("private workspace의 session은 앱에게 목록·event에 안 보이고 멈추기는 not_found다", async () => {
  const { lifecycle, emitted, interrupted } = setup();
  assert.deepStrictEqual(
    lifecycle.list(ME, {}).map((one) => one.session),
    ["term:t-open"],
  );
  const seenBy = (ref: string) =>
    emitted.filter((one) => one.info.session === ref).map((one) => one.sees);
  assert.deepStrictEqual([...new Set(seenBy("term:t-open"))], [true]);
  assert.deepStrictEqual([...new Set(seenBy("term:t-private"))], [false]);
  const refused = await lifecycle.stop(ME, "term:t-private");
  assert.ok(!refused.ok);
  assert.equal(refused.error.code, "not_found");
  assert.deepStrictEqual(interrupted, []);
  const allowed = await lifecycle.stop(ME, "term:t-open");
  assert.ok(allowed.ok);
  assert.deepStrictEqual(interrupted, ["t-open"]);
});

// 다른 기기가 방금 시작한 turn이 도는 중에는 확인(`stop_turn: true`) 없는 보관이 conflict(turn_running)로 거절되고 turn이 멈추지 않는다.
test("도는 turn이 있는 session은 stop_turn 없이 archive하면 conflict(turn_running)이고, stop_turn: true로만 멈추고 archive한다", () => {
  const db = new DatabaseSync(":memory:");
  for (const step of [...conversationTestSteps, ...turnSchemaSteps]) {
    db.exec(step.sql);
  }
  const hash = "a".repeat(64);
  db.exec(`
    insert into sessions (id, agent, lifecycle, created_seq, state_seq)
      values ('ses_running', 'lophn', 'open', 1, 1),
             ('ses_idle', 'lophn', 'open', 2, 2);
    insert into messages (id, session, from_kind, delivery, body, created_seq, created_at, state_seq)
      values ('msg_1', 'ses_running', 'human', 'next_turn', '${hash}', 1, '2026-11-19T00:00:00.000Z', 1),
             ('msg_2', 'ses_idle', 'human', 'next_turn', '${hash}', 2, '2026-11-19T00:00:00.000Z', 2);
    insert into turns (id, session, input_message, state, basis, started_at, limits, mode, finished_at, outcome_kind, outcome_reason, result, state_seq)
      values ('trn_1', 'ses_running', 'msg_1', 'running', '${hash}', '2026-11-19T00:00:00.000Z', '{}', 'attended', null, null, null, null, 1),
             ('trn_2', 'ses_idle', 'msg_2', 'finished', '${hash}', '2026-11-19T00:00:00.000Z', '{}', 'attended', '2026-11-19T00:00:01.000Z', 'completed', 'done', '{}', 2);
  `);
  const sql: Sql = {
    run: (query, params = []) => db.prepare(query).run(...params),
    get: (query, params = []) => db.prepare(query).get(...params) as never,
    all: (query, params = []) => db.prepare(query).all(...params) as never,
  };
  const interrupted: string[] = [];
  const ended: string[] = [];
  const end: EndDeps = {
    ...UNWIRED_END_DEPS,
    interruptRunningTurns: (_tx, session) => {
      interrupted.push(session);
      return ok(undefined);
    },
    publish: (_tx, event) => ended.push(event.type),
  };
  const commands = createConversationCommands({ end } as never);
  const tx = { sql, now: () => "2026-11-19T00:00:01.000Z" } as unknown as Tx;
  const user = { actor: "user" } as RequestContext;

  // 도는 turn이 있으면 확인 없이 보관할 수 없다.
  const refused = commands.archive.handle(
    tx,
    user,
    { session: "ses_running" },
    { state_seq: "1" },
  );
  assert.ok(!refused.ok);
  assert.equal(refused.error.code, "conflict");
  assert.deepStrictEqual(refused.error.details, { reason: "turn_running" });
  assert.equal(
    sql.get("select lifecycle from sessions where id = ?", ["ses_running"])?.[
      "lifecycle"
    ],
    "open",
  );
  assert.deepStrictEqual(interrupted, []);
  assert.deepStrictEqual(ended, []);

  // stop_turn: true로 확인하면 turn을 멈추고 보관한다.
  const confirmed = commands.archive.handle(
    tx,
    user,
    { session: "ses_running", stop_turn: true },
    { state_seq: "1" },
  );
  assert.ok(confirmed.ok);
  assert.equal(confirmed.value.archived, true);
  assert.equal(
    sql.get("select lifecycle from sessions where id = ?", ["ses_running"])?.[
      "lifecycle"
    ],
    "archived",
  );
  assert.deepStrictEqual(interrupted, ["ses_running"]);
  assert.deepStrictEqual(ended, ["SessionEnded"]);

  // 끝난 turn만 있는 session은 stop_turn 없이 바로 보관된다.
  const idle = commands.archive.handle(
    tx,
    user,
    { session: "ses_idle" },
    { state_seq: "2" },
  );
  assert.ok(idle.ok);
  assert.equal(
    sql.get("select lifecycle from sessions where id = ?", ["ses_idle"])?.[
      "lifecycle"
    ],
    "archived",
  );
});
