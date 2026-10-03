// 조립만 한다. 창·single instance·scheme 규칙은 각 모듈에 있다.
import { app, BrowserWindow, protocol } from "electron";
import { dirname, join } from "node:path";

import { browserDataPath, resolveDataRoot } from "./paths.ts";
import { registerShellScheme } from "./security.ts";
import { startSingleInstance } from "./single-instance.ts";
import { createShellHandler, DESKTOP_URL } from "./shell-protocol.ts";
import { type CreatedWindow, openWindow, type WindowConfig } from "./window.ts";

const here = dirname(__filename);
const dataRoot = resolveDataRoot();

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
  return join(here, "..", "..", "renderer", "dist");
}

function openDesktopWindow(): void {
  openWindow({
    platform: process.platform,
    packaged: app.isPackaged,
    preload: join(here, "..", "preload-shell.js"),
    url: DESKTOP_URL,
    windows: {
      create: (config: WindowConfig) => wrap(new BrowserWindow(config)),
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
