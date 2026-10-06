import assert from "node:assert/strict";
import { test } from "node:test";

import {
  APP_CALL_CHANNEL,
  APP_OPEN_EXTERNAL_CHANNEL,
  APP_VIEW_ERROR_CHANNEL,
} from "../../ipc/app.ts";
import type { CallerFrame } from "../desktop/ipc-guard.ts";
import { registerAppIpc, removeAppIpc } from "./app-ipc.ts";
import type { BoundView } from "./registry.ts";

const APP = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const LABEL = "app-01j9zzzzzzzzzzzzzzzzzzzzzz";
const OTHER_LABEL = "app-01j9yyyyyyyyyyyyyyyyyyyyyy";

const VIEW: BoundView = {
  view_session: "view-1",
  generation: 1,
  target: {
    app: APP,
    mode: "live",
    release: null,
    screen: "main",
    size: "full",
  },
  binding: {
    endpoint: "/run/app.sock",
    authorization: "signed",
    release: null,
    bundleHash: "1".repeat(64),
    processNonce: "nonce-1",
    expiresAtMs: null,
  },
};

function event(
  id: number,
  url: string,
  options: { sub?: boolean; destroyed?: boolean } = {},
) {
  const main: CallerFrame = { parent: null, url };
  const frame: CallerFrame = options.sub ? { parent: main, url } : main;
  return {
    sender: {
      id,
      isDestroyed: () => options.destroyed === true,
      mainFrame: main,
    },
    senderFrame: frame,
  };
}

function world() {
  const handlers = new Map<
    string,
    (event: unknown, input: unknown) => Promise<unknown>
  >();
  const listeners = new Map<string, (event: unknown, input: unknown) => void>();
  const seen: { kind: string; view: BoundView; input: unknown }[] = [];
  const ipc = {
    handle(
      channel: string,
      listener: (event: unknown, input: unknown) => Promise<unknown>,
    ) {
      handlers.set(channel, listener);
    },
    on(channel: string, listener: (event: unknown, input: unknown) => void) {
      listeners.set(channel, listener);
    },
    removeHandler(channel: string) {
      handlers.delete(channel);
    },
    removeAllListeners(channel: string) {
      listeners.delete(channel);
    },
  };
  registerAppIpc(ipc, {
    view: (id) => id === 7 ? VIEW : undefined,
    call(view, input) {
      seen.push({ kind: "call", view, input });
      return Promise.resolve({ ok: true, value: "called" });
    },
    openExternal(view, input) {
      seen.push({ kind: "external", view, input });
      return Promise.resolve({ ok: true, value: null });
    },
    viewError(view, input) {
      seen.push({ kind: "error", view, input });
      return Promise.resolve();
    },
  });
  return { ipc, handlers, listeners, seen };
}

const OWN = `lophn-app://${LABEL}/main/index.html`;

test("shell/app-frame#R12, shell/app-frame#R13: 앱 IPC 신원은 살아 있는 앱 view의 main frame과 자기 screen 주소에서만 정한다", async () => {
  const w = world();
  assert.deepEqual([...w.handlers.keys()], [
    APP_CALL_CHANNEL,
    APP_OPEN_EXTERNAL_CHANNEL,
  ]);
  assert.deepEqual([...w.listeners.keys()], [APP_VIEW_ERROR_CHANNEL]);
  const call = w.handlers.get(APP_CALL_CHANNEL)!;
  const input = { command: "usage.list", input: {} };
  assert.deepEqual(await call(event(7, OWN), input), {
    ok: true,
    value: "called",
  });
  assert.equal(w.seen[0]!.view, VIEW);
  const denied = {
    ok: false,
    error: { code: "forbidden", message: "sender is not an app view" },
  };
  for (
    const bad of [
      event(8, OWN),
      event(7, OWN, { sub: true }),
      event(7, OWN, { destroyed: true }),
      event(7, `lophn-app://${OTHER_LABEL}/main/index.html`),
      event(7, `lophn-app://${LABEL}/settings/index.html`),
      event(7, "lophn-shell://desktop/index.html"),
      event(7, "https://example.com/main/index.html"),
      {},
      null,
    ]
  ) {
    assert.deepEqual(await call(bad, input), denied);
    assert.deepEqual(
      await w.handlers.get(APP_OPEN_EXTERNAL_CHANNEL)!(bad, {
        url: "https://example.com/",
      }),
      denied,
    );
    w.listeners.get(APP_VIEW_ERROR_CHANNEL)!(bad, {
      observation: "error",
      name: "Error",
      message: null,
    });
  }
  assert.equal(w.seen.length, 1);
  await w.handlers.get(APP_OPEN_EXTERNAL_CHANNEL)!(event(7, OWN), {
    url: "https://example.com/",
  });
  w.listeners.get(APP_VIEW_ERROR_CHANNEL)!(event(7, OWN), {
    observation: "error",
    name: "Error",
    message: null,
  });
  assert.deepEqual(w.seen.map((item) => item.kind), [
    "call",
    "external",
    "error",
  ]);
  removeAppIpc(w.ipc);
  assert.equal(w.handlers.size, 0);
  assert.equal(w.listeners.size, 0);
});
