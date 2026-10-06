import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import type { AppBinding, ConnectTarget, Outcome } from "./app-connection.ts";
import { VIEW_HEADER } from "./app-protocol.ts";
import {
  createViewDiagnostics,
  type ViewLifetimeDiagnostic,
} from "./diagnostics.ts";
import type { FetchHost } from "./network-policy.ts";
import {
  type AppViewContents,
  createAppFrame,
  type ViewBounds,
} from "./registry.ts";
import type {
  AppSessionHandle,
  HeaderDetails,
  RequestDetails,
} from "./session-policy.ts";

const APP_A = "app_01j9zzzzzzzzzzzzzzzzzzzzzz";
const APP_B = "app_01j9yyyyyyyyyyyyyyyyyyyyyy";
const LABEL_A = "app-01j9zzzzzzzzzzzzzzzzzzzzzz";
const REL_1 = "rel_01j9zzzzzzzzzzzzzzzzzzzzz1";
const REL_2 = "rel_01j9zzzzzzzzzzzzzzzzzzzzz2";
const HASH_1 = "1".repeat(64);
const HASH_2 = "2".repeat(64);
const BOUNDS: ViewBounds = { x: 0, y: 40, width: 800, height: 600 };

interface FakeSession {
  partition: string;
  before?: (
    details: RequestDetails,
    callback: (response: { cancel: boolean }) => void,
  ) => void;
  headers?: (
    details: HeaderDetails,
    callback: (response: { requestHeaders: Record<string, string> }) => void,
  ) => void;
  protocol?: (request: Request) => Promise<Response>;
  cleared: number;
  denied: boolean;
}

function cancelled(session: FakeSession, url: string, id?: number): boolean {
  let result: boolean | undefined;
  session.before!({
    url,
    resourceType: "xhr",
    ...(id === undefined ? {} : { webContentsId: id }),
  }, (response) => result = response.cancel);
  return result!;
}

function world() {
  const state = {
    release: REL_1 as string | null,
    nonce: "nonce-1",
    previewHash: HASH_1,
    hosts: [{ host: "api.example.com", port: 443 }] as FetchHost[],
    connectFails: false,
    expiresAtMs: 10_000_000 as number | null,
    connects: [] as { target: ConnectTarget; follow: boolean }[],
  };
  const sessions = new Map<string, FakeSession>();
  const handles: string[] = [];
  const contents: {
    id: number;
    partition: string;
    loaded: string[];
    destroyed: boolean;
    allow(url: string): boolean;
  }[] = [];
  const attached: { window: string; id: number; bounds: ViewBounds }[] = [];
  const detached: { window: string; id: number }[] = [];
  const windows = new Set(["window-1", "window-2"]);
  const diagnostics: ViewLifetimeDiagnostic[] = [];
  const logs: string[] = [];
  const upstream: { path: string; authorization: string }[] = [];
  let now = 0;
  let viewSerial = 0;
  let tokenSerial = 0;
  let nextContents = 100;

  const frame = createAppFrame({
    connector: {
      connect(
        target: ConnectTarget,
        follow = false,
      ): Promise<Outcome<AppBinding>> {
        state.connects.push({ target, follow });
        if (state.connectFails) {
          return Promise.resolve({
            ok: false,
            error: { code: "unavailable", message: "app is not available" },
          });
        }
        const release = target.mode === "live" ? state.release : null;
        if (
          target.mode === "live" && !follow && release !== target.release
        ) {
          return Promise.resolve({
            ok: false,
            error: { code: "conflict", message: "another release" },
          });
        }
        return Promise.resolve({
          ok: true,
          value: {
            endpoint: `/sock/${target.app}-${state.nonce}`,
            authorization: `auth-${target.app}-${state.nonce}-${now}`,
            release,
            bundleHash: target.mode === "live" ? HASH_1 : state.previewHash,
            processNonce: state.nonce,
            expiresAtMs: state.expiresAtMs,
          },
        });
      },
      hosts: () => Promise.resolve({ ok: true, value: [...state.hosts] }),
    },
    views: {
      hasWindow: (window) => windows.has(window),
      create({ partition, allowNavigation }) {
        const record = {
          id: nextContents++,
          partition,
          loaded: [] as string[],
          destroyed: false,
          allow: allowNavigation,
        };
        contents.push(record);
        const adapter: AppViewContents = {
          id: record.id,
          load(url) {
            record.loaded.push(url);
            return Promise.resolve();
          },
          destroy() {
            record.destroyed = true;
          },
        };
        return adapter;
      },
      attach(window, view, bounds) {
        if (!windows.has(window)) return false;
        attached.push({ window, id: view.id, bounds });
        return true;
      },
      detach(window, view) {
        detached.push({ window, id: view.id });
      },
    },
    sessionHandle(partition): AppSessionHandle {
      handles.push(partition);
      const session: FakeSession = { partition, cleared: 0, denied: false };
      sessions.set(partition, session);
      return {
        denyPermissions() {
          session.denied = true;
        },
        onDownload() {},
        onBeforeRequest(listener) {
          session.before = listener;
        },
        onBeforeSendHeaders(listener) {
          session.headers = listener;
        },
        handleProtocol(_scheme, handler) {
          session.protocol = handler;
        },
        clearCache() {
          session.cleared += 1;
          return Promise.resolve();
        },
      };
    },
    upstream(request) {
      upstream.push({
        path: request.path,
        authorization: request.authorization,
      });
      return Promise.resolve({
        status: 200,
        headers: { "content-type": "text/html" },
        body: new Response("ok").body,
      });
    },
    platformPorts: () => [7431],
    diagnostics: createViewDiagnostics({
      send(message) {
        diagnostics.push(message);
        return true;
      },
      log: (line) => logs.push(line),
      clock: { nowIso: () => "2026-10-06T00:00:00.000Z" },
    }),
    ids: {
      viewSession: () => `view-${++viewSerial}`,
      token: () => `token-${++tokenSerial}`,
    },
    clock: { nowMs: () => now },
  });
  return {
    frame,
    state,
    sessions,
    handles,
    contents,
    attached,
    detached,
    windows,
    diagnostics,
    logs,
    upstream,
    setNow(value: number) {
      now = value;
    },
  };
}

function openInput(overrides: Record<string, unknown> = {}) {
  return {
    app: APP_A,
    mode: "live",
    release: REL_1,
    screen: "main",
    size: "full",
    parentWindow: "window-1",
    bounds: BOUNDS,
    ...overrides,
  };
}

async function opened(
  w: ReturnType<typeof world>,
  overrides: Record<string, unknown> = {},
) {
  const result = await w.frame.open(openInput(overrides));
  assert.equal(result.ok, true, JSON.stringify(result));
  return (result as { ok: true; value: { view_session: string } }).value;
}

test("shell/app-frame#R12, shell/app-frame#R20: view 신원은 main이 얻은 연결에서 오고 페이지·renderer가 주장한 값은 받을 자리가 없다", async () => {
  const w = world();
  for (
    const bad of [
      openInput({ actor: "user" }),
      openInput({ view_session: "view-9" }),
      openInput({ release: null }),
      openInput({ app: "app_X" }),
      openInput({ screen: "a\u0000" }),
      openInput({ size: "huge" }),
      openInput({ bounds: { x: 0.5, y: 0, width: 1, height: 1 } }),
      openInput({ parentWindow: "window-9" }),
    ]
  ) {
    const result = await w.frame.open(bad);
    assert.equal(result.ok, false);
    assert.equal(
      (result as { error: { code: string } }).error.code,
      "invalid_input",
    );
  }
  assert.equal(w.state.connects.length, 0);
  const state = await w.frame.open(openInput());
  assert.deepEqual(state, {
    ok: true,
    value: {
      view_session: "view-1",
      app: APP_A,
      release: REL_1,
      mode: "live",
      screen: "main",
      size: "full",
      connectionState: "running",
    },
  });
  assert.deepEqual(w.state.connects[0], {
    target: {
      app: APP_A,
      mode: "live",
      release: REL_1,
      screen: "main",
      size: "full",
    },
    follow: false,
  });
  // 옛 release를 요청하면 다른 release로 바꿔 열지 않는다.
  w.state.release = REL_2;
  const old = await w.frame.open(openInput());
  assert.equal(old.ok, false);
  assert.equal((old as { error: { code: string } }).error.code, "conflict");
  // registry에는 command를 부르는 길이 없다. view가 있어도 권한이 생기지 않는다.
  for (const name of ["call", "invoke", "command", "grant"]) {
    assert.equal(name in w.frame, false);
  }
});

test("shell/app-frame#R1, shell/app-frame#R8: 앱·live·preview bundle마다 partition이 다르고 같은 앱·mode는 한 partition에 정책을 한 번만 단다", async () => {
  const w = world();
  await opened(w);
  await opened(w, { parentWindow: "window-2", size: "panel" });
  await opened(w, { app: APP_B });
  await opened(w, { mode: "preview", release: null });
  w.state.previewHash = HASH_2;
  await opened(w, { mode: "preview", release: null });
  const partitions = w.contents.map((item) => item.partition);
  assert.deepEqual(partitions, [
    `persist:app-${APP_A}:live`,
    `persist:app-${APP_A}:live`,
    `persist:app-${APP_B}:live`,
    `persist:app-${APP_A}:preview-${HASH_1}`,
    `persist:app-${APP_A}:preview-${HASH_2}`,
  ]);
  assert.deepEqual(w.handles, [...new Set(partitions)]);
  for (const session of w.sessions.values()) assert.equal(session.denied, true);
});

test("shell/app-frame#R18, shell/desktop#R13: 다른 창에 연 같은 앱 view도 같은 session·scheme·탐색 경계를 쓴다", async () => {
  const w = world();
  await opened(w);
  await opened(w, { parentWindow: "window-2" });
  const [first, second] = w.contents;
  assert.equal(first!.partition, second!.partition);
  assert.deepEqual(first!.loaded, second!.loaded);
  assert.deepEqual(first!.loaded, [`lophn-app://${LABEL_A}/main/index.html`]);
  for (
    const url of [
      `lophn-app://${LABEL_A}/main/next.html`,
      `lophn-app://${LABEL_A}/other/index.html`,
      "https://api.example.com/",
    ]
  ) {
    assert.equal(first!.allow(url), second!.allow(url), url);
  }
  assert.equal(first!.allow(`lophn-app://${LABEL_A}/other/index.html`), false);
  assert.deepEqual(w.attached.map((item) => item.window), [
    "window-1",
    "window-2",
  ]);
});

test("shell/app-frame#R16: session은 view의 부여 host만 통과시키고 view에 묶이지 않은 contents의 요청은 모두 막는다", async () => {
  const w = world();
  const view = await opened(w);
  const session = w.sessions.get(`persist:app-${APP_A}:live`)!;
  const id = w.contents[0]!.id;
  assert.equal(
    cancelled(session, `lophn-app://${LABEL_A}/main/app.js`, id),
    false,
  );
  assert.equal(cancelled(session, "https://api.example.com/x", id), false);
  assert.equal(cancelled(session, "https://other.example.com/x", id), true);
  assert.equal(cancelled(session, "https://api.example.com/x", 999), true);
  assert.equal(cancelled(session, "https://api.example.com/x"), true);
  w.frame.close(view.view_session);
  assert.equal(cancelled(session, "https://api.example.com/x", id), true);
  assert.equal(
    cancelled(session, `lophn-app://${LABEL_A}/main/app.js`, id),
    true,
  );
});

test("shell/app-frame#R12: view header는 main이 contents에서 정하고 페이지가 보낸 값은 지운다", async () => {
  const w = world();
  await opened(w);
  const session = w.sessions.get(`persist:app-${APP_A}:live`)!;
  const id = w.contents[0]!.id;
  let headers: Record<string, string> = {};
  session.headers!({
    url: `lophn-app://${LABEL_A}/main/app.js`,
    resourceType: "script",
    webContentsId: id,
    requestHeaders: { "X-Lophn-View": "token-from-page", accept: "*/*" },
  }, (response) => headers = response.requestHeaders);
  assert.deepEqual(headers, { [VIEW_HEADER]: "token-1", accept: "*/*" });
  session.headers!({
    url: "https://api.example.com/",
    resourceType: "xhr",
    webContentsId: id,
    requestHeaders: { [VIEW_HEADER]: "token-1" },
  }, (response) => headers = response.requestHeaders);
  assert.deepEqual(headers, {});
  const response = await session.protocol!(
    new Request(`lophn-app://${LABEL_A}/main/index.html`, {
      headers: { [VIEW_HEADER]: "token-1" },
    }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(w.upstream, [{
    path: "/screens/main/index.html?size=full&view_session=view-1",
    authorization: `auth-${APP_A}-nonce-1-0`,
  }]);
});

test("shell/app-frame#R22: 생성·attach·숨김·교체·폐기를 같은 view_session과 generation으로 남기고 query·token은 쓰지 않는다", async () => {
  const w = world();
  const view = await opened(w);
  assert.deepEqual(w.frame.hide(view.view_session), {
    ok: true,
    value: { generation: 2 },
  });
  assert.deepEqual(w.frame.setBounds(view.view_session, BOUNDS), {
    ok: true,
    value: { generation: 3 },
  });
  // 이미 붙은 view의 bounds 이동은 attach가 아니다.
  assert.deepEqual(
    w.frame.setBounds(view.view_session, { ...BOUNDS, width: 700 }),
    { ok: true, value: { generation: 3 } },
  );
  const replaced = await w.frame.replace(
    view.view_session,
    openInput({ size: "panel" }),
  );
  assert.equal(replaced.ok, true);
  w.frame.close(view.view_session);
  assert.deepEqual(
    w.diagnostics.map((message) => [
      message.payload.view_id,
      message.payload.generation,
      message.payload.created,
      message.payload.attached,
      message.payload.hidden,
      message.payload.replaced,
      message.payload.disposed,
    ]),
    [
      ["view-1", 1, 1, 0, 0, 0, 0],
      ["view-1", 1, 1, 1, 0, 0, 0],
      ["view-1", 2, 1, 1, 1, 0, 0],
      ["view-1", 3, 1, 2, 1, 0, 0],
      ["view-1", 4, 1, 2, 1, 1, 0],
      ["view-1", 4, 2, 2, 1, 1, 0],
      ["view-1", 4, 2, 3, 1, 1, 0],
      ["view-1", 5, 2, 3, 1, 1, 1],
    ],
  );
  const text = JSON.stringify(w.diagnostics) + w.logs.join("\n");
  for (const secret of ["token-", "auth-", "/sock/", "?", "lophn-app://"]) {
    assert.equal(text.includes(secret), false, secret);
  }
  assert.match(w.logs.at(-1)!, /view-1 generation=5 disposed app=app_/);
  assert.match(w.logs.at(-1)!, new RegExp(`release=${REL_1} mode=live`));
});

test("shell/app-frame#R8, shell/app-frame#R19: 권한이 바뀌면 옛 view와 연결을 버리고 cache를 지운 뒤 다시 연다", async () => {
  const w = world();
  const view = await opened(w);
  const session = w.sessions.get(`persist:app-${APP_A}:live`)!;
  // 같은 연결이면 새 서명만 쓰고 view는 그대로다.
  await w.frame.refresh(APP_A);
  assert.equal(w.contents.length, 1);
  assert.equal(session.cleared, 0);
  w.state.hosts = [];
  await w.frame.refresh(APP_B);
  assert.equal(w.contents.length, 1);
  await w.frame.refresh(APP_A);
  assert.equal(w.contents.length, 2);
  assert.equal(w.contents[0]!.destroyed, true);
  assert.equal(session.cleared, 1);
  assert.deepEqual(w.detached, [{ window: "window-1", id: w.contents[0]!.id }]);
  const id = w.contents[1]!.id;
  assert.equal(cancelled(session, "https://api.example.com/x", id), true);
  assert.equal(w.frame.state(view.view_session)?.release, REL_1);
});

test("shell/app-frame#R19: 채택한 release가 바뀌면 그 release로 다시 열고, 연결을 못 얻으면 view를 두고 unavailable로 둔다", async () => {
  const w = world();
  const view = await opened(w);
  w.state.release = REL_2;
  w.state.nonce = "nonce-2";
  await w.frame.refresh();
  assert.equal(w.frame.state(view.view_session)?.release, REL_2);
  assert.equal(w.contents.length, 2);
  assert.equal(w.state.connects.at(-1)!.follow, true);
  w.state.connectFails = true;
  await w.frame.refresh();
  assert.equal(w.contents.length, 2);
  assert.equal(w.contents[1]!.destroyed, false);
  assert.equal(
    w.frame.state(view.view_session)?.connectionState,
    "unavailable",
  );
});

test("shell/app-frame#R12: 만료가 가까운 연결은 화면 요청 때 다시 얻고 늦은 결과를 닫힌 view에 붙이지 않는다", async () => {
  const w = world();
  const view = await opened(w);
  const session = w.sessions.get(`persist:app-${APP_A}:live`)!;
  w.setNow(10_000_000 - 1_000);
  const screen = () =>
    session.protocol!(
      new Request(`lophn-app://${LABEL_A}/main/index.html`, {
        headers: { [VIEW_HEADER]: "token-1" },
      }),
    );
  await screen();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(w.state.connects.length, 2);
  assert.equal(w.state.connects[1]!.follow, true);
  // core가 같은 만료를 다시 주면 요청마다 다시 얻지 않는다.
  await screen();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(w.state.connects.length, 2);
  // replace 중에 닫히면 늦은 결과는 conflict다.
  const pending = w.frame.replace(view.view_session, openInput());
  w.frame.close(view.view_session);
  const result = await pending;
  assert.equal(result.ok, false);
  assert.equal(
    (result as { error: { code: string } }).error.code,
    "conflict",
  );
  assert.equal(w.contents.length, 1);
});

test("shell/app-frame#R4: 닫힌 창의 view를 폐기하고 없는 창에는 열지 않는다", async () => {
  const w = world();
  await opened(w);
  await opened(w, { parentWindow: "window-2" });
  w.windows.delete("window-1");
  w.frame.closeWindow("window-1");
  assert.equal(w.contents[0]!.destroyed, true);
  assert.equal(w.contents[1]!.destroyed, false);
  const result = await w.frame.open(openInput());
  assert.equal(result.ok, false);
  w.frame.dispose();
  assert.equal(w.contents[1]!.destroyed, true);
});

test("shell/app-frame#R19: shell renderer는 앱 UI 코드나 앱 scheme 자원을 import하지 않는다", async () => {
  const renderer = fileURLToPath(new URL("../../renderer/", import.meta.url));
  const files: string[] = [];
  async function walk(dir: string): Promise<void> {
    for (const item of await readdir(dir, { withFileTypes: true })) {
      if (item.name === "node_modules" || item.name === "dist") continue;
      const path = join(dir, item.name);
      if (item.isDirectory()) await walk(path);
      else if (/\.(ts|tsx)$/.test(item.name)) files.push(path);
    }
  }
  await walk(renderer);
  assert.ok(files.length > 0);
  for (const file of files) {
    const text = await readFile(file, "utf8");
    assert.equal(
      /from\s+["'](lophn-app:|[^"']*packages\/apps\/)/.test(text),
      false,
      file,
    );
  }
});
