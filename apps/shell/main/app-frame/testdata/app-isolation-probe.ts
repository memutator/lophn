// e2e/shell/app-isolation_test.ts가 build해 띄우는 Electron main. 실제 shell과 같은
// app-frame 조립(scheme 등록, electron adapter, registry, session 정책, scheme proxy)을 쓰고
// core 앱 통로만 가짜 connector로 바꾼다. 창은 화면에 띄우지 않는다(show:false·offscreen).
// 본문 view에 더해 앱 전용 창(desktop/app-window.ts)과 OS 바로가기의 `--open-app` intent가
// second-instance로 연 창에서도 같은 검사를 한다(shell#T47). 결과는 JSON 파일 하나로 쓰고 끝난다.
import { app, BrowserWindow, protocol, webContents } from "electron";
import { writeFileSync } from "node:fs";

import { createAppWindows } from "../../desktop/app-window.ts";
import { surfaceOptions } from "../../desktop/headless.ts";
import { linuxEntry } from "../../desktop/os-entry/linux.ts";
import { registerViewSchemes } from "../../desktop/security.ts";
import { startSingleInstance } from "../../desktop/single-instance.ts";
import { nodeUpstream } from "../app-protocol.ts";
import type { AppBinding, ConnectTarget, Outcome } from "../app-connection.ts";
import {
  createViewDiagnostics,
  type ViewLifetimeDiagnostic,
} from "../diagnostics.ts";
import { electronAppViews } from "../electron-app-frame.ts";
import type { FetchHost } from "../network-policy.ts";
import { type AppViewContents, createAppFrame } from "../registry.ts";
import { appHostLabel } from "../session-policy.ts";

interface ProbeConfig {
  userData: string;
  result: string;
  preload: string;
  appA: string;
  appB: string;
  release: string;
  previewHashes: [string, string];
  /** `<app>:<mode>:<bundle hash>` → 가짜 앱 socket. */
  sockets: Record<string, string>;
  granted: FetchHost;
  denied: FetchHost;
}

const config = JSON.parse(
  process.env.LOPHN_APP_ISOLATION ?? "{}",
) as ProbeConfig;
const LIVE_HASH = "0".repeat(64);

registerViewSchemes(protocol);
// 시험 HTTPS 서버는 자체 서명 인증서다. 막힘과 인증서 실패를 섞지 않으려고 이 probe만 끈다.
app.commandLine.appendSwitch("ignore-certificate-errors");
app.setPath("userData", config.userData);

const STORAGE_WRITE = (value: string) =>
  `(async () => {
  localStorage.setItem("k", ${JSON.stringify(value)});
  await new Promise((resolve, reject) => {
    const open = indexedDB.open("db", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("s");
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction("s", "readwrite");
      tx.objectStore("s").put(${JSON.stringify(value)}, "k");
      tx.oncomplete = () => { open.result.close(); resolve(null); };
      tx.onerror = () => reject(tx.error);
    };
  });
  return true;
})()`;

const STORAGE_READ = `(async () => {
  const idb = await new Promise((resolve) => {
    const open = indexedDB.open("db", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("s");
    open.onerror = () => resolve("error");
    open.onsuccess = () => {
      const get = open.result.transaction("s").objectStore("s").get("k");
      get.onsuccess = () => { open.result.close(); resolve(get.result ?? null); };
      get.onerror = () => resolve("error");
    };
  });
  return { local: localStorage.getItem("k"), idb };
})()`;

// lophn-app scheme은 cookie를 두지 않는다. cookie는 부여한 host의 응답이 남기는 것이라
// 그 host로 보내 partition의 cookie jar를 본다.
const COOKIE = (path: "cookie-set" | "cookie-echo") =>
  `(async () => {
  try {
    const response = await fetch(${
    JSON.stringify(origin(config.granted))
  } + "/${path}", { credentials: "include" });
    return await response.text();
  } catch {
    return "blocked";
  }
})()`;

function origin(host: FetchHost, scheme = "https"): string {
  return `${scheme}://${host.host}:${host.port}`;
}

const NETWORK = (otherLabel: string) =>
  `(async () => {
  const attempt = async (make) => {
    try {
      const response = await make();
      return response.ok ? await response.text() : "status:" + response.status;
    } catch {
      return "blocked";
    }
  };
  const socket = (url) => new Promise((resolve) => {
    const ws = new WebSocket(url);
    ws.onopen = () => { ws.close(); resolve("open"); };
    ws.onerror = () => resolve("blocked");
  });
  const frame = (url) => new Promise((resolve) => {
    const element = document.createElement("iframe");
    element.src = url;
    document.body.appendChild(element);
    setTimeout(() => resolve("done"), 1500);
  });
  return {
    granted: await attempt(() => fetch(${
    JSON.stringify(origin(config.granted))
  } + "/ok")),
    denied: await attempt(() => fetch(${
    JSON.stringify(origin(config.denied))
  } + "/ok")),
    deniedPort: await attempt(() => fetch(${
    JSON.stringify(`https://${config.granted.host}:${config.denied.port}`)
  } + "/port")),
    redirect: await attempt(() => fetch(${
    JSON.stringify(origin(config.granted))
  } + "/redirect")),
    socket: await socket(${
    JSON.stringify(origin(config.denied, "wss"))
  } + "/ws"),
    otherApp: await attempt(() => fetch("lophn-app://${otherLabel}/main/index.html")),
    shell: await attempt(() => fetch("lophn-shell://desktop/index.html")),
    frame: await frame(${JSON.stringify(origin(config.denied))} + "/frame"),
  };
})()`;

const SURFACE = `(async () => {
  const media = await navigator.mediaDevices?.getUserMedia({ video: true })
    .then(() => "granted", () => "denied") ?? "absent";
  const geo = await new Promise((resolve) => {
    if (!navigator.geolocation) return resolve("absent");
    navigator.geolocation.getCurrentPosition(() => resolve("granted"),
      () => resolve("denied"), { timeout: 1000 });
  });
  return {
    require: typeof require,
    process: typeof process,
    bridge: Object.keys(globalThis.lophnApp ?? {}),
    opened: window.open(${
  JSON.stringify(origin(config.granted))
} + "/popup") === null,
    media,
    geo,
    href: location.href,
    resources: performance.getEntriesByType("resource").map((entry) => entry.name),
    html: document.documentElement.outerHTML,
  };
})()`;

const NAVIGATE = `(() => {
  location.href = ${JSON.stringify(origin(config.granted))} + "/navigate";
  return true;
})()`;

async function run(): Promise<unknown> {
  await app.whenReady();
  const parent = new BrowserWindow({
    show: false,
    width: 800,
    height: 600,
    webPreferences: { offscreen: true },
  });
  const appWindowRefs = new Map<string, BrowserWindow>();
  const adapter = electronAppViews({
    windowOf: (ref) => ref === "window-1" ? parent : appWindowRefs.get(ref),
    preload: config.preload,
    packaged: false,
    headless: { headless: true },
    raise: () => {},
  });
  const created: number[] = [];
  const loads = new Map<number, Promise<void>>();
  let previewHash = config.previewHashes[0];
  const diagnostics: ViewLifetimeDiagnostic[] = [];
  let serial = 0;
  const frame = createAppFrame({
    connector: {
      connect(target: ConnectTarget): Promise<Outcome<AppBinding>> {
        const hash = target.mode === "live" ? LIVE_HASH : previewHash;
        const key = `${target.app}:${target.mode}:${hash}`;
        return Promise.resolve({
          ok: true,
          value: {
            endpoint: config.sockets[key]!,
            authorization: `probe ${key}`,
            release: target.mode === "live" ? target.release : null,
            bundleHash: hash,
            processNonce: "probe",
            expiresAtMs: null,
          },
        });
      },
      hosts: (appId) =>
        Promise.resolve({
          ok: true,
          value: appId === config.appA ? [config.granted] : [],
        }),
    },
    views: {
      ...adapter.views,
      create(input): AppViewContents {
        // adapter는 자기가 만든 객체로 native view를 찾으므로 같은 객체를 돌려준다.
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
      send(message) {
        diagnostics.push(message);
        return true;
      },
      log: () => {},
      clock: { nowIso: () => new Date().toISOString() },
    }),
    ids: {
      viewSession: () => `view-${++serial}`,
      token: () => `token-${Math.random().toString(36).slice(2)}`,
    },
    clock: { nowMs: () => Date.now() },
  });

  async function open(
    app: string,
    mode: "live" | "preview",
  ): Promise<number> {
    const result = await frame.open({
      app,
      mode,
      release: mode === "live" ? config.release : null,
      screen: "main",
      size: "full",
      parentWindow: "window-1",
      bounds: { x: 0, y: 0, width: 800, height: 600 },
    });
    if (!result.ok) throw new Error(`open failed: ${result.error.message}`);
    const id = created.at(-1)!;
    await loads.get(id);
    return id;
  }
  const exec = (id: number, code: string) =>
    webContents.fromId(id)!.executeJavaScript(code, true);

  const aLive = await open(config.appA, "live");
  const write = await exec(aLive, STORAGE_WRITE("a-live"));
  const cookieSet = await exec(aLive, COOKIE("cookie-set"));
  const aLiveAgain = await open(config.appA, "live");
  const sameApp = await exec(aLiveAgain, STORAGE_READ);
  const cookieSame = await exec(aLiveAgain, COOKIE("cookie-echo"));
  const bLive = await open(config.appB, "live");
  const otherApp = await exec(bLive, STORAGE_READ);
  await exec(bLive, STORAGE_WRITE("b-live"));
  const aPreview1 = await open(config.appA, "preview");
  const preview1 = await exec(aPreview1, STORAGE_READ);
  const cookiePreview1 = await exec(aPreview1, COOKIE("cookie-echo"));
  await exec(aPreview1, STORAGE_WRITE("a-preview-1"));
  await exec(aPreview1, COOKIE("cookie-set"));
  previewHash = config.previewHashes[1];
  const aPreview2 = await open(config.appA, "preview");
  const preview2 = await exec(aPreview2, STORAGE_READ);
  const cookiePreview2 = await exec(aPreview2, COOKIE("cookie-echo"));
  const liveAfter = await exec(aLive, STORAGE_READ);
  const jars = await Promise.all(
    [aLive, bLive, aPreview1, aPreview2].map(async (id) =>
      (await webContents.fromId(id)!.session.cookies.get({})).map((cookie) =>
        `${cookie.name}=${cookie.value}`
      )
    ),
  );

  const networkA = await exec(aLive, NETWORK(appHostLabel(config.appB)));
  const networkB = await exec(bLive, NETWORK(appHostLabel(config.appA)));
  const surface = await exec(aLive, SURFACE);
  await exec(aLive, NAVIGATE);
  await new Promise((resolve) => setTimeout(resolve, 1000));
  const afterNavigate = webContents.fromId(aLive)!.getURL();

  // 같은 앱 view를 앱 전용 창과 OS 바로가기 intent로 연다(shell/app-frame#R18).
  const appWindows = createAppWindows({
    readApp: (id) =>
      Promise.resolve({
        ok: true,
        value: {
          app: {
            id,
            name: "Probe",
            status: "active",
            active_release: config.release,
          },
        },
      }),
    entryScreen: () => Promise.resolve({ ok: true, value: "main" }),
    create(windowConfig) {
      const window = new BrowserWindow(
        surfaceOptions(windowConfig, { headless: true }),
      );
      const ref = `window-${window.id}`;
      appWindowRefs.set(ref, window);
      window.on("closed", () => appWindowRefs.delete(ref));
      return {
        ref,
        body: () => {
          const [width = 0, height = 0] = window.getContentSize();
          return { x: 0, y: 0, width, height };
        },
        onResize: (listener) => void window.on("resize", listener),
        onClosed: (listener) => void window.on("closed", listener),
        reveal: () => {},
        close: () => window.destroy(),
      };
    },
    frame,
    packaged: false,
    log: () => {},
  });
  const bodySession = webContents.fromId(aLive)!.session;
  async function inspect(id: number, window: string) {
    const contents = webContents.fromId(id)!;
    const host = appWindowRefs.get(window);
    return {
      sameSession: contents.session === bodySession,
      attached: host?.contentView.children.length ?? 0,
      storage: await exec(id, STORAGE_READ),
      cookie: await exec(id, COOKIE("cookie-echo")),
      network: await exec(id, NETWORK(appHostLabel(config.appB))),
      surface: await exec(id, SURFACE),
    };
  }
  async function viewOf(window: string): Promise<number> {
    const id = created.at(-1)!;
    await loads.get(id);
    // 첫 load 뒤에 붙는다(shell#T39). 붙을 때까지 잠시 기다린다.
    for (let wait = 0; wait < 40; wait++) {
      if ((appWindowRefs.get(window)?.contentView.children.length ?? 0) > 0) {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    return id;
  }

  const inWindow = await appWindows.open(config.appA);
  if (!inWindow.ok) throw new Error(`app window: ${inWindow.error.message}`);
  const windowView = await viewOf(inWindow.value.window);
  const appWindow = await inspect(windowView, inWindow.value.window);
  appWindowRefs.get(inWindow.value.window)!.close();
  for (
    let wait = 0;
    wait < 60 && frame.state(inWindow.value.view.view_session) !== undefined;
    wait++
  ) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  // 설치형: Linux .desktop의 Exec가 넘기는 argv 그대로 second-instance로 받는다.
  const execLine = linuxEntry("/opt/lophn/lophn-desktop", {
    id: config.appA,
    name: "Probe",
  }).split("\n").find((line) => line.startsWith("Exec="))!;
  const argv = execLine.slice("Exec=".length).split(" ").map((part) =>
    part.replace(/^"|"$/g, "")
  );
  let fire: ((...args: unknown[]) => void) | undefined;
  let fromOs: ReturnType<typeof appWindows.open> | undefined;
  startSingleInstance({
    dataRoot: config.userData,
    onOpenWindow: () => {},
    onQuitIntent: () => {},
    onOpenApp: (id) => {
      fromOs = appWindows.open(id);
    },
    app: {
      requestSingleInstanceLock: () => true,
      quit: () => {},
      on: (_event, listener) => {
        fire = listener;
      },
    },
  });
  fire?.({}, argv, "/", { dataRoot: config.userData });
  const installed = await fromOs;
  if (installed === undefined || !installed.ok) {
    throw new Error("os entry did not open the app window");
  }
  const osView = await viewOf(installed.value.window);
  const osEntry = await inspect(osView, installed.value.window);

  frame.dispose();
  // webContents.close()는 비동기로 끝난다. 잠시 기다린 뒤 남은 view가 있는지 본다.
  const gone = () =>
    created.every((id) => {
      const contents = webContents.fromId(id);
      return contents === undefined || contents.isDestroyed();
    });
  for (let wait = 0; wait < 60 && !gone(); wait++) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  return {
    write,
    cookieSet,
    cookieSame,
    cookiePreview1,
    cookiePreview2,
    jars,
    sameApp,
    otherApp,
    preview1,
    preview2,
    liveAfter,
    networkA,
    networkB,
    surface,
    afterNavigate,
    osArgv: argv,
    appWindow,
    osEntry,
    destroyed: created.map((id) => {
      const contents = webContents.fromId(id);
      return contents === undefined || contents.isDestroyed();
    }),
    diagnostics: diagnostics.map((message) => message.payload),
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
