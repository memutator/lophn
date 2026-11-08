// Page port의 Electron 구현과, bind가 가리킨 view_session에서 webContents를 찾는 곳.
import { session, type WebContents, webContents } from "electron";

import type { AppFrameService } from "../../app-frame/registry.ts";
import { BROWSER_PARTITION } from "../session.ts";
import type { Page, PageLookup } from "./page.ts";

export function electronPage(contents: WebContents): Page {
  return {
    id: contents.id,
    isDestroyed: () => contents.isDestroyed(),
    // 사람이 연 DevTools는 setDevToolsWebContents로 붙어서 isDevToolsOpened()가 false인 채 devToolsWebContents만 생긴다(실험으로 확인).
    isDevToolsOpened: () =>
      contents.isDevToolsOpened() || contents.devToolsWebContents != null,
    isLoading: () => contents.isLoading(),
    url: () => contents.getURL(),
    title: () => contents.getTitle(),
    attach: () => contents.debugger.attach("1.3"),
    detach() {
      if (contents.debugger.isAttached()) contents.debugger.detach();
    },
    send: (method, params) =>
      contents.debugger.sendCommand(method, params) as Promise<never>,
    subscribe(events) {
      contents.debugger.on("message", (_event, method, params) =>
        events.cdp(method, params as Record<string, unknown>),
      );
      contents.debugger.on("detach", () => events.detached());
      contents.on("devtools-opened", () => events.devtoolsOpened());
    },
  };
}

const alive = (contents: WebContents | undefined): contents is WebContents =>
  contents !== undefined &&
  !contents.isDestroyed() &&
  contents.getType() === "webview";

export function electronLookup(
  appFrame: Pick<AppFrameService, "senderView">,
): PageLookup {
  return {
    guest(view_session) {
      const id = /^wv-([0-9]+)$/.exec(view_session)?.[1];
      const contents =
        id === undefined ? undefined : webContents.fromId(Number(id));
      // 앱·artifact view도 `wv-<id>`다. browser partition의 guest만 browser 탭이다.
      if (
        !alive(contents) ||
        contents.session !== session.fromPartition(BROWSER_PARTITION)
      ) {
        return undefined;
      }
      return electronPage(contents);
    },
    app(view_session) {
      for (const contents of webContents.getAllWebContents()) {
        if (!alive(contents)) continue;
        const view = appFrame.senderView(contents.id);
        if (view?.view_session === view_session) {
          return { mode: view.target.mode, page: electronPage(contents) };
        }
      }
      return undefined;
    },
  };
}
