// browser 탭의 native view를 Electron에 잇는다. view는 persistent browser partition을 쓰고 preload가
// 없다. 앱 view의 native map과는 따로 가진다. contents에 거는 hook은 한 함수로 묶어 popup으로 생긴
// contents도 같은 규칙을 쓴다.
import {
  type BrowserWindow,
  type Event as ElectronEvent,
  type HandlerDetails,
  type WebContents,
  WebContentsView,
  type WindowOpenHandlerResponse,
} from "electron";

import { type HeadlessMode, surfaceOptions } from "../desktop/headless.ts";
import { webPreferences } from "../desktop/security.ts";
import type { AppViewContents } from "../app-frame/view-model.ts";
import type {
  BrowserContents,
  BrowserHooks,
  BrowserPage,
  BrowserViewHost,
} from "./registry.ts";
import { decideNavigation } from "./navigation.ts";
import { windowOpenHandler } from "./popup-host.ts";
import { BROWSER_PARTITION } from "./session.ts";

interface ElectronBrowserViewsInput {
  windowOf(ref: string): BrowserWindow | undefined;
  packaged: boolean;
  headless: HeadlessMode;
  /** view를 붙인 뒤 그 창의 shell overlay를 맨 위로 다시 둔다. */
  raise(window: BrowserWindow): void;
}

type NavigationEvent = ElectronEvent & { url: string; isMainFrame: boolean };

// 취소(ERR_ABORTED). 새 navigation이 앞선 것을 대신할 때 나오고 실패가 아니다.
const LOAD_ABORTED = -3;

/**
 * contents에 navigation·활동·키·상태 hook을 건다. popup으로 생긴 contents도 이 함수를 지난다.
 */
function hookBrowserContents(
  contents: WebContents,
  hooks: BrowserHooks,
  windowOpen: (details: HandlerDetails) => WindowOpenHandlerResponse,
): void {
  const id = contents.id;
  contents.setWindowOpenHandler(windowOpen);

  // 입력 없이 mailto:로 OS 앱을 열지 못하게 fresh activation일 때만 넘긴다. main frame은
  // will-navigate와 will-frame-navigate가 함께 올 수 있으므로 OS로 넘기는 일은 will-frame-navigate가 하지 않는다.
  const guard = (handOff: boolean) => (event: NavigationEvent) => {
    const decision = decideNavigation({
      url: event.url,
      isMainFrame: event.isMainFrame,
    });
    if (decision.allow) return;
    event.preventDefault();
    if (
      handOff && event.isMainFrame && decision.external &&
      hooks.activation.fresh(id)
    ) {
      hooks.openExternal(event.url);
    }
  };
  contents.on("will-navigate", guard(true));
  contents.on("will-redirect", guard(true));
  contents.on("will-frame-navigate", guard(false));
  contents.on("will-attach-webview", (event) => event.preventDefault());

  // before-input-event는 keyboard만 준다. mouse는 input-event로 듣는다.
  contents.on("input-event", (_event, input) => {
    if (input.type === "mouseDown") hooks.activation.mark(id);
    else if (
      (input.type === "keyDown" || input.type === "rawKeyDown") &&
      !input.modifiers?.includes("isautorepeat")
    ) hooks.activation.mark(id);
  });
  const mac = process.platform === "darwin";
  contents.on("before-input-event", (event, input) => {
    const primary = mac
      ? input.meta && !input.control
      : input.control && !input.meta;
    if (
      input.type === "keyDown" && input.key.toLowerCase() === "d" && primary &&
      !input.shift && !input.alt
    ) {
      event.preventDefault();
      if (!input.isAutoRepeat) hooks.onBookmarkKey();
    }
  });

  const changed = () => hooks.onChange();
  contents.on("did-navigate", changed);
  contents.on("did-navigate-in-page", changed);
  contents.on("page-title-updated", changed);
  contents.on("did-start-loading", changed);
  contents.on("did-stop-loading", changed);
  contents.on("did-fail-load", (_event, code) => {
    if (code !== LOAD_ABORTED) hooks.onChange();
  });
  // page의 window.close()다. Electron이 이어서 contents를 부순다.
  // Electron이 내지만 type에는 없는 event다.
  (contents as unknown as NodeJS.EventEmitter).on(
    "close",
    () => hooks.onClose(),
  );
  contents.on("render-process-gone", () => hooks.onHealth("gone"));
  contents.on("unresponsive", () => hooks.onHealth("unresponsive"));
  contents.on("responsive", () => hooks.onHealth("responsive"));
  contents.once("destroyed", () => hooks.activation.forget(id));
}

export function electronBrowserViews(
  input: ElectronBrowserViewsInput,
): BrowserViewHost {
  const native = new Map<AppViewContents, WebContentsView>();

  function live(ref: string): BrowserWindow | undefined {
    const window = input.windowOf(ref);
    return window === undefined || window.isDestroyed() ? undefined : window;
  }

  // popup은 Electron이 만든 contents를 그대로 감싼다. window.opener가 이어져야 해서 새로 만들지 못한다.
  function wrap(
    view: WebContentsView,
    hooks: BrowserHooks,
  ): BrowserContents {
    const contents = view.webContents;
    hookBrowserContents(
      contents,
      hooks,
      windowOpenHandler({
        openerId: contents.id,
        hooks,
        adopt: (popup, popupHooks) =>
          wrap(new WebContentsView({ webContents: popup }), popupHooks),
        overrides: surfaceOptions({
          webPreferences: { ...webPreferences(input.packaged), devTools: true },
        }, input.headless),
      }),
    );
    // Electron이 부순 뒤에도 state를 읽는다(page의 window.close() 직후).
    let last: BrowserPage = {
      url: "",
      title: "",
      loading: false,
      canGoBack: false,
      canGoForward: false,
    };
    const adapter: BrowserContents = {
      id: contents.id,
      load: (url) => contents.loadURL(url),
      firstLoad: () =>
        new Promise((resolve) => contents.once("did-stop-loading", resolve)),
      page() {
        if (!contents.isDestroyed()) {
          last = {
            url: contents.getURL(),
            title: contents.getTitle(),
            loading: contents.isLoading(),
            canGoBack: contents.navigationHistory.canGoBack(),
            canGoForward: contents.navigationHistory.canGoForward(),
          };
        }
        return last;
      },
      back: () => contents.navigationHistory.goBack(),
      forward: () => contents.navigationHistory.goForward(),
      reload: () => contents.reload(),
      inspect: () => contents.openDevTools({ mode: "detach" }),
      destroy() {
        native.delete(adapter);
        if (contents.isDestroyed()) return;
        // 우리가 닫는 것은 page의 window.close()가 아니다.
        contents.removeAllListeners("close");
        contents.close();
      },
    };
    native.set(adapter, view);
    return adapter;
  }

  return {
    hasWindow: (ref) => live(ref) !== undefined,
    create(hooks) {
      // browser view만 packaged에서도 DevTools를 연다(Inspect).
      return wrap(
        new WebContentsView(surfaceOptions({
          webPreferences: {
            ...webPreferences(input.packaged),
            partition: BROWSER_PARTITION,
            devTools: true,
          },
        }, input.headless)),
        hooks,
      );
    },
    attach(ref, adapter, bounds) {
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
      // Electron이 부순 view는 webContents가 비어 있다.
      const contents = native.get(adapter)?.webContents;
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
