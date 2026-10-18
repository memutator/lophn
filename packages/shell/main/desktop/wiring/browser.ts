// browser 탭: persistent session 정책, native view 목록, renderer IPC. 앱 view의 위치·숨김 길은
// browser.frame으로 app-views.ts가 받는다.
import { app, shell } from "electron";
import { randomUUID } from "node:crypto";

import {
  BROWSER_EVENT_CHANNEL,
  BROWSER_STATE_CHANNEL,
} from "../../../ipc/browser.ts";
import { createActivation } from "../../browser/activation.ts";
import { electronBrowserViews } from "../../browser/electron-view.ts";
import { electronBrowserSession } from "../../browser/electron-session.ts";
import type { BrowserFrame } from "../../browser/frame-router.ts";
import {
  type BrowserViews,
  createBrowserViews,
} from "../../browser/registry.ts";
import {
  createBrowserIpc,
  registerBrowserIpc,
  removeBrowserIpc,
} from "../../browser/browser-ipc.ts";
import { installBrowserSession } from "../../browser/session.ts";
import type { Registered, ShellContext } from "./context.ts";

export type BrowserWiring = Registered & {
  views: BrowserViews;
  frame: BrowserFrame;
};

export function register(ctx: ShellContext): BrowserWiring {
  const { headless, overlays, ipc, log, windowRef, windowOfRef } = ctx;

  const activation = createActivation({ nowMs: () => Date.now() });
  // userData(desktop.ts)를 잡은 뒤, 첫 view나 Clear browsing data가 올 때 한 번만 설치한다.
  // 그 전에 partition을 만들면 저장이 데이터 root 밖에 생긴다.
  let session: ReturnType<typeof installBrowserSession> | undefined;
  const ensureSession = () =>
    session ??= installBrowserSession(electronBrowserSession(), {
      activation,
      product: app.getName(),
      platform: process.platform,
    });

  const host = electronBrowserViews({
    windowOf: (ref) => windowOfRef(ref),
    packaged: app.isPackaged,
    headless,
    raise: (window) => overlays.raise(window),
  });

  const sendTo = (channel: string) => (ref: string, payload: unknown) => {
    const window = windowOfRef(ref);
    if (window !== undefined && !window.webContents.isDestroyed()) {
      window.webContents.send(channel, payload);
    }
  };

  const views = createBrowserViews({
    host: {
      ...host,
      create(hooks) {
        ensureSession();
        return host.create(hooks);
      },
    },
    activation,
    // headless 확인에서는 사람 장치의 OS 앱을 열지 않는다.
    openExternal(url) {
      if (headless.headless) return;
      shell.openExternal(url).catch(() => log("OS 앱으로 넘기지 못했다"));
    },
    ids: { viewSession: () => `browser-${randomUUID()}` },
    pushState: sendTo(BROWSER_STATE_CHANNEL),
    pushEvent: sendTo(BROWSER_EVENT_CHANNEL),
  });

  registerBrowserIpc(
    ipc,
    createBrowserIpc({
      registry: overlays.overlayRegistry(),
      windowOf: (sender) => {
        const window = ctx.shellWindowOf(sender);
        return window === undefined ? undefined : windowRef(window);
      },
      views,
      clearData: () => ensureSession().clearData(),
    }),
  );
  ctx.windowHooks.closed.push(({ ref }) => views.closeWindow(ref));

  return {
    views,
    frame: views,
    stop() {
      removeBrowserIpc(ipc);
      views.dispose();
    },
  };
}
