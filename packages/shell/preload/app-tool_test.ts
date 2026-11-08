import assert from "node:assert/strict";
import { test } from "node:test";
import { APP_KEEP_ALIVE_CHANNEL } from "../ipc/app-keep-alive.ts";
import { APP_KEYS_CHANNEL, APP_KEYS_FORWARD_CHANNEL } from "../ipc/app-keys.ts";
import { createAppKeys, createAppTool } from "./app-tool.ts";

// 앱 코드의 useKeepAlive와 @lophn/agent의 자동 신호가 서로 끄지 않아야 page가 기다리던 답이 살아 있다.
test("keep-alive stays on while any key is active", () => {
  const sent: boolean[] = [];
  const app = createAppTool(
    {
      invoke: async () => undefined,
      send: () => {},
      sendToHost: (channel, input) => {
        if (channel === APP_KEEP_ALIVE_CHANNEL) sent.push(input as boolean);
      },
      on: () => {},
    },
    "",
  );
  app.setKeepAlive(true, "agent");
  app.setKeepAlive(true, "app");
  app.setKeepAlive(false, "app");
  assert.equal(sent.at(-1), true);
  app.setKeepAlive(false, "agent");
  assert.equal(sent.at(-1), false);
});

// 앱 key가 맞고 handler가 참이면 돌고 삼킨다. 거짓이면 삼키지 않고, shell key는 host로 넘긴다.
test("an app key runs and is swallowed while when is true; when false the key is not swallowed and a shell key is forwarded", () => {
  const listeners = new Map<string, (payload: unknown) => void>();
  const sent: [string, unknown][] = [];
  const keys = createAppKeys({
    on: (channel, listener) => void listeners.set(channel, listener),
    sendToHost: (channel, input) => void sent.push([channel, input]),
  });
  listeners.get(APP_KEYS_CHANNEL)!({
    keys: { save: ["Ctrl+KeyS"] },
    forward: ["Ctrl+KeyP"],
  });
  const press = (code: string): boolean => {
    let prevented = false;
    keys.handle({
      key: code.slice(3).toLowerCase(),
      code,
      ctrlKey: true,
      metaKey: false,
      altKey: false,
      shiftKey: false,
      repeat: false,
      isComposing: false,
      preventDefault: () => void (prevented = true),
      stopPropagation: () => {},
    });
    return prevented;
  };
  let ran = 0;
  let open = true;
  keys.commands.register(
    "save",
    () => void (ran += 1),
    () => open,
  );
  assert.equal(press("KeyS"), true);
  assert.equal(ran, 1);
  open = false;
  assert.equal(press("KeyS"), false);
  assert.equal(ran, 1);
  assert.equal(press("KeyP"), true);
  assert.deepEqual(sent, [[APP_KEYS_FORWARD_CHANNEL, "Ctrl+KeyP"]]);
});
