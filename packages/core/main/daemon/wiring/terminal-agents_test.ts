import assert from "node:assert/strict";
import { test } from "node:test";
import { manualClock } from "../../../../base/mod.ts";
import {
  type AcpState,
  type AcpUpdate,
  EMPTY_ACP_STATE,
} from "../../../../protocol/acp/mod.ts";
import { routePath } from "../../../../protocol/base/mod.ts";
import { codingSessionsSwitch } from "../../../../protocol/coding-agent/relay.ts";
import type { TerminalRuntime } from "../../../../protocol/coding-agent/terminals.ts";
import type { BusEvent } from "../../../../protocol/events/bus.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import type { AcpListener } from "../../../extensions/acp.ts";
import { dispatchHttp } from "../../../server/dispatch.ts";
import { createCodingSessions } from "../../../terminal-agents/coding-sessions.ts";
import type { TabGui } from "../../../terminal-agents/gui.ts";
import { codingRedactor } from "./terminal-agents.ts";

const TERMINAL = "trm_01hzx3k4m5n6p7q8r9s0t1v2w3";
const SESSION = "ses_01hzx3k4m5n6p7q8r9s0t1v2w3";
const PROJECT = `prj_${"0".repeat(26)}`;
const SECRET = "vault-value-7f3a9c";
const AT = "2026-11-15T00:00:00.000Z";

const message = (id: string, seq: number, text: string) => ({
  kind: "message" as const,
  id,
  seq,
  at: AT,
  actor: "agent" as const,
  sender: null,
  call: null,
  reply_to: null,
  delivery: "next_turn" as const,
  turn: null,
  origin: null,
  content: [{ type: "text" as const, text }],
  reasoning: null,
  cards: [],
  complete: true,
});

// GUI handle 하나와 그 터미널. view가 tui면 handle 없이 foreground TUI만 있다.
function setup(view: "gui" | "tui", ready = true) {
  const clock = manualClock(Date.parse(AT));
  const published: BusEvent[] = [];
  const toggles: unknown[] = [];
  const timers: (() => void)[] = [];
  let state: AcpState = EMPTY_ACP_STATE;
  const listeners: AcpListener[] = [];
  const handle = {
    id: "win_1",
    terminal: TERMINAL,
    harness: "claude" as const,
    handoff: "restart" as const,
    cwd: "/work",
    state: () => state,
    attach(listener: AcpListener) {
      listener.snapshot(state);
      listeners.push(listener);
      return () => {};
    },
    input() {},
    close() {},
  };
  const gui = {
    tabSessions: () =>
      view === "gui"
        ? [
            {
              terminal_ref: TERMINAL,
              harness: "claude",
              view,
              handoff: "restart",
              title: null,
              cli_session: "cli-1",
              state: "running",
            },
          ]
        : [],
    current: (ref: string) =>
      view === "gui" && ref === TERMINAL ? { handle, view } : null,
    onHandle(listener: (one: typeof handle) => void) {
      if (view === "gui") listener(handle);
      return () => {};
    },
    toolBody: () => ({ value: `out ${SECRET}`, truncated: false }),
    async toggle(input: unknown) {
      toggles.push(input);
      return { ok: true as const };
    },
  } as unknown as TabGui;
  const runtime = {
    terminal_ref: TERMINAL,
    project: PROJECT,
    state: "running",
    cwd_at_start: "/work",
    ...(view === "tui"
      ? {
          agent: {
            harness: "claude",
            state: "running",
            hooked: true,
            foreground: true,
            session: "cli-1",
          },
        }
      : {}),
  } as TerminalRuntime;
  const coding = createCodingSessions({
    clock,
    terminals: { list: () => [runtime] },
    gui,
    after: (_ms, run) => {
      timers.push(run);
      return () => {};
    },
    publish: (event) => published.push(event),
    redact: codingRedactor(() => ({
      ready,
      match: (text) => {
        const index = text.indexOf(SECRET);
        return index < 0 ? undefined : { index, length: SECRET.length };
      },
    })),
    attached: () => true,
    platform: "linux",
  });
  return {
    coding,
    published,
    toggles,
    setState: (next: AcpState) => {
      state = next;
    },
    update: (update: AcpUpdate) => {
      for (const listener of listeners) listener.update(update);
      for (const run of timers.splice(0)) run();
    },
  };
}

// GUI 대화는 CLI의 글과 tool 출력을 그대로 싣는다. 화면과 폰으로 가는 snapshot·갱신·tool 본문에서 vault의 secret이 새면 안 된다.
test("coding session의 snapshot, AcpUpdated payload, tool 본문에는 알려진 secret이 없고, secret을 다 모르면 내지 않는다", () => {
  const { coding, published, setState, update } = setup("gui");
  setState({
    ...EMPTY_ACP_STATE,
    seq: 1,
    items: [message("m1", 1, `token is ${SECRET}`)],
  } as AcpState);
  update({
    type: "message_added",
    item: message("m2", 2, `again ${SECRET}`),
  } as AcpUpdate);

  const snapshot = coding.snapshot(SESSION);
  assert.ok(snapshot?.ok);
  assert.equal(snapshot.value.items.length, 1);
  assert.ok(!JSON.stringify(snapshot.value).includes(SECRET));
  const sent = published.filter((event) => event.type === "AcpUpdated");
  assert.equal(sent.length, 1);
  assert.ok(!JSON.stringify(sent).includes(SECRET));
  const body = coding.toolBody({
    session: SESSION,
    tool_call: "t1",
    part: "output",
  });
  assert.ok(body.ok && !body.value.value.includes(SECRET));

  const early = setup("gui", false);
  early.update({
    type: "message_added",
    item: message("m3", 3, `late ${SECRET}`),
  } as AcpUpdate);
  const refused = early.coding.snapshot(SESSION);
  assert.ok(refused !== undefined && !refused.ok);
  assert.equal(
    early.published.filter((event) => event.type === "AcpUpdated").length,
    0,
  );
  assert.ok(!JSON.stringify(early.published).includes(SECRET));
});

// 확인 없이 desktop 탭이 바뀌고 도는 turn이 끊기면 안 된다. agent가 사람 대신 바꿔도 안 된다.
test("coding_sessions/switch는 confirmed: true 없이는 invalid_input이고 view를 바꾸지 않으며, agent 자격은 forbidden이다", async () => {
  const { coding, toggles } = setup("tui");
  const memory = new Map([
    [
      "coding_sessions/switch",
      (_who: AuthenticatedContext, input: unknown) =>
        coding.switch(input as { session: string; to: "gui"; key: string }),
    ],
  ]);
  const call = async (actor: string, body: Record<string, unknown>) => {
    const done = await dispatchHttp(
      new Request(`http://127.0.0.1${routePath(codingSessionsSwitch)}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { route: codingSessionsSwitch, path: routePath(codingSessionsSwitch) },
      {
        principal: actor,
        actor,
        scope: { operations: [codingSessionsSwitch.name], targets: {} },
        conditions: {},
        credential_ref: actor,
      },
      {
        credentials: undefined as never,
        clock: manualClock(0),
        memory,
        bodyTimeoutMs: 1000,
        jsonMaxBytes: 65_536,
      },
    );
    return done as { status: number; json: { error?: { code: string } } };
  };
  const input = { session: SESSION, to: "gui", key: "k1" };

  for (const unconfirmed of [input, { ...input, confirmed: false }]) {
    const refused = await call("user", unconfirmed);
    assert.equal(refused.json.error?.code, "invalid_input");
  }
  const agent = await call(`agent:${SESSION}`, { ...input, confirmed: true });
  assert.equal(agent.json.error?.code, "forbidden");
  assert.deepEqual(toggles, []);

  const done = await call("user", { ...input, confirmed: true });
  assert.equal(done.status, 200);
  assert.deepEqual(toggles, [{ terminal_ref: TERMINAL, to: "gui" }]);
});
