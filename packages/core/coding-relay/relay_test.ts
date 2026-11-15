import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createIdSource,
  manualClock,
  ok,
  type Result,
  seededRandom,
} from "../../base/mod.ts";
import { type AcpInput, EMPTY_ACP_STATE } from "../../protocol/acp/mod.ts";
import type { TerminalSessionReport } from "../../protocol/lophn-agent/session-lifecycle.ts";
import { createHostQueue } from "../host-queue/mod.ts";
import { createHostLink } from "../server/host-link.ts";
import type { CodingRequest } from "./ports.ts";
import { createCodingRelay } from "./relay.ts";

const TERMINAL = "trm_01hzx3k4m5n6p7q8r9s0t1v2w3";
const SESSION = "ses_01hzx3k4m5n6p7q8r9s0t1v2w3";
const PROJECT = `prj_${"0".repeat(26)}`;

const report: TerminalSessionReport = {
  terminal_ref: TERMINAL,
  project: PROJECT as never,
  harness: "claude",
  state: "idle",
  cli_session: "cli-1",
  title: null,
  cwd: null,
  shell_pid: 1,
  view: "gui",
  handoff: "restart",
  foreground: false,
};

const send = (key: string): AcpInput =>
  ({
    type: "send",
    session: SESSION,
    id: `msg_${"0".repeat(25)}1`,
    key,
    content: [{ type: "text", text: "hi" }],
    delivery: "next_turn",
  }) as AcpInput;

// adapter는 key를 거르지 않고, 폰은 다시 붙은 뒤 답을 못 받은 입력을 같은 key로 다시 보낸다. 두 번 가면 CLI session에 같은 말이 두 번 든다.
test("같은 id·key의 send를 다시 보내도 host에는 한 번만 간다", async () => {
  const clock = manualClock(0);
  const calls: CodingRequest[] = [];
  const relay = createCodingRelay({
    clock,
    publish: () => {},
    call: (request) => {
      calls.push(request);
      return Promise.resolve(ok([]) as Result<unknown>);
    },
    attached: () => true,
    redact: (value) => value,
    platform: "linux",
  });
  relay.reported([report]);
  relay.sync({ session: SESSION, snapshot: EMPTY_ACP_STATE });

  const first = relay.send(send("k1"));
  const inFlight = relay.send(send("k1"));
  assert.deepEqual(await Promise.all([first, inFlight]), [ok({}), ok({})]);
  assert.deepEqual(await relay.send(send("k1")), ok({}));
  assert.equal(calls.length, 1);
  // 새 snapshot(연결이 다시 열림)이 와도 기억한 key는 남는다.
  relay.sync({ session: SESSION, snapshot: EMPTY_ACP_STATE });
  await relay.send(send("k1"));
  assert.equal(calls.length, 1);

  await relay.send(send("k2"));
  assert.equal(calls.length, 2);
});

// 끊긴 뒤에도 사본과 목록이 남거나 진행 중이던 switch가 기다리기만 하면, 폰은 없는 탭을 보고 반쯤 바뀐 탭을 두고 기다린다.
test("연결이 닫히면 진행 중이던 coding_switch와 입력은 unavailable로 끝나고, 비운 뒤에는 목록과 사본이 없다", async () => {
  const clock = manualClock(1_700_000_000_000);
  const queue = createHostQueue({
    clock,
    ids: createIdSource({ clock, random: seededRandom(1) }),
  });
  const link = createHostLink({ queue, heartbeat: () => {} });
  const sent: string[] = [];
  const peer = link.attach({
    send: (text) => sent.push(text),
    close: () => {},
    bufferedAmount: () => 0,
  });
  peer.receive(
    JSON.stringify({ type: "hello", version: 1, workspaces: [], tui: [] }),
  );
  const relay = createCodingRelay({
    clock,
    publish: () => {},
    call: (request) => queue.callCoding(request),
    attached: () => link.attached(),
    redact: (value) => value,
    platform: "linux",
  });
  relay.reported([report]);
  relay.sync({ session: SESSION, snapshot: EMPTY_ACP_STATE });
  assert.equal(relay.shell(), "attached");

  const switching = relay.switch({ session: SESSION, to: "tui", key: "s1" });
  assert.equal(sent.length, 1);
  peer.closed();
  link.shutdown();
  const switched = await switching;
  assert.equal(!switched.ok && switched.error.code, "unavailable");
  assert.equal(relay.shell(), "absent");
  // 유예 동안 사본은 남아도 host가 없으니 입력은 쌓이지 않고 바로 실패한다.
  const input = await relay.send(send("k1"));
  assert.equal(!input.ok && input.error.code, "unavailable");

  // 유예가 지나면 session lifecycle wiring이 비운다. 사본이 없는 session의 `acp/send`는 ledger 길로 가 not_found다.
  relay.clear();
  assert.deepEqual(relay.list(), []);
  assert.equal(relay.has(SESSION), false);
  assert.equal(relay.terminalKnown(TERMINAL), false);
  const gone = await relay.send(send("k2"));
  assert.equal(!gone.ok && gone.error.code, "not_found");
});
