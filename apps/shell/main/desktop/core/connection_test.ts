import assert from "node:assert/strict";
import { test } from "node:test";

import { CORE_STATE_GET_CHANNEL } from "../../../ipc/core.ts";
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
