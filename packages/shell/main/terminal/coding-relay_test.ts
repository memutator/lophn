import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type AcpInput,
  type AcpState,
  type AcpUpdate,
  EMPTY_ACP_STATE,
} from "../../../protocol/acp/mod.ts";
import {
  type CodingFrame,
  type CodingOutput,
  createCodingRelay,
} from "./coding-relay.ts";
import type { TabHandle } from "./gui.ts";

const ULID = `01${"a".repeat(24)}`;
const TERMINAL = `trm_${ULID}`;
const SESSION = `ses_${ULID}`;
const AT = "2026-11-15T00:00:00.000Z";

function setup() {
  const timers: (() => void)[] = [];
  const frames: CodingFrame[] = [];
  const opens: (() => void)[] = [];
  const requests = new Map<
    string,
    (payload: unknown) => Promise<CodingOutput>
  >();
  const given: { handle: string; input: AcpInput }[] = [];
  let onHandle: ((handle: TabHandle) => void) | undefined;
  let connected = true;
  createCodingRelay({
    gui: {
      onHandle(listener) {
        onHandle = listener;
        return () => {};
      },
      input(handle, input) {
        given.push({ handle, input });
        return true;
      },
      toggle: () => Promise.resolve({ ok: true }),
      current: () => null,
      toolBody: () => null,
      uploadImage: () => Promise.resolve(null),
      readImage: () => Promise.resolve(null),
    },
    link: {
      // 연결이 없으면 보내지 못하고 아무것도 쌓지 않는다.
      send(frame) {
        if (connected) frames.push(frame);
        return connected;
      },
      onOpen: (handler) => void opens.push(handler),
      onInput: (handler) => void requests.set("coding_input", handler as never),
      onSwitch: (handler) =>
        void requests.set("coding_switch", handler as never),
      onBody: () => {},
      onImageWrite: () => {},
      onImageRead: () => {},
    },
    after(_ms, run) {
      timers.push(run);
      return () => {
        const at = timers.indexOf(run);
        if (at >= 0) timers.splice(at, 1);
      };
    },
    alive: () => true,
    platform: "linux",
  });
  return {
    frames,
    given,
    requests,
    open(handle: TabHandle) {
      onHandle?.(handle);
    },
    flush() {
      for (const run of timers.splice(0)) run();
    },
    link(up: boolean) {
      connected = up;
      if (up) for (const handler of opens) handler();
    },
  };
}

function fakeHandle() {
  let state: AcpState = EMPTY_ACP_STATE;
  const listeners = new Set<Parameters<TabHandle["attach"]>[0]>();
  const handle: TabHandle = {
    id: "win_1",
    terminal: TERMINAL,
    harness: "claude",
    handoff: "restart",
    cwd: "/work",
    state: () => state,
    attach(listener) {
      listener.snapshot(state);
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    input: () => {},
    close() {
      for (const listener of [...listeners]) listener.closed();
    },
  };
  return {
    handle,
    publish(update: AcpUpdate) {
      state = { ...state, seq: state.seq + 1 };
      for (const listener of listeners) listener.update(update);
    },
  };
}

const started = (n: number): AcpUpdate => ({
  type: "turn_started",
  turn: `trn_01${String(n).repeat(24)}`,
  at: AT,
});

// core는 snapshot 위에 updates를 접는다. snapshot보다 먼저 온 update나 끊긴 사이 빠진 update가 있으면 폰의 대화가 desktop과 갈라진다.
test("handle은 snapshot부터 올라가고, 끊긴 사이는 쌓지 않고 다시 열리면 snapshot부터 다시 가며, 닫히면 coding_closed다", () => {
  const t = setup();
  const fake = fakeHandle();
  t.open(fake.handle);
  fake.publish(started(1));
  fake.publish(started(2));
  t.flush();
  assert.deepEqual(t.frames.splice(0), [
    { type: "coding_sync", session: SESSION, snapshot: EMPTY_ACP_STATE },
    {
      type: "coding_sync",
      session: SESSION,
      updates: [started(1), started(2)],
    },
  ]);

  t.link(false);
  fake.publish(started(3));
  t.flush();
  t.link(true);
  t.flush();
  assert.deepEqual(t.frames.splice(0), [
    {
      type: "coding_sync",
      session: SESSION,
      snapshot: { ...EMPTY_ACP_STATE, seq: 3 },
    },
  ]);

  fake.publish(started(4));
  fake.handle.close();
  t.flush();
  assert.deepEqual(t.frames.splice(0), [
    { type: "coding_closed", session: SESSION },
  ]);
});

// 폰의 입력은 사람의 CLI session에 그대로 들어간다. 다른 탭이나 틀린 모양의 입력이 handle에 닿으면 안 된다.
test("coding_input은 ACP 입력으로 읽어 그 session의 handle에 넘기고, 틀린 입력은 invalid_input, handle이 없으면 not_found다", async () => {
  const t = setup();
  t.open(fakeHandle().handle);
  const input = t.requests.get("coding_input")!;
  const stop: AcpInput = {
    type: "stop",
    session: SESSION,
    turn: `trn_01${"b".repeat(24)}`,
    key: "k1",
  };

  assert.deepEqual(await input({ session: SESSION, input: stop }), {
    content: [{ type: "text", text: "ok" }],
  });
  assert.deepEqual(t.given, [{ handle: "win_1", input: stop }]);

  const bad = await input({ session: SESSION, input: { type: "stop" } });
  assert.equal(
    bad !== null && "error" in bad && bad.error.code,
    "invalid_input",
  );
  const other = await input({
    session: `ses_01${"z".repeat(24)}`,
    input: { ...stop, session: `ses_01${"z".repeat(24)}` },
  });
  assert.equal(
    other !== null && "error" in other && other.error.code,
    "not_found",
  );
  assert.equal(t.given.length, 1);
});
