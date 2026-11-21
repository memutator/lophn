// Page port의 Electron 구현과, bind가 가리킨 view_session에서 webContents를 찾는 곳(desktop 앱). 창 없는 page host는 createPages만 쓴다.
import { session, type WebContents, webContents } from "electron";

import {
  BROWSER_PROFILES_SETTING,
  profileOfPartition,
} from "../../../../protocol/shell/browser-profiles.ts";
import type { AppFrameService } from "../../app-frame/registry.ts";
import type { ArtifactViews } from "../../artifact/registry.ts";
import type { ShellSettings } from "../../desktop/core/settings.ts";
import { knownBrowserPartitions } from "../session.ts";
import type { DebuggerOwner, Page, PageLookup } from "./page.ts";

// driver와 emulation이 같은 webContents에 같은 Page로 닿아야 debugger 소유를 같이 센다. 그래서 webContents마다 하나만 만든다.
// contents의 partition은 바뀌지 않아 처음 준 profile을 그대로 둔다.
export function createPages(): (
  contents: WebContents,
  profile: string | null,
) => Page {
  const pages = new Map<number, Page>();
  return (contents, profile) => {
    const known = pages.get(contents.id);
    if (known !== undefined) return known;
    const page = electronPage(contents, profile);
    pages.set(contents.id, page);
    const { id } = contents;
    contents.once("destroyed", () => pages.delete(id));
    return page;
  };
}

function electronPage(contents: WebContents, profile: string | null): Page {
  const owners = new Set<DebuggerOwner>();
  contents.debugger.on("detach", () => owners.clear());
  return {
    id: contents.id,
    profile,
    isDestroyed: () => contents.isDestroyed(),
    // 사람이 연 DevTools는 setDevToolsWebContents로 붙어서 isDevToolsOpened()가 false인 채 devToolsWebContents만 생긴다(실험으로 확인).
    isDevToolsOpened: () =>
      contents.isDevToolsOpened() || contents.devToolsWebContents != null,
    isLoading: () => contents.isLoading(),
    url: () => contents.getURL(),
    title: () => contents.getTitle(),
    attach(owner) {
      if (owners.size === 0) contents.debugger.attach("1.3");
      owners.add(owner);
    },
    emulated: () => owners.has("emulation"),
    detach(owner) {
      owners.delete(owner);
      if (owners.size === 0 && contents.debugger.isAttached()) {
        contents.debugger.detach();
      }
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
  artifacts: Pick<ArtifactViews, "guestId">,
  settings: Pick<ShellSettings, "get">,
): PageLookup {
  const pageOf = createPages();
  return {
    guest(view_session) {
      const id = /^wv-([0-9]+)$/.exec(view_session)?.[1];
      const contents =
        id === undefined ? undefined : webContents.fromId(Number(id));
      if (!alive(contents)) return undefined;
      // 앱·artifact view도 `wv-<id>`다. 알려진 browser profile partition의 guest만 browser 탭이다.
      for (const partition of knownBrowserPartitions(
        settings.get(BROWSER_PROFILES_SETTING),
      )) {
        if (contents.session === session.fromPartition(partition)) {
          return pageOf(contents, profileOfPartition(partition) ?? null);
        }
      }
      return undefined;
    },
    app(view_session) {
      for (const contents of webContents.getAllWebContents()) {
        if (!alive(contents)) continue;
        const view = appFrame.senderView(contents.id);
        if (view?.view_session === view_session) {
          return { mode: view.target.mode, page: pageOf(contents, null) };
        }
      }
      return undefined;
    },
    artifact(view_session) {
      const id = artifacts.guestId(view_session);
      const contents = id === undefined ? undefined : webContents.fromId(id);
      return alive(contents) ? pageOf(contents, null) : undefined;
    },
  };
}
