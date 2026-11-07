// BrowserSessionHandle을 Electron의 browser partition에 잇는다.
import { session as electronSession } from "electron";

import { BROWSER_PARTITION, type BrowserSessionHandle } from "./session.ts";

export function electronBrowserSession(): BrowserSessionHandle {
  const session = electronSession.fromPartition(BROWSER_PARTITION);
  return {
    onPermissionRequest(decide) {
      session.setPermissionRequestHandler(
        (_contents, permission, done, details) =>
          done(
            decide({
              permission,
              requestingUrl: details.requestingUrl,
              isMainFrame: details.isMainFrame,
            }),
          ),
      );
    },
    onPermissionCheck(decide) {
      session.setPermissionCheckHandler(
        (_contents, permission, _origin, details) =>
          decide({
            permission,
            // service worker 같이 document가 없는 확인은 url이 없어 거절된다.
            requestingUrl: details.requestingUrl ?? "",
            isMainFrame: details.isMainFrame,
          }),
      );
    },
    denyDevices() {
      session.setDevicePermissionHandler(() => false);
    },
    onDownload(listener) {
      session.on("will-download", (event, item, contents) =>
        listener(event, contents?.id, (done) => item.once("done", done)),
      );
    },
    getUserAgent: () => session.getUserAgent(),
    setUserAgent: (userAgent) => session.setUserAgent(userAgent),
    onBeforeSendHeaders(listener) {
      session.webRequest.onBeforeSendHeaders((details, callback) =>
        listener({ requestHeaders: details.requestHeaders }, callback),
      );
    },
    clearStorageData: () => session.clearStorageData(),
    clearCache: () => session.clearCache(),
  };
}
