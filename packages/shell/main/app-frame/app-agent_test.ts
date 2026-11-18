import assert from "node:assert/strict";
import { test } from "node:test";

import { createAppAgent } from "./app-agent.ts";
import type { CoreCaller } from "./app-connection.ts";
import type { BoundView } from "./registry.ts";

const APP = "app_00000000000000000000000001";
const OTHER_APP = "app_00000000000000000000000002";

function view(view_session: string, app: string): BoundView {
  return {
    view_session,
    machine: null,
    generation: 1,
    target: { app, mode: "live", release: null, screen: "main", place: "tab" },
    binding: { release: null, bundleHash: "a".repeat(64), processNonce: "n" },
  };
}

function setup() {
  // session id → core가 이 앱에 보인다고 답하는 줄(없으면 안 보이는 session이다). 시야는 core가 판정하므로 이 fake가 그 답을 대신한다.
  const visible = new Map<string, { kind: string }>([
    ["ses_mine", { kind: "lophn" }],
    // 다른 workspace의 session도 call 정책이 허락하면 보인다(같은 workspace만이 아니다).
    ["ses_project", { kind: "lophn" }],
    ["ses_harness", { kind: "harness" }],
    ["term:tab", { kind: "terminal" }],
  ]);
  const routes: string[] = [];
  const sentBodies: unknown[] = [];
  const call: CoreCaller = (_kind, resource, method, body) => {
    const route = `${resource}/${method}`;
    routes.push(route);
    if (route === "acp/send") sentBodies.push(body);
    const input = body as { session?: string; agent?: string };
    if (route === "app_sessions/list") {
      const found = visible.get(input.session ?? "");
      return Promise.resolve({
        ok: true,
        value: { sessions: found === undefined ? [] : [found] },
      });
    }
    if (route === "app_sessions/open") {
      return input.agent === "elsewhere"
        ? Promise.resolve({
            ok: false,
            error: { code: "not_found", message: "agent not found" },
          })
        : Promise.resolve({ ok: true, value: { session: "ses_new" } });
    }
    return Promise.resolve({ ok: true, value: { route } });
  };
  const pushed: Array<{ view: string; payload: unknown }> = [];
  const agent = createAppAgent({
    call: () => call,
    send: (view_session, _channel, payload) => {
      pushed.push({ view: view_session, payload });
      return true;
    },
  });
  return { agent, routes, pushed, sentBodies };
}

test("앱 view는 core가 안 보인다고 한 session과 터미널 탭을 읽지도 보내지도 못하고, 보이는 session은 workspace와 상관없이 붙는다", async () => {
  const { agent, routes } = setup();
  const mine = view("v1", APP);
  for (const session of ["ses_private", "term:tab", "ses_nope"]) {
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
  for (const session of ["ses_mine", "ses_project", "ses_harness"]) {
    assert.equal((await agent.snapshot(mine, { session })).ok, true);
  }
});

test("session은 core가 연다(앱 id는 main이 싣는다). 갱신은 그 view가 읽은 session의 것만 받는다", async () => {
  const { agent, pushed } = setup();
  const mine = view("v1", APP);
  const other = view("v2", OTHER_APP);
  const opened = await agent.open(mine, { agent: "helper" });
  assert.equal(
    opened.ok && (opened.value as { session: string }).session,
    "ses_new",
  );
  const unknown = await agent.open(mine, { agent: "elsewhere" });
  assert.equal(unknown.ok === false && unknown.error.code, "not_found");

  await agent.snapshot(other, { session: "ses_project" });
  agent.updated({ session: "ses_new", update: 1 });
  agent.updated({ session: "ses_project", update: 2 });
  agent.updated({ session: "ses_harness", update: 3 });
  assert.deepEqual(pushed, [
    { view: "v1", payload: { session: "ses_new", update: 1 } },
    { view: "v2", payload: { session: "ses_project", update: 2 } },
  ]);
});

test("앱 bridge는 send·stop·answer·rename만 넘기고 승인(decide) 같은 나머지는 core에 닿기 전에 forbidden으로 막는다", async () => {
  const { agent, routes } = setup();
  const mine = view("v1", APP);
  const refused = [
    {
      type: "decide",
      session: "ses_mine",
      request: "req_1",
      decision: { kind: "tool", choice: "once" },
    },
    { type: "run_shell", session: "ses_mine", key: "k", command: "echo hi" },
    { type: "rewind", session: "ses_mine", key: "k" },
    { session: "ses_mine" },
  ];
  for (const input of refused) {
    const sent = await agent.send(mine, input);
    assert.deepEqual(sent.ok === false && sent.error.code, "forbidden");
  }
  assert.equal(routes.includes("acp/send"), false);
  const renamed = await agent.send(mine, {
    type: "rename",
    session: "ses_mine",
    key: "k",
    title: "Game 1",
  });
  assert.equal(renamed.ok, true);
  assert.equal(routes.includes("acp/send"), true);
});

// 앱 화면이 보낸 사람 메시지에는 그 앱의 이름표가 붙는다. page가 주장한 앱은 버려진다(이름표라도 남의 이름을 달 수 없다).
test("앱 view가 보낸 메시지는 sender view의 앱 이름표를 달고 page가 준 이름표는 덮인다", async () => {
  const { agent, sentBodies } = setup();
  const mine = view("v1", APP);
  const sent = await agent.send(mine, {
    type: "send",
    session: "ses_mine",
    id: "msg_1",
    key: "k",
    content: [],
    delivery: "next_turn",
    via_app: OTHER_APP,
  });
  assert.equal(sent.ok, true);
  assert.deepEqual((sentBodies[0] as { via_app: string }).via_app, APP);
});
