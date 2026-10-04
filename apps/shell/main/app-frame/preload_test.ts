import assert from "node:assert/strict";
import { test } from "node:test";
import { createShellApi } from "../../preload/shell-api.ts";
import type { OverlayEvent } from "../../ipc/overlay.ts";

test("shell/app-frame#R24: preload exposes only fixed overlay operations and strips Electron event with unsubscribe", async () => {
  const calls: [string, unknown][] = [];
  const listeners = new Map<
    string,
    (event: unknown, payload: OverlayEvent) => void
  >();
  const api = createShellApi({
    invoke(channel, input) {
      calls.push([channel, input]);
      return Promise.resolve({ ok: true, value: null });
    },
    on(channel, callback) {
      listeners.set(channel, callback);
    },
    removeListener(channel, callback) {
      assert(listeners.get(channel) === callback);
      listeners.delete(channel);
    },
  }, "shell");
  assert.deepEqual(Object.keys(api), ["open", "close", "result", "subscribe"]);
  assert(Object.isFrozen(api));
  const received: OverlayEvent[] = [];
  const release = api.subscribe((payload) => received.push(payload), () => {});
  const payload = {
    requestId: "request",
    surfaceId: "surface",
    generation: 1,
    type: "closed" as const,
  };
  listeners.get("shell:overlay-result")!(
    { sender: "secret-electron-event" },
    payload,
  );
  assert.deepEqual(received, [payload]);
  await api.close({ surfaceId: "surface", generation: 1 });
  await api.result({ surfaceId: "surface", generation: 1, type: "closed" });
  assert.deepEqual(calls.map(([channel]) => channel), [
    "shell:overlay-close",
    "overlay:result",
  ]);
  release();
  assert.equal(listeners.size, 0);
});

test("shell/app-frame#R24: preload normalizes transport throw reject and observes overlay ready failure only while subscribed", async () => {
  const errors: unknown[] = [];
  let reject: (error: Error) => void = () => {};
  const transport = {
    invoke: () => Promise.reject(new Error("raw credential secret")),
    on() {},
    removeListener() {},
  };
  const api = createShellApi(transport, "overlay");
  for (
    const result of [
      await api.open({
        requestId: "r",
        kind: "menu",
        anchorRect: { x: 0, y: 0, width: 1, height: 1 },
        model: { label: "x", choices: [] },
      }),
      await api.close({ surfaceId: "s", generation: 1 }),
      await api.result({ surfaceId: "s", generation: 1, type: "closed" }),
    ]
  ) {
    assert.equal(result.ok, false);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
  const release = api.subscribe(() => {}, (error) => errors.push(error));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1);
  release();
  const late = createShellApi({
    ...transport,
    invoke: () =>
      new Promise((_resolve, no) => {
        reject = no;
      }),
  }, "overlay");
  const stop = late.subscribe(() => {}, (error) => errors.push(error));
  stop();
  reject(new Error("secret"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 1);
  const sync = createShellApi({
    ...transport,
    invoke() {
      throw new Error("secret");
    },
  }, "shell");
  assert.equal((await sync.close({ surfaceId: "s", generation: 1 })).ok, false);
  const denied = createShellApi({
    ...transport,
    invoke: () =>
      Promise.resolve({
        ok: false,
        error: { code: "forbidden", message: "not ready" },
      }),
  }, "overlay");
  const end = denied.subscribe(() => {}, (error) => errors.push(error));
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(errors.length, 2);
  end();
});
