// browser 탭: persistent session 정책, project 창의 <webview> 붙이기 규칙과 guest 등록, 크기 준
// popup의 native view 목록, renderer IPC. native popup의 위치·숨김 길은 browser.frame으로
// app-views.ts가 받는다.
import { app, type BrowserWindow, shell, type WebContentsView } from "electron";
import { randomUUID } from "node:crypto";

import {
  BROWSER_EVENT_CHANNEL,
  BROWSER_STATE_CHANNEL,
} from "../../../ipc/browser.ts";
import { windowViewOrders } from "../../app-frame/view-order.ts";
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
import {
  guestViewSession,
  hardenWebviewAttach,
} from "../../browser/webview-guest.ts";
import { webPreferences } from "../security.ts";
import type { Registered, ShellContext } from "./context.ts";

export type BrowserWiring = Registered & {
  views: BrowserViews;
  frame: BrowserFrame;
  /** 창마다 하나인 native view 층 순서. 앱 view가 같은 것을 쓴다. */
  orderOf: ReturnType<typeof windowViewOrders<BrowserWindow, WebContentsView>>;
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

  const orderOf = windowViewOrders<BrowserWindow, WebContentsView>((window) =>
    overlays.raise(window)
  );
  const host = electronBrowserViews({
    windowOf: (ref) => windowOfRef(ref),
    packaged: app.isPackaged,
    headless,
    orderOf,
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

  // project 창만 webviewTag가 켜져 있다(window.ts). 붙이기 전에 규칙을 강제하고, 붙은 guest에 hook을 건다.
  ctx.windowHooks.created.push((window) => {
    const contents = window.webContents;
    contents.on("will-attach-webview", (event, prefs, params) => {
      let fromShell = false;
      try {
        const url = new URL(contents.getURL());
        fromShell = url.protocol === "lophn-shell:" && url.host === "desktop";
      } catch {
        // 아직 문서가 없으면 shell이 아니다.
      }
      const allowed = hardenWebviewAttach({
        fromShell,
        webPreferences: prefs as unknown as Record<string, unknown>,
        params: params as unknown as Record<string, string>,
        base: { ...webPreferences(app.isPackaged), devTools: true },
      });
      if (!allowed) {
        event.preventDefault();
        return;
      }
      // guest가 생기기 전에 partition의 정책을 깐다.
      ensureSession();
    });
    contents.on("did-attach-webview", (_event, guest) => {
      const view_session = guestViewSession(guest.id);
      views.addGuest(
        windowRef(window),
        view_session,
        (hooks) => host.guest(guest, hooks),
      );
      guest.once("destroyed", () => views.forgetGuest(view_session));
    });
  });

  return {
    views,
    frame: views,
    orderOf,
    stop() {
      removeBrowserIpc(ipc);
      views.dispose();
    },
  };
}
