import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { test } from "node:test";
import { ok } from "../../../base/mod.ts";
import type { CallPolicy } from "../../../protocol/lophn-agent/call-policy.ts";
import type { SessionInfo } from "../../../protocol/lophn-agent/session-lifecycle.ts";
import { createSessionLifecycle } from "./lifecycle.ts";

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
    shellAttached: () => true,
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
