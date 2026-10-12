import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ConnectionState,
  CORE_STATE_CHANNEL,
  CORE_STATE_GET_CHANNEL,
} from "../../ipc/core.ts";
import { type CoreTransport, createCoreApi } from "../../preload/core-api.ts";

type Callback = (event: unknown, payload: unknown) => void;

const READY: ConnectionState = { state: "ready", confirmedAt: 1000 };

function transport(current: () => Promise<unknown>) {
  const listeners = new Map<string, Callback>();
  const asked: string[] = [];
  const fake: CoreTransport = {
    on: (channel, callback) => void listeners.set(channel, callback),
    removeListener: (channel, callback) => {
      assert.equal(listeners.get(channel), callback);
      listeners.delete(channel);
    },
    invoke: (channel) => {
      asked.push(channel);
      return current();
    },
  };
  return { fake, listeners, asked };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test("shell/desktop#R7: 런처로 돌아와 새로 구독해도 main이 이미 ready라면 push를 기다리지 않고 지금 상태를 바로 받는다", async () => {
  // main은 창의 did-finish-load에서 이미 한 번 밀었고 이후 바뀐 것이 없다. 새 구독자에게는 push가 오지 않는다.
  const t = transport(() => Promise.resolve(READY));
  const api = createCoreApi(t.fake);
  const received: ConnectionState[] = [];
  api.subscribe((state) => received.push(state));
  await settle();
  assert.deepEqual(t.asked, [CORE_STATE_GET_CHANNEL]);
  assert.deepEqual(received, [READY]);
  // 두 번째로 구독(다시 마운트)해도 같다.
  const again: ConnectionState[] = [];
  createCoreApi(transport(() => Promise.resolve(READY)).fake).subscribe((
    state,
  ) => again.push(state));
  await settle();
  assert.deepEqual(again, [READY]);
});

test("shell/desktop#R7: 지금 상태 답보다 main이 먼저 민 상태가 새롭고 해제한 구독에는 답을 넘기지 않는다", async () => {
  let answer!: (value: unknown) => void;
  const t = transport(() => new Promise((resolve) => (answer = resolve)));
  const api = createCoreApi(t.fake);
  const received: ConnectionState[] = [];
  const release = api.subscribe((state) => received.push(state));
  const stale: ConnectionState = { state: "stale", confirmedAt: 2000 };
  t.listeners.get(CORE_STATE_CHANNEL)!({}, stale);
  answer(READY);
  await settle();
  assert.deepEqual(received, [stale]);

  const second = transport(() => new Promise((resolve) => (answer = resolve)));
  const later: ConnectionState[] = [];
  const off = createCoreApi(second.fake).subscribe((state) =>
    later.push(state)
  );
  off();
  answer(READY);
  await settle();
  assert.deepEqual(later, []);
  assert.equal(second.listeners.size, 0);
  release();
});

test("shell/desktop#R7: 지금 상태를 못 받거나 모양이 틀리면 구독은 starting 그대로 두고 이후 push를 따른다", async () => {
  const replies = [
    () => Promise.reject(new Error("no")),
    () => Promise.resolve({ state: "bogus" }),
  ];
  for (const reply of replies) {
    const t = transport(reply);
    const received: ConnectionState[] = [];
    createCoreApi(t.fake).subscribe((state) => received.push(state));
    await settle();
    assert.deepEqual(received, []);
    t.listeners.get(CORE_STATE_CHANNEL)!({}, READY);
    assert.deepEqual(received, [READY]);
  }
});
