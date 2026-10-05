import assert from "node:assert/strict";
import { test } from "node:test";

import { WINDOW_SHORTCUT_CHANNEL } from "../../ipc/shortcuts.ts";
import { createShortcutApi } from "../../preload/shortcut-api.ts";

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
