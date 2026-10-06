// 앱 view registry를 Electron에 잇는다. 모든 앱 view는 같은 격리 기본값(sandbox·context
// isolation·web security·Node 없음)과 앱 preload를 쓰고(shell/app-frame#R2, R3), 새 창·
// webview·scheme 밖 탐색·download·장치 권한을 거절한다(R4). 본문 view·앱 전용 창이 같은
// 이 adapter를 지나 같은 session·scheme·preload 경계를 쓴다(R18, shell/desktop#R13).
import {
  type BrowserWindow,
  type Event as ElectronEvent,
  session as electronSession,
  WebContentsView,
} from "electron";

import { type HeadlessMode, surfaceOptions } from "../desktop/headless.ts";
import { webPreferences } from "../desktop/security.ts";
import type { AppViewContents, AppViewHost, ViewBounds } from "./registry.ts";
import type { AppSessionHandle } from "./session-policy.ts";

export interface ElectronAppViewsInput {
  windowOf(ref: string): BrowserWindow | undefined;
  /** build가 dist에 낸 앱 preload(.cjs). */
  preload: string;
  packaged: boolean;
  headless: HeadlessMode;
  /** 앱 view를 붙인 뒤 그 창의 shell overlay를 맨 위로 다시 둔다. */
  raise(window: BrowserWindow): void;
}

type NavigationEvent = ElectronEvent & { url: string; isMainFrame: boolean };

export function electronAppViews(input: ElectronAppViewsInput): {
  views: AppViewHost;
  sessionHandle(partition: string): AppSessionHandle;
} {
  const native = new Map<AppViewContents, WebContentsView>();

  function live(ref: string): BrowserWindow | undefined {
    const window = input.windowOf(ref);
    return window === undefined || window.isDestroyed() ? undefined : window;
  }

  const views: AppViewHost = {
    hasWindow: (ref) => live(ref) !== undefined,
    create({ partition, allowNavigation }) {
      const view = new WebContentsView(surfaceOptions({
        webPreferences: {
          ...webPreferences(input.packaged),
          partition,
          preload: input.preload,
        },
      }, input.headless));
      const contents = view.webContents;
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
      const guard = (event: NavigationEvent) => {
        if (event.isMainFrame && !allowNavigation(event.url)) {
          event.preventDefault();
        }
      };
      contents.on("will-navigate", guard);
      contents.on("will-frame-navigate", guard);
      contents.on("will-redirect", guard);
      contents.on("will-attach-webview", (event) => event.preventDefault());
      if (input.packaged) {
        contents.on("devtools-opened", () => contents.closeDevTools());
      }
      const adapter: AppViewContents = {
        id: contents.id,
        load: (url) => contents.loadURL(url),
        destroy() {
          native.delete(adapter);
          if (!contents.isDestroyed()) contents.close();
        },
      };
      native.set(adapter, view);
      return adapter;
    },
    attach(ref, adapter, bounds: ViewBounds) {
      const window = live(ref);
      const view = native.get(adapter);
      if (window === undefined || view === undefined) return false;
      if (!window.contentView.children.includes(view)) {
        window.contentView.addChildView(view);
        input.raise(window);
      }
      view.setBounds(bounds);
      return true;
    },
    detach(ref, adapter) {
      const window = live(ref);
      const view = native.get(adapter);
      if (window === undefined || view === undefined) return;
      window.contentView.removeChildView(view);
    },
  };

  function sessionHandle(partition: string): AppSessionHandle {
    const session = electronSession.fromPartition(partition);
    return {
      denyPermissions() {
        session.setPermissionRequestHandler((_contents, _permission, done) =>
          done(false)
        );
        session.setPermissionCheckHandler(() => false);
        session.setDevicePermissionHandler(() => false);
      },
      onDownload(listener) {
        session.on("will-download", (event) => listener(event));
      },
      onBeforeRequest(listener) {
        session.webRequest.onBeforeRequest((details, callback) =>
          listener({
            url: details.url,
            resourceType: details.resourceType,
            ...(details.webContentsId === undefined
              ? {}
              : { webContentsId: details.webContentsId }),
          }, callback)
        );
      },
      onBeforeSendHeaders(listener) {
        session.webRequest.onBeforeSendHeaders((details, callback) =>
          listener({
            url: details.url,
            resourceType: details.resourceType,
            requestHeaders: details.requestHeaders,
            ...(details.webContentsId === undefined
              ? {}
              : { webContentsId: details.webContentsId }),
          }, callback)
        );
      },
      handleProtocol(scheme, handler) {
        session.protocol.handle(scheme, (request) => handler(request));
      },
      async clearCache() {
        await session.clearCache();
        await session.clearCodeCaches({});
      },
    };
  }

  return { views, sessionHandle };
}
