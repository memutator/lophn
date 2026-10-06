// e2e/shell/app-bridge_test.ts가 build해 띄우는 Electron main. 실제 shell과 같은 app-frame
// 조립(scheme 등록, electron adapter, registry, 앱 preload, app IPC, app:call, 외부 링크, view 오류)을
// 쓰고 core 통로(연결·blueprint·confirm)와 OS browser·collector 전송만 가짜다. 창은 화면에 띄우지
// 않는다(show:false·offscreen). 결과는 JSON 파일 하나로 쓰고 끝난다.
import { app, BrowserWindow, ipcMain, protocol, webContents } from "electron";
import { writeFileSync } from "node:fs";

import { registerViewSchemes } from "../../desktop/security.ts";
import {
  type Blueprint,
  createAppCall,
  type InputRules,
  type JsonValue,
} from "../app-call.ts";
import { nodeInvoke } from "../app-invoke.ts";
import type { AppBinding } from "../app-connection.ts";
import { registerAppIpc } from "../app-ipc.ts";
import { nodeUpstream } from "../app-protocol.ts";
import { createViewDiagnostics } from "../diagnostics.ts";
import { electronAppViews } from "../electron-app-frame.ts";
import { createExternalLinks } from "../external-link.ts";
import { type AppViewContents, createAppFrame } from "../registry.ts";
import {
  createViewErrors,
  reportIdOf,
  type ViewErrorForward,
} from "../view-error.ts";

interface ProbeConfig {
  userData: string;
  result: string;
  preload: string;
  app: string;
  other: string;
  release: string;
  socket: string;
}

const config = JSON.parse(
  process.env.LOPHN_APP_BRIDGE ?? "{}",
) as ProbeConfig;
const HASH = "0".repeat(64);

registerViewSchemes(protocol);
app.setPath("userData", config.userData);

const BLUEPRINT: Blueprint = {
  commands: [
    {
      key: "usage.list",
      label: "List usage",
      effect: "read",
      confirm: false,
      input: {
        type: "object",
        properties: { limit: { type: "integer", default: 5 } },
        additionalProperties: false,
      },
    },
    {
      key: "account.close",
      label: "Close account",
      effect: "external",
      confirm: true,
      input: null,
    },
  ],
};

// 입력 검사 정본은 app-call_test가 contracts로 확인한다. 여기서는 IPC·preload 경계만 본다.
const RULES: InputRules = {
  validate: (_schema, value) => ({
    ok: true,
    value: value as JsonValue | undefined,
  }),
  hash: () => Promise.resolve({ ok: true, value: "0".repeat(64) }),
};

// 페이지(main world)가 하는 일. lophnApp 말고는 아무 통로도 없다.
const PAGE = `(async () => {
  const settle = (promise) => promise.then(
    (value) => ({ ok: true, value }),
    (error) => ({ ok: false, message: String(error && error.message) }),
  );
  const bridge = Object.keys(globalThis.lophnApp ?? {});
  const read = await settle(lophnApp.call("usage.list", {}));
  const undeclared = await settle(lophnApp.call("files.read", {}));
  const confirm = await settle(lophnApp.call("account.close", null));
  const external = await settle(
    lophnApp.openExternal("https://example.com/oauth?state=SECRET#frag"),
  );
  const badScheme = await settle(lophnApp.openExternal("file:///etc/passwd"));
  const userinfo = await settle(
    lophnApp.openExternal("https://user:pass@example.com/"),
  );
  const long = await settle(
    lophnApp.openExternal("https://example.com/" + "a".repeat(8174)),
  );
  let frozen = true;
  try { lophnApp.call = () => "patched"; frozen = lophnApp.call !== undefined &&
    String(lophnApp.call) !== '() => "patched"'; } catch { frozen = true; }
  setTimeout(() => { throw new TypeError("boom from ${config.other}"); }, 0);
  Promise.reject(new RangeError("rejected"));
  dispatchEvent(new CustomEvent("lophn:render-error", {
    detail: { name: "RenderError", message: "root failed" },
  }));
  return {
    bridge,
    read,
    undeclared,
    confirm,
    external,
    badScheme,
    userinfo,
    long,
    frozen,
    ipc: typeof globalThis.ipcRenderer,
    require: typeof require,
  };
})()`;

async function run(): Promise<unknown> {
  await app.whenReady();
  const parent = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { offscreen: true },
  });
  const adapter = electronAppViews({
    windowOf: (ref) => ref === "window-1" ? parent : undefined,
    preload: config.preload,
    packaged: false,
    headless: { headless: true },
    raise: () => {},
  });
  const created: number[] = [];
  const loads = new Map<number, Promise<void>>();
  const binding = (authorization: string): AppBinding => ({
    endpoint: config.socket,
    authorization,
    release: config.release,
    bundleHash: HASH,
    processNonce: "probe",
    expiresAtMs: null,
  });
  const connects: string[][] = [];
  const frame = createAppFrame({
    connector: {
      connect: () =>
        Promise.resolve({ ok: true, value: binding("probe screen") }),
      hosts: () => Promise.resolve({ ok: true, value: [] }),
    },
    views: {
      ...adapter.views,
      create(input): AppViewContents {
        const contents = adapter.views.create(input);
        created.push(contents.id);
        const load = contents.load;
        contents.load = (url) => {
          const loading = load(url);
          loads.set(contents.id, loading);
          return loading;
        };
        return contents;
      },
    },
    sessionHandle: adapter.sessionHandle,
    upstream: nodeUpstream,
    platformPorts: () => [],
    diagnostics: createViewDiagnostics({
      send: () => true,
      log: () => {},
      clock: { nowIso: () => new Date().toISOString() },
    }),
    ids: {
      viewSession: () => "view-1",
      token: () => `token-${Math.random().toString(36).slice(2)}`,
    },
    clock: { nowMs: () => Date.now() },
  });
  const calls = createAppCall({
    connector: {
      connectCommands(_target, commands) {
        connects.push([...commands]);
        return Promise.resolve({
          ok: true,
          value: { binding: binding("probe call"), commands: [...commands] },
        });
      },
    },
    blueprint: () => Promise.resolve({ ok: true, value: BLUEPRINT }),
    rules: RULES,
    confirm: () =>
      Promise.resolve({
        ok: false,
        error: { code: "forbidden", message: "the person declined" },
      }),
    invoke: nodeInvoke,
    ids: { requestKey: () => "req-1" },
    clock: { nowMs: () => Date.now() },
  });
  const opened: string[] = [];
  const logs: string[] = [];
  const links = createExternalLinks({
    open(url) {
      opened.push(url);
      return Promise.resolve();
    },
    log: (line) => logs.push(line),
  });
  const forwards: ViewErrorForward[] = [];
  const errors = createViewErrors({
    send(forward) {
      forwards.push(forward);
      return Promise.resolve(true);
    },
    ids: {
      reportId: () =>
        reportIdOf(Date.now(), crypto.getRandomValues(new Uint8Array(10))),
    },
    clock: { nowMs: () => Date.now(), nowIso: () => new Date().toISOString() },
    log: (line) => logs.push(line),
  });
  registerAppIpc({
    handle: (channel, listener) => ipcMain.handle(channel, listener),
    on: (channel, listener) => void ipcMain.on(channel, listener),
    removeHandler: (channel) => ipcMain.removeHandler(channel),
    removeAllListeners: (channel) => void ipcMain.removeAllListeners(channel),
  }, {
    view: (id) => frame.senderView(id),
    call: (view, input) => calls.call(view, input),
    openExternal: (view, input) => links.open(view, input),
    viewError: (view, input) => errors.observe(view, input),
  });

  const result = await frame.open({
    app: config.app,
    mode: "live",
    release: config.release,
    screen: "main",
    size: "full",
    parentWindow: "window-1",
    bounds: { x: 0, y: 0, width: 800, height: 600 },
  });
  if (!result.ok) throw new Error(`open failed: ${result.error.message}`);
  const id = created.at(-1)!;
  await loads.get(id);
  const page = await webContents.fromId(id)!.executeJavaScript(PAGE, true);
  for (let wait = 0; wait < 40 && forwards.length < 3; wait++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  frame.dispose();
  return {
    page,
    connects,
    opened,
    logs,
    forwards,
  };
}

run().then(
  (result) => {
    writeFileSync(config.result, JSON.stringify({ ok: true, result }));
    app.exit(0);
  },
  (error: unknown) => {
    writeFileSync(
      config.result,
      JSON.stringify({ ok: false, error: String(error) }),
    );
    app.exit(1);
  },
);
