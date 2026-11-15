import assert from "node:assert/strict";
import { test } from "node:test";
import { manualClock, ok, type Result } from "../../../../base/mod.ts";
import {
  type AcpState,
  type AcpUpdate,
  EMPTY_ACP_STATE,
} from "../../../../protocol/acp/mod.ts";
import { routePath } from "../../../../protocol/base/mod.ts";
import { codingSessionsSwitch } from "../../../../protocol/coding-agent/relay.ts";
import type { BusEvent } from "../../../../protocol/events/bus.ts";
import type { TerminalSessionReport } from "../../../../protocol/lophn-agent/session-lifecycle.ts";
import type { AuthenticatedContext } from "../../../../protocol/server/mod.ts";
import {
  type CodingRequest,
  createCodingRelay,
} from "../../../coding-relay/mod.ts";
import { dispatchHttp } from "../../../server/dispatch.ts";
import { relayRedactor } from "./coding-relay.ts";

const TERMINAL = "trm_01hzx3k4m5n6p7q8r9s0t1v2w3";
const SESSION = "ses_01hzx3k4m5n6p7q8r9s0t1v2w3";
const PROJECT = `prj_${"0".repeat(26)}`;
const SECRET = "vault-value-7f3a9c";
const AT = "2026-11-15T00:00:00.000Z";

const report = (view: "gui" | "tui"): TerminalSessionReport => ({
  terminal_ref: TERMINAL,
  project: PROJECT as never,
  harness: "claude",
  state: "running",
  cli_session: "cli-1",
  title: null,
  cwd: null,
  shell_pid: 1,
  view,
  handoff: "restart",
  foreground: view === "tui",
});

function setup() {
  const clock = manualClock(Date.parse(AT));
  const published: BusEvent[] = [];
  const calls: CodingRequest[] = [];
  const relay = createCodingRelay({
    clock,
    publish: (event) => published.push(event),
    call: (request) => {
      calls.push(request);
      return Promise.resolve(
        ok([{ type: "text", text: "ok" }]) as Result<unknown>,
      );
    },
    attached: () => true,
    redact: relayRedactor(() => ({
      ready: true,
      match: (text) => {
        const index = text.indexOf(SECRET);
        return index < 0 ? undefined : { index, length: SECRET.length };
      },
    })),
    platform: "linux",
  });
  return { relay, published, calls };
}

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

// host가 올린 GUI 대화는 CLI의 글과 tool 출력을 그대로 싣는다. 폰으로 가는 사본과 갱신에서 vault의 secret이 새면 안 된다.
test("relay가 접은 snapshot과 AcpUpdated payload에는 알려진 secret이 없다", () => {
  const { relay, published } = setup();
  relay.reported([report("gui")]);
  const snapshot: AcpState = {
    ...EMPTY_ACP_STATE,
    seq: 2,
    items: [
      message("m1", 1, `token is ${SECRET}`),
      {
        kind: "tool",
        id: "t1",
        seq: 2,
        at: AT,
        by: "agent",
        turn: null,
        tool: "shell.run",
        category: "command",
        title: `echo ${SECRET}`,
        state: "ok",
        duration_ms: 1,
        detail: { kind: "generic" },
        body: { input: `echo ${SECRET}`, output: SECRET, truncated: false },
      },
    ],
  } as AcpState;
  const updates: AcpUpdate[] = [
    { type: "message_added", item: message("m2", 3, `again ${SECRET}`) },
    {
      type: "tool_ended",
      tool_call: "t1",
      state: "ok",
      at: AT,
      detail: null,
      body: { input: null, output: `out ${SECRET}`, truncated: false },
    },
  ] as AcpUpdate[];
  relay.sync({ session: SESSION, snapshot, updates });

  const folded = relay.snapshot(SESSION);
  assert.ok(folded !== undefined);
  assert.equal(folded.items.length, 3);
  assert.ok(!JSON.stringify(folded).includes(SECRET));
  const sent = published.filter((event) => event.type === "AcpUpdated");
  assert.equal(sent.length, 2);
  assert.ok(!JSON.stringify(sent).includes(SECRET));
  assert.equal(
    (sent[0]!.payload as { update: AcpUpdate }).update.type,
    "message_added",
  );
});

// 확인 없이 desktop 탭이 바뀌고 도는 turn이 끊기면 안 된다. agent가 사람 대신 바꿔도 안 된다.
test("coding_sessions/switch는 confirmed: true 없이는 invalid_input이고 host에 요청이 나가지 않으며, agent 자격은 forbidden이다", async () => {
  const { relay, calls } = setup();
  relay.reported([report("tui")]);
  const memory = new Map([
    [
      "coding_sessions/switch",
      (_who: AuthenticatedContext, input: unknown) =>
        relay.switch(input as { session: string; to: "gui"; key: string }),
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
  assert.deepEqual(calls, []);

  const done = await call("user", { ...input, confirmed: true });
  assert.equal(done.status, 200);
  assert.deepEqual(calls, [
    {
      kind: "coding_switch",
      payload: { terminal_ref: TERMINAL, to: "gui" },
    },
  ]);
});
