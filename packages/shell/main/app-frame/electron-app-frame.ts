// 앱 view의 `<webview>` guest를 Electron에 잇는다. 붙이기 판정(partition·preload·webPreferences)은
// browser/webview-guest.ts가 하고, 이 모듈은 이미 붙은 guest 하나에 탐색 규칙·새 창 거절·건강
// 감시·캡처를 건다. 본문 view·앱 전용 창이 같은 이 adapter를 지나 같은 session·scheme·preload
// 경계를 쓴다.
import {
  type BrowserWindow,
  type Event as ElectronEvent,
  type NativeImage,
  session as electronSession,
  type WebContents,
} from "electron";

import type { HeadlessMode } from "../desktop/headless.ts";
import type {
  AppViewContents,
  AppViewHost,
  GuestContents,
} from "./view-model.ts";
import type { AppSessionHandle } from "./session-policy.ts";

// annotation screenshot의 긴 변 상한. app-frame/capture.ts의 SCREENSHOT_LONG_SIDE와 같다.
const SCREENSHOT_LONG_SIDE = 1600;

interface ElectronAppViewsInput {
  windowOf(ref: string): BrowserWindow | undefined;
  packaged: boolean;
  headless: HeadlessMode;
}

type NavigationEvent = ElectronEvent & { url: string; isMainFrame: boolean };

export function electronAppViews(input: ElectronAppViewsInput): {
  views: AppViewHost;
  sessionHandle(partition: string): AppSessionHandle;
} {
  const views: AppViewHost = {
    hasWindow(ref) {
      const window = input.windowOf(ref);
      return window !== undefined && !window.isDestroyed();
    },
    guest(guest, rules) {
      const contents = guest as GuestContents & WebContents;
      // headless(offscreen)에서는 capturePage가 실패한다. 개발 확인에서는 마지막 paint를 쓴다.
      let painted: NativeImage | undefined;
      // renderer가 사라진 guest. 그 뒤로는 찍을 화면이 없다.
      let gone = false;
      contents.setWindowOpenHandler(() => ({ action: "deny" }));
      const guard = (event: NavigationEvent) => {
        if (event.isMainFrame && !rules.allowNavigation(event.url)) {
          event.preventDefault();
        }
      };
      contents.on("will-frame-navigate", guard);
      contents.on("will-redirect", guard);
      contents.on("will-attach-webview", (event) => event.preventDefault());
      if (input.packaged) {
        contents.on("devtools-opened", () => contents.closeDevTools());
      }
      // 깨진 화면은 알리기만 한다. 다시 load하지 않는다(crash.ts).
      contents.on("render-process-gone", () => {
        gone = true;
        painted = undefined;
        rules.onHealth?.("gone");
      });
      contents.on("unresponsive", () => rules.onHealth?.("unresponsive"));
      contents.on("responsive", () => rules.onHealth?.("responsive"));
      // renderer가 <webview>를 지웠다. 이 view는 entry가 닫힐 때까지 guest 없이 남는다.
      contents.once("destroyed", () => rules.onDestroyed());
      if (input.headless.headless) {
        contents.on("paint", (_event, _dirty, image) => {
          painted = image;
        });
      }
      const adapter: AppViewContents = {
        id: contents.id,
        // 그 guest의 webContents만 찍는다. 창·overlay·다른 view는 담지 않는다. 긴 변이 1,600px를
        // 넘으면 비율대로 줄인다.
        async capture() {
          if (contents.isDestroyed() || gone || contents.isCrashed()) {
            throw new Error("view is gone");
          }
          let image = input.headless.headless
            ? painted
            : await contents.capturePage();
          if (image === undefined) throw new Error("nothing painted yet");
          if (image.isEmpty()) throw new Error("capture is empty");
          const { width, height } = image.getSize();
          const long = Math.max(width, height);
          if (long > SCREENSHOT_LONG_SIDE) {
            const scale = SCREENSHOT_LONG_SIDE / long;
            image = image.resize({
              width: Math.max(1, Math.floor(width * scale)),
              height: Math.max(1, Math.floor(height * scale)),
            });
          }
          return new Uint8Array(image.toPNG());
        },
        pageUrl() {
          if (contents.isDestroyed()) return null;
          return contents.getURL() || null;
        },
        send(channel, payload) {
          if (!contents.isDestroyed()) contents.send(channel, payload);
        },
      };
      return adapter;
    },
  };

  function sessionHandle(partition: string): AppSessionHandle {
    const session = electronSession.fromPartition(partition);
    return {
      denyPermissions() {
        session.setPermissionRequestHandler((_contents, _permission, done) =>
          done(false),
        );
        session.setPermissionCheckHandler(() => false);
        session.setDevicePermissionHandler(() => false);
      },
      onDownload(listener) {
        session.on("will-download", (event) => listener(event));
      },
      onBeforeRequest(listener) {
        session.webRequest.onBeforeRequest((details, callback) =>
          listener(
            {
              url: details.url,
              resourceType: details.resourceType,
              ...(details.webContentsId === undefined
                ? {}
                : { webContentsId: details.webContentsId }),
            },
            callback,
          ),
        );
      },
      onBeforeSendHeaders(listener) {
        session.webRequest.onBeforeSendHeaders((details, callback) =>
          listener(
            {
              url: details.url,
              resourceType: details.resourceType,
              requestHeaders: details.requestHeaders,
              ...(details.webContentsId === undefined
                ? {}
                : { webContentsId: details.webContentsId }),
            },
            callback,
          ),
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
