import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import { createAppApi, installViewErrors } from "../../preload/app-api.ts";
import {
  APP_CALL_CHANNEL,
  APP_OPEN_EXTERNAL_CHANNEL,
  APP_VIEW_ERROR_CHANNEL,
} from "../../ipc/app.ts";

function transport(reply: (channel: string, input: unknown) => unknown) {
  const invoked: [string, unknown][] = [];
  const sent: [string, unknown][] = [];
  return {
    invoked,
    sent,
    invoke(channel: string, input: unknown) {
      invoked.push([channel, input]);
      try {
        return Promise.resolve(reply(channel, input));
      } catch (error) {
        return Promise.reject(error);
      }
    },
    send(channel: string, input: unknown) {
      sent.push([channel, input]);
    },
  };
}

test("shell/app-frame#R15, shell/app-frame#R13: 앱 preload는 lophnApp.call과 openExternal만 공개하고 command·입력·URL 말고는 보내지 않는다", async () => {
  const t = transport(() => ({ ok: true, value: { result: { result: 1 } } }));
  const api = createAppApi(t);
  assert.deepEqual(Object.keys(api), ["call", "openExternal"]);
  assert.ok(Object.isFrozen(api));
  assert.deepEqual(await api.call("usage.list", { limit: 1 }), {
    result: { result: 1 },
  });
  assert.equal(await api.openExternal("https://example.com/"), undefined);
  assert.deepEqual(t.invoked, [
    [APP_CALL_CHANNEL, { command: "usage.list", input: { limit: 1 } }],
    [APP_OPEN_EXTERNAL_CHANNEL, { url: "https://example.com/" }],
  ]);
  // 설치 preload에는 별도 query·다른 앱·shell API·token·임의 IPC 통로가 없다.
  const source = await readFile(
    new URL("../../preload/app.ts", import.meta.url),
    "utf8",
  );
  const exposed = [...source.matchAll(/exposeInMainWorld\(\s*"(\w+)"/g)].map((
    match,
  ) => match[1]);
  assert.deepEqual(exposed, ["lophnApp"]);
  const bridge = await readFile(
    new URL("../../preload/app-api.ts", import.meta.url),
    "utf8",
  );
  const channels = [...bridge.matchAll(/(APP_\w+_CHANNEL)/g)].map((match) =>
    match[1]
  );
  assert.deepEqual([...new Set(channels)].sort(), [
    "APP_CALL_CHANNEL",
    "APP_OPEN_EXTERNAL_CHANNEL",
    "APP_VIEW_ERROR_CHANNEL",
  ]);
});

test("shell/app-frame#R13: 실패는 code와 main 문구로만 reject하고 transport 원문·token은 페이지에 넘기지 않는다", async () => {
  const denied = createAppApi(transport(() => ({
    ok: false,
    error: { code: "invalid_input", message: "command is not available" },
  })));
  await assert.rejects(
    denied.call("files.read", {}),
    { message: "invalid_input: command is not available" },
  );
  const broken = createAppApi(transport(() => {
    throw new Error("Bearer secret-token /run/app.sock");
  }));
  await assert.rejects(broken.call("usage.list", {}), (error: Error) => {
    assert.equal(error.message, "unavailable: app bridge is unavailable");
    return true;
  });
  await assert.rejects(
    createAppApi(transport(() => "raw")).openExternal("https://example.com/"),
    { message: "unavailable: app bridge is unavailable" },
  );
});

test("problems/reporting#R5: 설치 preload는 window error·unhandledrejection을 이름·message만 담아 view-error로 보내고 쏟아지면 멈춘다", () => {
  const listeners = new Map<string, (event: unknown) => void>();
  const t = transport(() => undefined);
  let now = 0;
  installViewErrors(
    {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
    },
    t,
    () => now,
  );
  listeners.get("error")!({
    message: "Uncaught TypeError: x",
    error: { name: "TypeError", message: "x", stack: "at secret.js:1" },
  });
  listeners.get("unhandledrejection")!({ reason: "plain text" });
  listeners.get("unhandledrejection")!({ reason: undefined });
  // 다른 world의 값을 읽다 throw해도 이름만 남긴다.
  listeners.get("error")!({
    message: "Script error.",
    get error() {
      throw new Error("blocked");
    },
  });
  assert.deepEqual(t.sent, [
    [APP_VIEW_ERROR_CHANNEL, {
      observation: "error",
      name: "TypeError",
      message: "x",
    }],
    [APP_VIEW_ERROR_CHANNEL, {
      observation: "unhandledrejection",
      name: "UnhandledRejection",
      message: "plain text",
    }],
    [APP_VIEW_ERROR_CHANNEL, {
      observation: "unhandledrejection",
      name: "UnhandledRejection",
      message: null,
    }],
    [APP_VIEW_ERROR_CHANNEL, {
      observation: "error",
      name: "Error",
      message: "Script error.",
    }],
  ]);
  for (let index = 0; index < 50; index++) {
    listeners.get("error")!({ message: "loop", error: null });
  }
  assert.equal(t.sent.length, 20);
  now = 60_000;
  listeners.get("error")!({ message: "later", error: null });
  assert.equal(t.sent.length, 21);
});
