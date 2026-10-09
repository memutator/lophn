import assert from "node:assert/strict";
import { test } from "node:test";

import {
  CORE_CALL_CHANNEL,
  CORE_STATE_GET_CHANNEL,
} from "../../../ipc/core.ts";
import { type CoreProcess } from "./supervise.ts";
import { startCoreConnection } from "./connection.ts";

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness(hello: Promise<unknown>) {
  const handlers = new Map<
    string,
    (event: unknown, input: unknown) => Promise<unknown>
  >();
  const pushes: unknown[] = [];
  const core = {
    phase: "starting",
    hello,
    onMessage: () => () => {},
    stop() {},
    diagnostic: () => false,
    confirmation: () => false,
    ended() {},
  } as unknown as CoreProcess;
  const connection = startCoreConnection({
    launch: {} as never,
    ipc: {
      handle: (channel, listener) => void handlers.set(channel, listener),
    },
    // 구독 따라잡기 read는 끝나지 않는다. 상태는 ready에 머문다.
    fetch: () => new Promise(() => {}),
    sockets: { open: () => assert.fail("socket is not opened") },
    clock: { now: () => 5000 },
    targets: () => [{
      send: (_channel, payload) => pushes.push(payload),
      isDestroyed: () => false,
    }],
    start: () => core,
  });
  const ask = () => handlers.get(CORE_STATE_GET_CHANNEL)!({}, undefined);
  return { connection, ask, pushes };
}

test("shell/desktop#R7: core가 이미 ready인 뒤 새로 구독하는 renderer에게 main은 지금 상태를 돌려준다", async () => {
  const hello = Promise.resolve(
    { api_port: 1, core_epoch: "epoch", user_token: "token" },
  );
  const { ask, pushes } = harness(hello);
  // 준비 전에 물으면 starting이다.
  assert.deepEqual(await ask(), { state: "starting", confirmedAt: null });
  await settle();
  // ready를 민 창은 이미 지나갔다. 런처로 돌아와 새로 구독해도 같은 상태를 받는다.
  assert.deepEqual(pushes, [{ state: "ready", confirmedAt: null }]);
  assert.deepEqual(await ask(), { state: "ready", confirmedAt: null });
  assert.deepEqual(await ask(), { state: "ready", confirmedAt: null });
});

test("shell/desktop#R7: 시작에 실패한 core도 새 구독자에게 실패로 돌려준다", async () => {
  const { ask } = harness(Promise.reject(new Error("no hello")));
  await settle();
  assert.deepEqual(await ask(), { state: "failed-start", confirmedAt: null });
});

test("platform/backup-and-migration#R13: 복원 뒤 core가 같은 pipe로 보낸 새 hello(type 없는 main hello)로 session을 다시 연다", async () => {
  const handlers = new Map<
    string,
    (event: unknown, input: unknown) => Promise<unknown>
  >();
  const listeners: ((payload: unknown) => void)[] = [];
  const urls: string[] = [];
  const core = {
    phase: "starting",
    hello: Promise.resolve(
      { api_port: 1111, core_epoch: "epoch-1", user_token: "token-1" },
    ),
    onMessage: (listener: (payload: unknown) => void) => {
      listeners.push(listener);
      return () => {};
    },
    stop() {},
    diagnostic: () => false,
    confirmation: () => false,
    ended() {},
  } as unknown as CoreProcess;
  startCoreConnection({
    launch: {} as never,
    ipc: {
      handle: (channel, listener) => void handlers.set(channel, listener),
    },
    fetch: ((url: string) => {
      urls.push(url);
      return new Promise(() => {});
    }) as never,
    sockets: { open: () => assert.fail("socket is not opened") },
    clock: { now: () => 5000 },
    targets: () => [],
    start: () => core,
  });
  await settle();
  // 새 core의 hello. 제품 frame처럼 type 필드가 없다.
  for (const listener of listeners) {
    listener({ api_port: 2222, core_epoch: "epoch-2", user_token: "token-2" });
  }
  urls.length = 0;
  void handlers.get(CORE_CALL_CHANNEL)!({}, {
    kind: "read",
    resource: "projects",
    method: "list",
    body: {},
  });
  await settle();
  assert.ok(urls.length > 0, "새 session으로 부르지 않았다");
  assert.ok(urls.every((url) => url.startsWith("http://127.0.0.1:2222/")));
});
