// 앱 view registry를 Electron에 잇는다. 모든 앱 view는 같은 격리 기본값(sandbox·context
// isolation·web security·Node 없음)과 앱 preload를 쓰고, 새 창·
// webview·scheme 밖 탐색·download·장치 권한을 거절한다. 본문 view·앱 전용 창이 같은
// 이 adapter를 지나 같은 session·scheme·preload 경계를 쓴다.
import {
  type BrowserWindow,
  type Event as ElectronEvent,
  type NativeImage,
  session as electronSession,
  WebContentsView,
} from "electron";

import { FEEDBACK_LIMITS } from "../../ipc/feedback.ts";
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
  // headless(offscreen) view는 capturePage가 실패한다. 개발 확인에서는 마지막 paint를 쓴다.
  const painted = new Map<AppViewContents, NativeImage>();
  // renderer가 사라진 view. 그 뒤로는 찍을 화면이 없다.
  const gone = new Set<AppViewContents>();

  function live(ref: string): BrowserWindow | undefined {
    const window = input.windowOf(ref);
    return window === undefined || window.isDestroyed() ? undefined : window;
  }

  const views: AppViewHost = {
    hasWindow: (ref) => live(ref) !== undefined,
    create({ partition, allowNavigation, onHealth }) {
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
          painted.delete(adapter);
          gone.delete(adapter);
          if (!contents.isDestroyed()) contents.close();
        },
      };
      native.set(adapter, view);
      // 깨진 화면은 알리기만 한다. 다시 load하지 않는다(crash.ts).
      contents.on("render-process-gone", () => {
        gone.add(adapter);
        painted.delete(adapter);
        onHealth?.("gone");
      });
      contents.on("unresponsive", () => onHealth?.("unresponsive"));
      contents.on("responsive", () => onHealth?.("responsive"));
      if (input.headless.headless) {
        contents.on("paint", (_event, _dirty, image) => {
          if (native.has(adapter)) painted.set(adapter, image);
        });
      }
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
    focused(adapter) {
      const view = native.get(adapter);
      return view !== undefined && !view.webContents.isDestroyed() &&
        view.webContents.isFocused();
    },
    // 그 view의 webContents만 찍는다. 창·overlay·다른 view는 담지 않는다. 긴 변이 1,600px를
    // 넘으면 비율대로 줄인다.
    async capture(adapter) {
      const view = native.get(adapter);
      if (view === undefined || view.webContents.isDestroyed()) {
        throw new Error("view is gone");
      }
      if (gone.has(adapter) || view.webContents.isCrashed()) {
        throw new Error("view crashed");
      }
      let image = input.headless.headless
        ? painted.get(adapter)
        : await view.webContents.capturePage();
      if (image === undefined) throw new Error("nothing painted yet");
      if (image.isEmpty()) throw new Error("capture is empty");
      const { width, height } = image.getSize();
      const long = Math.max(width, height);
      if (long > FEEDBACK_LIMITS.png_long_side) {
        const scale = FEEDBACK_LIMITS.png_long_side / long;
        image = image.resize({
          width: Math.max(1, Math.floor(width * scale)),
          height: Math.max(1, Math.floor(height * scale)),
        });
      }
      return new Uint8Array(image.toPNG());
    },
    pageUrl(adapter) {
      const view = native.get(adapter);
      if (view === undefined || view.webContents.isDestroyed()) return null;
      return view.webContents.getURL() || null;
    },
    focusShell(ref) {
      const window = live(ref);
      if (window !== undefined && !window.webContents.isDestroyed()) {
        window.webContents.focus();
      }
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
