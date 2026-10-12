import assert from "node:assert/strict";
import { test } from "node:test";

import {
  type ControlledWindow,
  createWindowControl,
} from "./window-controls.ts";
import {
  type CallerContents,
  ContentsRegistry,
  type IpcEvent,
} from "./ipc-guard.ts";

function sender(id: number, url: string): CallerContents {
  return { id, isDestroyed: () => false, mainFrame: { url, parent: null } };
}

function eventOf(contents: CallerContents): IpcEvent {
  return { sender: contents, senderFrame: contents.mainFrame };
}

const desktop = sender(1, "lophn-shell://desktop/index.html");
const overlay = sender(2, "lophn-shell://overlay/index.html");

function registry(): ContentsRegistry {
  const table = new ContentsRegistry();
  table.register({
    contents: desktop,
    origin: { scheme: "lophn-shell", host: "desktop", path: "/index.html" },
  });
  table.register({
    contents: overlay,
    origin: { scheme: "lophn-shell", host: "overlay", path: "/index.html" },
  });
  return table;
}

function fakeWindow(): ControlledWindow & { calls: string[] } {
  let maximized = false;
  const calls: string[] = [];
  return {
    calls,
    minimize: () => void calls.push("minimize"),
    maximize: () => {
      maximized = true;
      calls.push("maximize");
    },
    unmaximize: () => {
      maximized = false;
      calls.push("unmaximize");
    },
    isMaximized: () => maximized,
    close: () => void calls.push("close"),
  };
}

test("shell/desktop#R23: 창 단추는 부른 desktop 창에 최소화·최대화 토글·닫기를 보낸다", () => {
  const window = fakeWindow();
  const control = createWindowControl({
    registry: registry(),
    windowOf: (event) => event.sender === desktop ? window : undefined,
  });
  const call = (action: string) => control(eventOf(desktop), { action });
  assert.deepEqual(call("state"), { ok: true, state: { maximized: false } });
  assert.deepEqual(call("minimize"), {
    ok: true,
    state: { maximized: false },
  });
  assert.deepEqual(call("toggle-maximize"), {
    ok: true,
    state: { maximized: true },
  });
  assert.deepEqual(call("toggle-maximize"), {
    ok: true,
    state: { maximized: false },
  });
  call("close");
  assert.deepEqual(window.calls, [
    "minimize",
    "maximize",
    "unmaximize",
    "close",
  ]);
});

test("shell/desktop#R23: overlay·모르는 sender와 모르는 동작은 창을 건드리지 않는다", () => {
  const window = fakeWindow();
  const control = createWindowControl({
    registry: registry(),
    windowOf: () => window,
  });
  assert.deepEqual(control(eventOf(overlay), { action: "close" }), {
    ok: false,
    code: "forbidden",
  });
  assert.deepEqual(
    control(eventOf(sender(9, "lophn-shell://desktop/index.html")), {
      action: "close",
    }),
    { ok: false, code: "forbidden" },
  );
  assert.deepEqual(control(eventOf(desktop), { action: "quit" }), {
    ok: false,
    code: "invalid_input",
  });
  assert.deepEqual(control(eventOf(desktop), { action: "close", id: 1 }), {
    ok: false,
    code: "invalid_input",
  });
  assert.deepEqual(window.calls, []);
});
