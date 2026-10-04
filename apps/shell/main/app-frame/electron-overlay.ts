import {
  type BrowserWindow,
  ipcMain,
  type Session,
  type WebContents,
  WebContentsView,
} from "electron";
import { TOP_BAR_HEIGHT } from "../desktop/window.ts";
import { ContentsRegistry, type IpcEvent } from "../desktop/ipc-guard.ts";
import {
  createOverlay,
  type OverlayContents,
  type OverlayController,
  type OverlayView,
} from "./overlay.ts";

import {
  overlaySecurityFactory,
  type OverlaySecuritySession,
} from "./overlay-security.ts";

function contents(contents: WebContents): OverlayContents {
  return contents;
}

// 한 main의 router가 caller object identity로 창을 찾는다. 페이지의 window id는 받지 않는다.
export function electronOverlays() {
  const security = overlaySecurityFactory();
  const sessions = new Map<Session, OverlaySecuritySession>();
  function sessionPolicy(session: Session) {
    let adapter = sessions.get(session);
    if (!adapter) {
      adapter = {
        denyPermissions() {
          session.setPermissionRequestHandler((
            _contents,
            _permission,
            callback,
          ) => callback(false));
          session.setPermissionCheckHandler(() => false);
          session.setDevicePermissionHandler(() => false);
        },
        onDownload(listener) {
          session.on("will-download", listener);
          return () => session.removeListener("will-download", listener);
        },
      };
      sessions.set(session, adapter);
    }
    security.session(adapter);
  }
  const registry = new ContentsRegistry();
  const windows = new Set<OverlayController>();
  const denied = {
    ok: false,
    error: {
      code: "forbidden",
      message: "caller is not a live window surface",
    },
  };
  for (
    const [channel, method] of [
      ["shell:overlay-open", "open"],
      ["shell:overlay-close", "close"],
      ["overlay:result", "result"],
      ["overlay:subscribe", "subscribe"],
    ] as const
  ) {
    ipcMain.handle(channel, (event, input: unknown) => {
      const owner = [...windows].find((window) => window.owns(event.sender));
      return owner ? owner[method](event as IpcEvent, input) : denied;
    });
  }
  return {
    dispose() {
      for (const window of windows) window.dispose();
      windows.clear();
      security.dispose();
      sessions.clear();
    },
    attach(window: BrowserWindow, preload: string, packaged: boolean) {
      const shell = contents(window.webContents);
      registry.register({
        contents: shell,
        origin: { scheme: "lophn-shell", host: "desktop", path: "/index.html" },
      });
      const native = new Map<OverlayView, WebContentsView>();
      const controller = createOverlay({
        shell,
        registry,
        preload,
        packaged,
        body: () => {
          const [width = 1, height = TOP_BAR_HEIGHT + 1] = window
            .getContentSize();
          return {
            x: 0,
            y: TOP_BAR_HEIGHT,
            width: Math.max(1, width),
            height: Math.max(1, height - TOP_BAR_HEIGHT),
          };
        },
        host: {
          addChildView(view) {
            // 창이 destroy된 뒤 온 정리(retire→remove)는 view 작업을 건너뛴다.
            if (window.isDestroyed() || window.webContents.isDestroyed()) {
              native.delete(view);
              return;
            }
            window.contentView.addChildView(native.get(view)!);
          },
          removeChildView(view) {
            if (window.isDestroyed() || window.webContents.isDestroyed()) {
              native.delete(view);
              return;
            }
            window.contentView.removeChildView(native.get(view)!);
            native.delete(view);
          },
        },
        create(config) {
          const view = new WebContentsView(config);
          const wc = view.webContents;
          sessionPolicy(wc.session);
          const releaseSecurity = security.contents({
            setWindowOpenHandler: (handler) => wc.setWindowOpenHandler(handler),
            onNavigation(listener) {
              wc.on("will-navigate", listener);
              wc.on("will-redirect", listener);
              wc.on("will-frame-navigate", listener);
              return () => {
                wc.removeListener("will-navigate", listener);
                wc.removeListener("will-redirect", listener);
                wc.removeListener("will-frame-navigate", listener);
              };
            },
            onWebview(listener) {
              wc.on("will-attach-webview", listener);
              return () => wc.removeListener("will-attach-webview", listener);
            },
            onDevtools(listener) {
              wc.on("devtools-opened", listener);
              return () => wc.removeListener("devtools-opened", listener);
            },
            closeDevTools: () => wc.closeDevTools(),
          }, packaged);
          const adapter: OverlayView = {
            webContents: contents(view.webContents),
            setBackgroundColor: (color) => view.setBackgroundColor(color),
            setVisible: (visible) => view.setVisible(visible),
            setBounds: (bounds) => view.setBounds(bounds),
            onFailure(listener) {
              const crashed = () => listener("crashed");
              const failed = (
                _event: Electron.Event,
                _code: number,
                _description: string,
                _url: string,
                mainFrame: boolean,
              ) => {
                if (mainFrame) listener("load_failed");
              };
              view.webContents.on("render-process-gone", crashed);
              view.webContents.on("did-fail-load", failed);
              return () => {
                releaseSecurity();
                view.webContents.removeListener("render-process-gone", crashed);
                view.webContents.removeListener("did-fail-load", failed);
              };
            },
          };
          native.set(adapter, view);
          return adapter;
        },
        timer: {
          set: (callback, ms) => setTimeout(callback, ms),
          clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
        },
      });
      windows.add(controller);
      const resized = () => controller.refresh();
      window.on("resize", resized);
      window.once("closed", () => {
        window.removeListener("resize", resized);
        controller.dispose();
        registry.unregister(shell.id);
        windows.delete(controller);
      });
      return controller;
    },
  };
}
