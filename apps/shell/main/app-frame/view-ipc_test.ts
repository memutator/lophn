import assert from "node:assert/strict";
import { test } from "node:test";

import { createViewsApi } from "../../preload/views-api.ts";
import {
  type CallerContents,
  type CallerFrame,
  ContentsRegistry,
  type IpcEvent,
} from "../desktop/ipc-guard.ts";
import type { CoreCaller } from "./app-connection.ts";
import { createViewClosedRelay } from "./view-closed.ts";
import { createViewIpc, registerViewIpc, removeViewIpc } from "./view-ipc.ts";

const APP = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const REL = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";

function contents(id: number, url: string): CallerContents {
  const main: CallerFrame = { url, parent: null };
  return { id, isDestroyed: () => false, mainFrame: main };
}

const desk = contents(1, "lophn-shell://desktop/index.html");
const overlay = contents(2, "lophn-shell://overlay/index.html");
const app = contents(3, `lophn-app://app-${APP.slice(4)}/main/index.html`);

function world() {
  const registry = new ContentsRegistry();
  registry.register({
    contents: desk,
    origin: { scheme: "lophn-shell", host: "desktop", path: "/index.html" },
  });
  registry.register({
    contents: overlay,
    origin: { scheme: "lophn-shell", host: "overlay", path: "/index.html" },
  });
  const calls: unknown[][] = [];
  const handlers = createViewIpc({
    registry,
    windowOf: (sender) => sender === desk ? "window-1" : undefined,
    visibility: {
      openApp(window, input) {
        calls.push(["open", window, input]);
        return Promise.resolve({
          ok: true,
          value: {
            view_session: "view-1",
            app: input.app,
            release: input.release ?? null,
            mode: input.mode,
            screen: input.screen,
            size: input.size,
            connectionState: "running",
          },
        });
      },
      setBounds(window, view, bounds) {
        calls.push(["bounds", window, view, bounds]);
        return Promise.resolve({ ok: true, value: { generation: 2 } });
      },
      hide(window, views) {
        calls.push(["hide", window, views]);
        return { ok: true, value: { generation: 3 } };
      },
      close(window, view) {
        calls.push(["close", window, view]);
        return { ok: true, value: null };
      },
    },
  });
  return { handlers, calls };
}

const event = (sender: CallerContents): IpcEvent => ({
  sender,
  senderFrame: sender.mainFrame,
});

const OPEN = {
  app: APP,
  mode: "live",
  release: REL,
  screen: "main",
  size: "panel",
};

test("shell/app-frame#R23, shell/app-frame#R12: 앱 view IPC는 desktop 창 main frame만 받고 창은 sender에서 정하며 모르는 field를 거절한다", async () => {
  const w = world();
  assert.equal((await w.handlers.openApp(event(desk), OPEN)).ok, true);
  for (const sender of [overlay, app]) {
    const denied = await w.handlers.openApp(event(sender), OPEN);
    assert.deepEqual(denied.ok ? "" : denied.error.code, "forbidden");
  }
  const sub = await w.handlers.setBounds(
    { sender: desk, senderFrame: { url: desk.mainFrame!.url, parent: null } },
    { view_session: "view-1", bounds: { x: 0, y: 0, width: 1, height: 1 } },
  );
  assert.equal(sub.ok, false);
  for (
    const bad of [
      { ...OPEN, parentWindow: "window-2" },
      { ...OPEN, bounds: { x: 0, y: 0, width: 1, height: 1 } },
      { ...OPEN, actor: "user" },
    ]
  ) {
    const rejected = await w.handlers.openApp(event(desk), bad);
    assert.deepEqual(rejected.ok ? "" : rejected.error.code, "invalid_input");
  }
  assert.deepEqual(
    (await w.handlers.setBounds(event(desk), {
      view_session: "view-1",
      bounds: { x: 0, y: 0, width: 1.5, height: 1 },
    })).ok,
    false,
  );
  assert.deepEqual(
    (await w.handlers.setHidden(event(desk), { view_sessions: [] })).ok,
    false,
  );
  await w.handlers.setBounds(event(desk), {
    view_session: "view-1",
    bounds: { x: 0, y: 40, width: 640, height: 600 },
  });
  await w.handlers.setHidden(event(desk), { view_sessions: ["view-1"] });
  await w.handlers.close(event(desk), { view_session: "view-1" });
  assert.deepEqual(w.calls, [
    ["open", "window-1", OPEN],
    ["bounds", "window-1", "view-1", { x: 0, y: 40, width: 640, height: 600 }],
    ["hide", "window-1", ["view-1"]],
    ["close", "window-1", "view-1"],
  ]);
});

test("shell/app-frame#R23: shell preload의 view 통로는 고정 channel만 쓰고 거절은 code만 싣는다", async () => {
  const w = world();
  const handlers = new Map<
    string,
    (event: IpcEvent, input: unknown) => Promise<unknown>
  >();
  const ipc = {
    handle: (
      channel: string,
      listener: (event: IpcEvent, input: unknown) => Promise<unknown>,
    ) => void handlers.set(channel, listener),
    removeHandler: (channel: string) => void handlers.delete(channel),
  };
  registerViewIpc(ipc, w.handlers);
  const listeners = new Map<
    string,
    (event: unknown, payload: unknown) => void
  >();
  let sender = desk;
  const api = createViewsApi({
    invoke: (channel, input) => handlers.get(channel)!(event(sender), input),
    on: (channel, callback) => void listeners.set(channel, callback),
    removeListener: (channel) => void listeners.delete(channel),
  });
  assert.deepEqual(Object.keys(api), [
    "openApp",
    "setViewBounds",
    "setViewsHidden",
    "closeView",
    "subscribeViewState",
  ]);
  assert(Object.isFrozen(api));
  const state = await api.openApp(OPEN as Parameters<typeof api.openApp>[0]);
  assert.equal(state.view_session, "view-1");
  assert.deepEqual(
    await api.setViewBounds({
      view_session: "view-1",
      bounds: { x: 0, y: 40, width: 1, height: 1 },
    }),
    { generation: 2 },
  );
  assert.deepEqual(await api.setViewsHidden({ view_sessions: ["view-1"] }), {
    generation: 3,
  });
  await api.closeView({ view_session: "view-1" });
  sender = overlay;
  await assert.rejects(
    api.closeView({ view_session: "view-1" }),
    (error: Error) => error.message === "forbidden",
  );
  // push는 schema에 맞는 상태만 넘긴다.
  const seen: unknown[] = [];
  const stop = api.subscribeViewState((pushed) => seen.push(pushed));
  const push = listeners.get("shell:view-state")!;
  push({}, { ...state, connectionState: "unavailable" });
  push({}, { ...state, connectionState: "paused" });
  push({}, { ...state, mode: "live", release: null });
  // 모르는 field는 넘기지 않는다.
  push({}, { ...state, token: "secret" });
  assert.deepEqual(seen, [{ ...state, connectionState: "unavailable" }, state]);
  stop();
  assert.equal(listeners.has("shell:view-state"), false);
  removeViewIpc(ipc);
  assert.equal(handlers.size, 0);
});

test("apps/agent-context#R2, apps/agent-context#R5: 닫힌 live view는 core 앱 통로로 그 앱에 알리고 닿지 못하면 남긴다", async () => {
  const calls: unknown[][] = [];
  let reply: Awaited<ReturnType<CoreCaller>> = {
    ok: true,
    value: { relayed: true },
  };
  const logs: string[] = [];
  const relay = createViewClosedRelay({
    call(kind, resource, method, body) {
      calls.push([kind, resource, method, body]);
      return Promise.resolve(reply);
    },
    log: (line) => logs.push(line),
  });
  const closed = {
    app: APP,
    mode: "live" as const,
    release: REL,
    view_session: "view-1",
  };
  await relay(closed);
  // preview는 live supervisor 밖이다.
  await relay({ ...closed, mode: "preview", release: null });
  assert.deepEqual(calls, [[
    "memory",
    "apps",
    "view_closed",
    { app: APP, view_session: "view-1" },
  ]]);
  assert.deepEqual(logs, []);
  reply = { ok: false, error: { code: "unavailable", message: "x" } };
  await relay(closed);
  assert.deepEqual(logs, [
    `view-closed not relayed view-1 app=${APP} code=unavailable`,
  ]);
});
