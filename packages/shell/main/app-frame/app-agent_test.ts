import assert from "node:assert/strict";
import { test } from "node:test";

import { createAppAgent } from "./app-agent.ts";
import type { CoreCaller } from "./app-connection.ts";
import type { BoundView } from "./registry.ts";

const APP = "app_00000000000000000000000001";
const OTHER_APP = "app_00000000000000000000000002";
const PROJECT = "prj_00000000000000000000000001";

function view(view_session: string, app: string): BoundView {
  return {
    view_session,
    generation: 1,
    target: { app, mode: "live", release: null, screen: "main", place: "tab" },
    binding: { release: null, bundleHash: "a".repeat(64), processNonce: "n" },
  };
}

function setup() {
  // session id → workspace
  const workspaces = new Map<string, unknown>([
    ["ses_other_app", { kind: "app", id: OTHER_APP }],
    ["ses_project", { kind: "project", id: PROJECT }],
    ["ses_home", null],
    ["ses_mine", { kind: "app", id: APP }],
  ]);
  const routes: string[] = [];
  const call: CoreCaller = (_kind, resource, method, body) => {
    const route = `${resource}/${method}`;
    routes.push(route);
    const input = body as {
      input?: { id: string; workspace: unknown };
      session?: string;
    };
    if (route === "sessions/open") {
      workspaces.set(input.input!.id, input.input!.workspace);
      return Promise.resolve({ ok: true, value: {} });
    }
    if (route === "sessions/read") {
      return Promise.resolve(
        workspaces.has(input.session!)
          ? {
              ok: true,
              value: { session: { workspace: workspaces.get(input.session!) } },
            }
          : { ok: false, error: { code: "not_found", message: "no" } },
      );
    }
    return Promise.resolve({ ok: true, value: { route } });
  };
  const pushed: Array<{ view: string; payload: unknown }> = [];
  const agent = createAppAgent({
    call,
    ids: { newId: () => "ses_new" },
    send: (view_session, _channel, payload) => {
      pushed.push({ view: view_session, payload });
      return true;
    },
  });
  return { agent, routes, pushed, workspaces };
}

test("앱 view는 다른 앱이나 project의 session을 읽지도 보내지도 못한다", async () => {
  const { agent, routes } = setup();
  const mine = view("v1", APP);
  for (const session of [
    "ses_other_app",
    "ses_project",
    "ses_home",
    "ses_nope",
  ]) {
    const read = await agent.snapshot(mine, { session });
    assert.deepEqual(read.ok === false && read.error.code, "forbidden");
    const sent = await agent.send(mine, {
      type: "stop",
      session,
      turn: "trn_1",
      key: "k",
    });
    assert.deepEqual(sent.ok === false && sent.error.code, "forbidden");
  }
  assert.equal(routes.includes("acp/snapshot"), false);
  assert.equal(routes.includes("acp/send"), false);
  assert.equal((await agent.snapshot(mine, { session: "ses_mine" })).ok, true);
});

test("session은 늘 그 view의 앱 workspace에 열리고, 갱신은 그 앱 workspace의 것만 받는다", async () => {
  const { agent, workspaces, pushed } = setup();
  const mine = view("v1", APP);
  const other = view("v2", OTHER_APP);
  // 페이지가 workspace를 주장해도 쓰이지 않는다.
  const opened = await agent.open(mine, { agent: "lophn" });
  assert.equal(
    opened.ok && (opened.value as { session: string }).session,
    "ses_new",
  );
  assert.deepEqual(workspaces.get("ses_new"), { kind: "app", id: APP });

  await agent.snapshot(other, { session: "ses_other_app" });
  agent.updated({ session: "ses_new", update: 1 });
  agent.updated({ session: "ses_other_app", update: 2 });
  agent.updated({ session: "ses_project", update: 3 });
  assert.deepEqual(pushed, [
    { view: "v1", payload: { session: "ses_new", update: 1 } },
    { view: "v2", payload: { session: "ses_other_app", update: 2 } },
  ]);
});

test("앱 bridge는 run_shell을 forbidden으로 막고 core route를 부르지 않는다", async () => {
  const { agent, routes } = setup();
  const sent = await agent.send(view("v1", APP), {
    type: "run_shell",
    session: "ses_mine",
    key: "k",
    command: "echo hi",
  });
  assert.deepEqual(sent.ok === false && sent.error.code, "forbidden");
  assert.equal(routes.includes("acp/send"), false);
});
