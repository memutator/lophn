import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DESKTOP_INTENT_CHANNEL,
  type DesktopIntent,
  WINDOW_SHORTCUT_CHANNEL,
} from "../../ipc/shortcuts.ts";
import {
  createIntentApi,
  createShortcutApi,
} from "../../preload/shortcut-api.ts";

test("shell/desktop#R18: preload는 창 shortcut 이름만 shell renderer에 넘기고 Electron event와 모르는 값은 버린다", () => {
  const listeners = new Map<
    string,
    (event: unknown, payload: unknown) => void
  >();
  const api = createShortcutApi({
    on: (channel, callback) => void listeners.set(channel, callback),
    removeListener: (channel, callback) => {
      assert.equal(listeners.get(channel), callback);
      listeners.delete(channel);
    },
  });
  assert.deepEqual(Object.keys(api), ["subscribe"]);
  assert.ok(Object.isFrozen(api));
  const received: unknown[] = [];
  const release = api.subscribe((shortcut) => received.push(shortcut));
  const deliver = listeners.get(WINDOW_SHORTCUT_CHANNEL)!;
  deliver({ sender: "electron-event" }, "palette");
  deliver({}, "launcher");
  deliver({}, "global-palette");
  deliver({}, { shortcut: "palette" });
  deliver({}, "toString");
  assert.deepEqual(received, ["palette", "launcher"]);
  release();
  assert.equal(listeners.size, 0);
});

test("shell/desktop#R18: main이 시키는 것은 표에 있는 이름만 넘기고 구독 전에 온 마지막 하나를 첫 구독에 넘긴다", () => {
  const listeners = new Map<
    string,
    (event: unknown, payload: unknown) => void
  >();
  const api = createIntentApi({
    on: (channel, callback) => void listeners.set(channel, callback),
    removeListener: () => assert.fail("preload keeps listening"),
  });
  assert.deepEqual(Object.keys(api), ["subscribe"]);
  assert.ok(Object.isFrozen(api));
  const deliver = listeners.get(DESKTOP_INTENT_CHANNEL)!;
  // 막 연 창: renderer가 구독하기 전에 온다.
  deliver({}, "palette");
  deliver({}, "global-palette");
  const received: DesktopIntent[] = [];
  const release = api.subscribe((intent) => received.push(intent));
  assert.deepEqual(received, ["global-palette"]);
  deliver({ sender: "electron-event" }, "things-to-confirm");
  deliver({}, { intent: "global-palette" });
  deliver({}, "launcher");
  assert.deepEqual(received, ["global-palette", "things-to-confirm"]);
  release();
  deliver({}, "things-to-confirm");
  assert.equal(received.length, 2);
  // 창 shortcut channel로는 전역 팔레트가 오지 않는다.
  assert.notEqual(DESKTOP_INTENT_CHANNEL, WINDOW_SHORTCUT_CHANNEL);
});
