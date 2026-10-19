// artifact view를 Electron에 잇는다. 봉한 partition의 WebContentsView이고 preload는 표시하기 층뿐이다.
// 앱 view와 browser view처럼 native view를 앱 view의 map과 따로 가진다.
import {
  type BrowserWindow,
  type Event as ElectronEvent,
  type NativeImage,
  WebContentsView,
} from "electron";

import type { AppViewOrder } from "../app-frame/view-order.ts";
import { type HeadlessMode, surfaceOptions } from "../desktop/headless.ts";
import { webPreferences } from "../desktop/security.ts";
import { decideArtifactNavigation } from "./navigation.ts";
import type {
  ArtifactContents,
  ArtifactHooks,
  ArtifactViewHost,
} from "./registry.ts";
import { ARTIFACT_PARTITION } from "./session.ts";

interface ElectronArtifactViewsInput {
  windowOf(ref: string): BrowserWindow | undefined;
  /** build가 dist에 낸 artifact preload(.cjs). */
  preload: string;
  packaged: boolean;
  headless: HeadlessMode;
  /** 창마다 하나인 native view 층 순서. 앱 view·browser view와 같이 쓴다. */
  orderOf(window: BrowserWindow): AppViewOrder<WebContentsView>;
}

type NavigationEvent = ElectronEvent & { url: string; isMainFrame: boolean };

// 취소(ERR_ABORTED). 새 navigation이 앞선 것을 대신할 때 나오고 실패가 아니다.
const LOAD_ABORTED = -3;

export function electronArtifactViews(
  input: ElectronArtifactViewsInput,
): ArtifactViewHost {
  const native = new Map<ArtifactContents, WebContentsView>();
  // headless(offscreen) view는 capturePage가 실패한다. 개발 확인에서는 마지막 paint를 쓴다.
  const painted = new Map<ArtifactContents, NativeImage>();

  function live(ref: string): BrowserWindow | undefined {
    const window = input.windowOf(ref);
    return window === undefined || window.isDestroyed() ? undefined : window;
  }

  return {
    hasWindow: (ref) => live(ref) !== undefined,
    create(host, hooks: ArtifactHooks) {
      const view = new WebContentsView(surfaceOptions({
        webPreferences: {
          ...webPreferences(input.packaged),
          partition: ARTIFACT_PARTITION,
          preload: input.preload,
        },
      }, input.headless));
      const contents = view.webContents;
      const id = contents.id;

      // 입력 없이 page가 스스로 보낸 이동은 조용히 버린다. main frame은 will-navigate와
      // will-frame-navigate가 함께 올 수 있으므로 알리는 일은 will-frame-navigate가 하지 않는다.
      const guard = (notify: boolean) => (event: NavigationEvent) => {
        const decision = decideArtifactNavigation({
          url: event.url,
          isMainFrame: event.isMainFrame,
          host,
        });
        if (decision.allow) return;
        event.preventDefault();
        if (notify && decision.external && hooks.activation.fresh(id)) {
          hooks.openLink(event.url);
        }
      };
      contents.on("will-navigate", guard(true));
      contents.on("will-redirect", guard(true));
      contents.on("will-frame-navigate", guard(false));
      contents.setWindowOpenHandler((details) => {
        const decision = decideArtifactNavigation({
          url: details.url,
          isMainFrame: true,
          host,
        });
        if (
          !decision.allow && decision.external && hooks.activation.fresh(id)
        ) {
          hooks.openLink(details.url);
        }
        return { action: "deny" };
      });
      contents.on("will-attach-webview", (event) => event.preventDefault());
      if (input.packaged) {
        contents.on("devtools-opened", () => contents.closeDevTools());
      }

      // before-input-event는 keyboard만 준다. mouse는 input-event로 듣는다.
      contents.on("input-event", (_event, event) => {
        if (event.type === "mouseDown") hooks.activation.mark(id);
        else if (
          (event.type === "keyDown" || event.type === "rawKeyDown") &&
          !event.modifiers?.includes("isautorepeat")
        ) hooks.activation.mark(id);
      });

      const changed = () => hooks.onChange();
      contents.on("page-title-updated", changed);
      contents.on("did-start-loading", changed);
      contents.on("did-stop-loading", changed);
      contents.on("did-fail-load", (_event, code) => {
        if (code !== LOAD_ABORTED) changed();
      });
      contents.on("render-process-gone", () => {
        painted.delete(adapter);
        hooks.onHealth("gone");
      });
      contents.on("unresponsive", () => hooks.onHealth("unresponsive"));
      contents.on("responsive", () => hooks.onHealth("responsive"));
      contents.once("destroyed", () => hooks.activation.forget(id));
      if (input.headless.headless) {
        contents.on("paint", (_event, _dirty, image) => {
          if (native.has(adapter)) painted.set(adapter, image);
        });
      }

      const adapter: ArtifactContents = {
        id,
        load: (url) => contents.loadURL(url),
        title: () => contents.isDestroyed() ? "" : contents.getTitle(),
        loading: () => !contents.isDestroyed() && contents.isLoading(),
        reload: () => contents.reloadIgnoringCache(),
        pageUrl: () =>
          contents.isDestroyed() ? null : contents.getURL() || null,
        send(channel, payload) {
          if (!contents.isDestroyed()) contents.send(channel, payload);
        },
        async capture() {
          if (contents.isDestroyed() || contents.isCrashed()) {
            throw new Error("view is gone");
          }
          const image = input.headless.headless
            ? painted.get(adapter)
            : await contents.capturePage();
          if (image === undefined || image.isEmpty()) {
            throw new Error("nothing painted yet");
          }
          return new Uint8Array(image.toPNG());
        },
        destroy() {
          native.delete(adapter);
          painted.delete(adapter);
          if (!contents.isDestroyed()) contents.close();
        },
      };
      native.set(adapter, view);
      return adapter;
    },
    attach(ref, adapter, bounds, layer) {
      const window = live(ref);
      const view = native.get(adapter as ArtifactContents);
      if (window === undefined || view === undefined) return false;
      input.orderOf(window).attach(view, layer);
      view.setBounds(bounds);
      return true;
    },
    detach(ref, adapter) {
      const window = live(ref);
      const view = native.get(adapter as ArtifactContents);
      if (window === undefined || view === undefined) return;
      input.orderOf(window).remove(view);
    },
    focused(adapter) {
      const contents = native.get(adapter as ArtifactContents)?.webContents;
      return contents !== undefined && !contents.isDestroyed() &&
        contents.isFocused();
    },
    focusShell(ref) {
      const window = live(ref);
      if (window !== undefined && !window.webContents.isDestroyed()) {
        window.webContents.focus();
      }
    },
  };
}
