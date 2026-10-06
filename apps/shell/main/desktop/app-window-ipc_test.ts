import assert from "node:assert/strict";
import { test } from "node:test";

import {
  APP_SHORTCUT_ADD_CHANNEL,
  APP_WINDOW_OPEN_CHANNEL,
} from "../../ipc/app-window.ts";
import { createAppWindowsApi } from "../../preload/app-window-api.ts";
import type { CallResult } from "../app-frame/app-connection.ts";
import {
  type AppWindowIpcHandlers,
  createAppWindowIpc,
  registerAppWindowIpc,
  removeAppWindowIpc,
} from "./app-window-ipc.ts";
import {
  type CallerContents,
  type CallerFrame,
  ContentsRegistry,
  type IpcEvent,
} from "./ipc-guard.ts";
import {
  installOsEntry,
  type OsEntryEnv,
  removeOsEntry,
} from "./os-entry/entry.ts";

const APP = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const EXEC = "/opt/lophn/lophn-desktop";

function contents(id: number, url: string): CallerContents {
  const main: CallerFrame = { url, parent: null };
  return { id, isDestroyed: () => false, mainFrame: main };
}

const desk = contents(1, "lophn-shell://desktop/index.html");
const overlay = contents(2, "lophn-shell://overlay/index.html");
const appView = contents(3, `lophn-app://app-${APP.slice(4)}/main/index.html`);

const event = (sender: CallerContents): IpcEvent => ({
  sender,
  senderFrame: sender.mainFrame,
});

function appRecord(status: "active" | "archived"): CallResult {
  return {
    ok: true,
    value: {
      app: { id: APP, name: "Grocery budget", status, slug: "grocery" },
    },
  };
}

// OS 쓰기는 기록만 한다. 실제 파일·바로가기를 만들지 않는다.
function world(options: {
  env?: Partial<OsEntryEnv>;
  record?: CallResult;
} = {}) {
  const registry = new ContentsRegistry();
  registry.register({
    contents: desk,
    origin: { scheme: "lophn-shell", host: "desktop", path: "/index.html" },
  });
  registry.register({
    contents: overlay,
    origin: { scheme: "lophn-shell", host: "overlay", path: "/index.html" },
  });
  const opened: string[] = [];
  const written = new Map<string, string>();
  const removed: string[] = [];
  const env: OsEntryEnv = {
    platform: "linux",
    packaged: true,
    headless: false,
    execPath: EXEC,
    home: "/fixture-home",
    dataHome: "/fixture-home/.local/share",
    appData: "C:\\fixture",
    probe: { isExecutableFile: (path) => path === EXEC },
    files: {
      write: (path, data) => void written.set(path, data),
      remove: (path) => void removed.push(path),
    },
    shortcuts: { write: () => false },
    ...options.env,
  };
  const handlers = createAppWindowIpc({
    registry,
    openWindow(app) {
      opened.push(app);
      return Promise.resolve({ ok: true, value: null });
    },
    readApp: () => Promise.resolve(options.record ?? appRecord("active")),
    entries: {
      install: (app) => installOsEntry(env, app),
      remove: (app) => removeOsEntry(env, app),
    },
  });
  return { handlers, opened, written, removed };
}

test("shell/desktop#R13: [Open in new window]은 desktop 창 본문이 보낸 앱 ID 하나로만 전용 창을 연다", async () => {
  const { handlers, opened } = world();
  assert.deepEqual(await handlers.openWindow(event(desk), { app: APP }), {
    ok: true,
  });
  assert.deepEqual(opened, [APP]);
  // overlay·앱 view는 부르지 못한다. 페이지가 적은 다른 필드도 받지 않는다.
  assert.deepEqual(await handlers.openWindow(event(overlay), { app: APP }), {
    ok: false,
    code: "forbidden",
  });
  assert.deepEqual(await handlers.openWindow(event(appView), { app: APP }), {
    ok: false,
    code: "forbidden",
  });
  assert.deepEqual(
    await handlers.openWindow(event(desk), { app: APP, window: "window-9" }),
    { ok: false, code: "invalid_input" },
  );
  assert.deepEqual(
    await handlers.openWindow(event(desk), { app: "../notes" }),
    { ok: false, code: "invalid_input" },
  );
  // subframe은 desktop 창 안이어도 거절한다.
  assert.deepEqual(
    await handlers.openWindow({
      sender: desk,
      senderFrame: { url: "lophn-shell://desktop/index.html", parent: {
        url: "lophn-shell://desktop/index.html",
        parent: null,
      } },
    }, { app: APP }),
    { ok: false, code: "forbidden" },
  );
  assert.deepEqual(opened, [APP]);
});

test("shell/desktop#R14: 바로가기 추가는 core 기록의 이름과 앱 ID만 쓰고 지우기는 그 자리만 지운다", async () => {
  const { handlers, written, removed } = world();
  assert.deepEqual(await handlers.addShortcut(event(desk), { app: APP }), {
    ok: true,
  });
  const path = `/fixture-home/.local/share/applications/lophn-${APP}.desktop`;
  const entry = written.get(path) ?? "";
  assert.match(entry, /Name=Grocery budget/);
  assert.ok(entry.includes(`Exec="${EXEC}" --open-app ${APP}\n`));
  assert.deepEqual(await handlers.removeShortcut(event(desk), { app: APP }), {
    ok: true,
  });
  assert.deepEqual(removed, [path]);
  // overlay는 OS에 아무것도 쓰거나 지우지 못한다.
  assert.deepEqual(await handlers.addShortcut(event(overlay), { app: APP }), {
    ok: false,
    code: "forbidden",
  });
  assert.deepEqual(
    await handlers.removeShortcut(event(overlay), { app: APP }),
    { ok: false, code: "forbidden" },
  );
  assert.equal(written.size, 1);
  assert.equal(removed.length, 1);
});

test("shell/desktop#R14: 보관된 앱과 headless·개발 실행은 OS 앱 메뉴에 쓰지 않는다", async () => {
  const archived = world({ record: appRecord("archived") });
  assert.deepEqual(
    await archived.handlers.addShortcut(event(desk), { app: APP }),
    { ok: false, code: "unavailable" },
  );
  assert.equal(archived.written.size, 0);

  const headless = world({ env: { headless: true } });
  assert.deepEqual(
    await headless.handlers.addShortcut(event(desk), { app: APP }),
    { ok: false, code: "not_installed" },
  );
  assert.deepEqual(
    await headless.handlers.removeShortcut(event(desk), { app: APP }),
    { ok: false, code: "not_installed" },
  );
  assert.equal(headless.written.size, 0);
  assert.equal(headless.removed.length, 0);

  const dev = world({ env: { packaged: false } });
  assert.deepEqual(
    await dev.handlers.addShortcut(event(desk), { app: APP }),
    { ok: false, code: "not_installed" },
  );
  assert.equal(dev.written.size, 0);
});

test("shell/desktop#R13: preload 앱 창 API는 main 응답의 ok와 고정 code만 넘기고 통로 실패는 unavailable이다", async () => {
  const { handlers, opened } = world();
  const registered = new Map<
    string,
    (event: IpcEvent, input: unknown) => Promise<unknown>
  >();
  const ipc = {
    handle: (
      channel: string,
      listener: (event: IpcEvent, input: unknown) => Promise<unknown>,
    ) => void registered.set(channel, listener),
    removeHandler: (channel: string) => void registered.delete(channel),
  };
  registerAppWindowIpc(ipc, handlers as AppWindowIpcHandlers);
  const api = createAppWindowsApi({
    invoke: (channel, input) => registered.get(channel)!(event(desk), input),
  });
  assert.deepEqual(await api.openWindow({ app: APP }), { ok: true });
  assert.deepEqual(opened, [APP]);
  removeAppWindowIpc(ipc);
  assert.equal(registered.has(APP_WINDOW_OPEN_CHANNEL), false);
  assert.equal(registered.has(APP_SHORTCUT_ADD_CHANNEL), false);

  const broken = createAppWindowsApi({
    invoke: () => Promise.reject(new Error("gone")),
  });
  assert.deepEqual(await broken.addShortcut({ app: APP }), {
    ok: false,
    code: "unavailable",
  });
  const odd = createAppWindowsApi({
    invoke: () => Promise.resolve({ ok: false, code: "secret", path: "/x" }),
  });
  assert.deepEqual(await odd.removeShortcut({ app: APP }), {
    ok: false,
    code: "unavailable",
  });
});
