// browser 탭: profile partition마다의 persistent session 정책, 창의 `<webview>` 붙이기 판정과 guest 등록, 크기 준 popup의
// native view 목록, renderer IPC. app·artifact view의 붙이기도 이 한 handler가 함께 판정한다
// (preventDefault와 prefs 수정은 여기 한 곳만 한다). native popup·DevTools의 위치·숨김은
// native-bounds.ts가 한다.
import {
  app,
  type BrowserWindow,
  shell,
  type WebContents,
  type WebContentsView,
  webContents,
} from "electron";
import { randomUUID } from "node:crypto";

import {
  BROWSER_EVENT_CHANNEL,
  BROWSER_STATE_CHANNEL,
} from "../../../ipc/browser.ts";
import { BROWSER_PROFILES_SETTING } from "../../../../protocol/shell/browser-profiles.ts";
import { createActivation } from "../../browser/activation.ts";
import { electronBrowserViews } from "../../browser/electron-view.ts";
import { electronBrowserSession } from "../../browser/electron-session.ts";
import {
  createNativeBounds,
  type NativeBounds,
} from "../../browser/native-bounds.ts";
import {
  type BrowserViews,
  createBrowserViews,
} from "../../browser/registry.ts";
import {
  createBrowserIpc,
  registerBrowserIpc,
  removeBrowserIpc,
} from "../../browser/browser-ipc.ts";
import {
  installBrowserSession,
  knownBrowserPartitions,
} from "../../browser/session.ts";
import { windowBrowserViewOrders } from "../../browser/view-order.ts";
import {
  type AcceptedWebviewGuest,
  guestViewSession,
  hardenWebviewAttach,
  type WebviewGuestResolver,
} from "../../browser/webview-guest.ts";
import { webPreferences } from "../security.ts";
import { TOP_BAR_HEIGHT } from "../window.ts";
import type { Registered, ShellContext } from "./context.ts";

export type BrowserWiring = Registered & {
  views: BrowserViews;
  /** native popup·DevTools의 위치·숨김·창 옮기기. view IPC가 bounds·hidden 채널을 여기로 보낸다. */
  nativeBounds: NativeBounds;
  /** app·artifact view 영역이 자기 `<webview>` 붙이기 판정을 넣는다. 창이 열리기 전에 넣는다. */
  webviewGuests: { add(resolver: WebviewGuestResolver): void };
};

export function register(ctx: ShellContext): BrowserWiring {
  const { headless, overlays, ipc, log, windowRef, windowOfRef } = ctx;

  const activation = createActivation({ nowMs: () => Date.now() }, (id) =>
    ctx.driverInput.marked(id),
  );
  // userData(desktop.ts)를 잡은 뒤, partition마다 그 첫 view나 Clear browsing data가 올 때 한 번만 설치한다.
  // 그 전에 partition을 만들면 저장이 데이터 root 밖에 생긴다.
  const sessions = new Map<string, ReturnType<typeof installBrowserSession>>();
  const ensureSession = (partition: string) => {
    let installed = sessions.get(partition);
    if (installed === undefined) {
      installed = installBrowserSession(electronBrowserSession(partition), {
        activation,
        // 받는 중에는 renderer가 그 탭의 page를 workspace를 떠나도 살려 두게 알린다.
        downloading(contentsId, active) {
          webContents
            .fromId(contentsId)
            ?.hostWebContents?.send(BROWSER_EVENT_CHANNEL, {
              kind: "download",
              view_session: guestViewSession(contentsId),
              active,
            });
        },
      });
      sessions.set(partition, installed);
    }
    return installed;
  };

  const orderOf = windowBrowserViewOrders<BrowserWindow, WebContentsView>(
    (window) => overlays.raise(window),
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
      create(hooks, partition) {
        ensureSession(partition);
        return host.create(hooks, partition);
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

  // native popup·DevTools의 자리. renderer는 CSS pixel 사각형을 보내고 여기서 창 DIP로 바꾼다.
  const nativeBounds = createNativeBounds({
    frame: views,
    geometry: {
      // overlay와 같은 창 본문이다. 상단 바는 shell 크롬이라 view가 덮지 않는다.
      body(ref) {
        const window = windowOfRef(ref);
        if (window === undefined) return undefined;
        const [width = 0, height = 0] = window.getContentSize();
        return {
          x: 0,
          y: TOP_BAR_HEIGHT,
          width: Math.max(0, width),
          height: Math.max(0, height - TOP_BAR_HEIGHT),
        };
      },
      zoom: (ref) => windowOfRef(ref)?.webContents.getZoomFactor() ?? 1,
    },
    timer: {
      set: (callback, ms) => setTimeout(callback, ms),
      clear: (handle) => clearTimeout(handle as NodeJS.Timeout),
    },
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
      clearData: (partition) => ensureSession(partition).clearData(),
    }),
  );
  ctx.windowHooks.closed.push(({ ref }) => {
    nativeBounds.closeWindow(ref);
    views.closeWindow(ref);
  });

  // app·artifact view의 붙이기 판정. 영역이 자기 resolver를 넣는다.
  const resolvers: WebviewGuestResolver[] = [];
  // 모든 붙이기의 격리 기본값. browser view만 이 위에 DevTools를 켠다.
  const base = { ...webPreferences(app.isPackaged) };

  // project 창과 앱 전용 창은 모두 `lophn-shell://desktop` 문서다(webviewTag는 window.ts가 켠다).
  // 붙이기 전에 규칙을 강제하고, 붙은 guest에 hook을 건다. 받아 둔 붙이기는 did-attach가 오는
  // 순서 그대로 하나씩 꺼내 묶는다(Electron은 거절하지 않은 붙이기에만 did-attach를 보낸다).
  ctx.windowHooks.created.push((window) => {
    const contents = window.webContents;
    const ref = windowRef(window);
    const accepted: AcceptedWebviewGuest[] = [];
    contents.on("will-attach-webview", (event, prefs, params) => {
      let fromShell = false;
      try {
        const url = new URL(contents.getURL());
        fromShell = url.protocol === "lophn-shell:" && url.host === "desktop";
      } catch {
        // 아직 문서가 없으면 shell이 아니다.
      }
      const src = typeof params.src === "string" ? params.src : "";
      let guest: AcceptedWebviewGuest | undefined;
      if (fromShell && src !== "") {
        for (const resolve of resolvers) {
          guest = resolve(ref, src);
          if (guest !== undefined) break;
        }
      }
      const target = hardenWebviewAttach({
        fromShell,
        webPreferences: prefs as unknown as Record<string, unknown>,
        params: params as unknown as Record<string, string>,
        app: guest?.target.kind === "app" ? guest.target : undefined,
        artifact: guest?.target.kind === "artifact" ? guest.target : undefined,
        // 붙일 때마다 지금 설정을 읽는다. 막 만든 profile을 main이 아직 읽지 못했으면 거절된다(빈 page).
        browserPartitions: knownBrowserPartitions(
          ctx.settings.get(BROWSER_PROFILES_SETTING),
        ),
        base,
      });
      if (target === undefined) {
        // 다른 창의 view·모르는 src·이미 쓴 src·shell 밖 문서는 여기서 끝난다.
        guest?.drop();
        event.preventDefault();
        return;
      }
      if (target.kind === "browser") {
        let view_session: string | undefined;
        accepted.push({
          target,
          bind(webContents: WebContents) {
            view_session = guestViewSession(webContents.id);
            views.addGuest(ref, view_session, target.partition, (hooks) =>
              host.guest(webContents, hooks),
            );
          },
          drop() {
            if (view_session !== undefined) views.forgetGuest(view_session);
          },
        });
        // guest가 생기기 전에 그 partition의 정책을 깐다.
        ensureSession(target.partition);
        return;
      }
      // app·artifact는 resolver가 받아 둔 붙이기 그대로 묶는다.
      if (guest === undefined) {
        event.preventDefault();
        return;
      }
      accepted.push(guest);
    });
    contents.on("did-attach-webview", (_event, guest) => {
      const next = accepted.shift();
      if (next === undefined) {
        // 규칙을 지나지 않은 guest는 이 창에 붙이지 않는다.
        guest.close();
        return;
      }
      next.bind(guest);
      guest.once("destroyed", () => next.drop());
    });
    window.on("closed", () => {
      for (const item of accepted.splice(0)) item.drop();
    });
  });

  return {
    views,
    nativeBounds,
    webviewGuests: {
      add(resolver) {
        resolvers.push(resolver);
      },
    },
    stop() {
      removeBrowserIpc(ipc);
      nativeBounds.dispose();
      views.dispose();
    },
  };
}
