// 조립만 한다. 창·single instance·scheme 규칙은 각 모듈에 있다.
import { app, BrowserWindow, ipcMain, protocol } from "electron";
import { dirname, join } from "node:path";

import { CORE_STATE_CHANNEL } from "../../ipc/core.ts";

import { electronOverlays } from "../app-frame/electron-overlay.ts";
import { startCoreConnection } from "./core/connection.ts";
import { nodeFetch, nodeSockets } from "./core/node-io.ts";
import { browserDataPath, resolveDataRoot } from "./paths.ts";
import { registerShellScheme } from "./security.ts";
import { startSingleInstance } from "./single-instance.ts";
import { createShellHandler, DESKTOP_URL } from "./shell-protocol.ts";
import { type CreatedWindow, openWindow, type WindowConfig } from "./window.ts";

const here = dirname(__filename);
const dataRoot = resolveDataRoot();
const overlays = electronOverlays();
const windows = new Set<BrowserWindow>();
// 창을 다 닫아도 core는 남긴다. 명시 종료(tray·OS 종료)만 core를 멈춘다.
const core = startCoreConnection({
  launch: {
    repoRoot: join(here, "..", "..", "..", ".."),
    dataRoot,
    denoBinary: "deno",
    packaged: app.isPackaged,
  },
  ipc: { handle: (channel, listener) => ipcMain.handle(channel, listener) },
  fetch: nodeFetch,
  sockets: nodeSockets(),
  clock: { now: () => Date.now() },
  targets: () =>
    [...windows].map((window) => ({
      send: (channel, payload) => window.webContents.send(channel, payload),
      isDestroyed: () => window.isDestroyed(),
    })),
});
app.once("will-quit", () => {
  core.shutdown();
  overlays.dispose();
});

// session이 생기기 전에 userData를 잡아야 Chromium 저장이 데이터 root 안에 있다.
app.setPath("userData", browserDataPath(dataRoot));
registerShellScheme(protocol);

const instance = startSingleInstance({
  app,
  dataRoot,
  onOpenWindow: () => openDesktopWindow(),
});

// 창을 다 닫아도 main은 남는다. 종료는 tray의 명시 행동이다(desktop#R21).
app.on("window-all-closed", () => {});

if (instance.acquired) {
  app.whenReady().then(() => {
    const serve = createShellHandler({ distDir: rendererDist() });
    protocol.handle(
      "lophn-shell",
      (request) =>
        serve(request).then(
          (res) =>
            new Response(res.body ? Buffer.from(res.body) : null, {
              status: res.status,
              headers: res.headers,
            }),
        ),
    );
    openDesktopWindow();
  });
}

function rendererDist(): string {
  // build 결과에서 here는 apps/shell/main/dist이고 renderer dist는 형제 concern
  // 폴더 바로 아래다: apps/shell/renderer/dist.
  return join(here, "..", "..", "renderer", "dist");
}

function openDesktopWindow(): void {
  openWindow({
    platform: process.platform,
    packaged: app.isPackaged,
    // build가 preload를 같은 dist에 .cjs로 낸다.
    preload: join(here, "preload-shell.cjs"),
    url: DESKTOP_URL,
    windows: {
      create: (config: WindowConfig) => {
        const window = new BrowserWindow(config);
        overlays.attach(
          window,
          join(here, "preload-shell.cjs"),
          app.isPackaged,
        );
        windows.add(window);
        window.on("closed", () => windows.delete(window));
        // 연결 전에 뜬 창은 지금 상태를 바로 받는다. 이후 변화는 targets가 민다.
        window.webContents.on("did-finish-load", () => {
          if (!window.isDestroyed()) {
            window.webContents.send(CORE_STATE_CHANNEL, { ...core.state });
          }
        });
        return wrap(window);
      },
    },
  });
}

function wrap(window: BrowserWindow): CreatedWindow {
  return {
    setTitle: (title) => window.setTitle(title),
    loadURL: (url) => window.loadURL(url),
    onPageTitleUpdated: (handler) => {
      window.on(
        "page-title-updated",
        (event) => handler(() => event.preventDefault()),
      );
    },
  };
}
