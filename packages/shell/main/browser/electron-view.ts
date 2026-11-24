// browser 탭의 page를 Electron에 잇는다. 보통 탭은 shell renderer의 <webview> guest이고, 크기 준
// popup만 native view다. 둘 다 그 탭 profile의 persistent browser partition을 쓰고 preload가 없다. contents에 거는
// hook은 한 함수로 묶어 guest와 popup이 같은 규칙을 쓴다. native view는 이 map에만 있다.
import {
  type BrowserWindow,
  type Event as ElectronEvent,
  type HandlerDetails,
  nativeImage,
  type WebContents,
  webContents as electronContents,
  WebContentsView,
  type WindowOpenHandlerResponse,
} from "electron";

import { matchKey } from "../../../protocol/shell/keybindings.ts";
import type { BrowserViewOrder } from "./view-order.ts";
import { type HeadlessMode, surfaceOptions } from "../desktop/headless.ts";
import { webPreferences } from "../desktop/security.ts";
import type { NativeViewContents } from "./native-view.ts";
import type {
  BrowserContents,
  BrowserHooks,
  BrowserPage,
  BrowserViewHost,
  DevtoolsContents,
} from "./registry.ts";
import { openDevtoolsView } from "./devtools.ts";
import { decideNavigation } from "./navigation.ts";
import { faviconReferer, firstFaviconData } from "./favicon.ts";
import { windowOpenHandler } from "./popup-host.ts";

interface ElectronBrowserViewsInput {
  windowOf(ref: string): BrowserWindow | undefined;
  packaged: boolean;
  headless: HeadlessMode;
  /** 창마다 하나인 native view 층 순서. overlay 아래에 둔다. */
  orderOf(window: BrowserWindow): BrowserViewOrder<WebContentsView>;
  /** page에서 favicon을 성공적으로 받았을 때 알린다(bookmark 자동 보강용). */
  onFavicon?(pageUrl: string, favicon: string): void;
}

type NavigationEvent = ElectronEvent & { url: string; isMainFrame: boolean };

// 취소(ERR_ABORTED). 새 navigation이 앞선 것을 대신할 때 나오고 실패가 아니다.
const LOAD_ABORTED = -3;
const FAVICON_SIZE = 32;
const FAVICON_CACHE_MAX = 256;

// Chromium의 page-favicon-updated는 did-finish-load까지 기다려 1~2초 늦게 온다.
// dom-ready 시점에 DOM의 <link rel="...icon...">를 먼저 읽어 체감 지연을 줄인다.
const READ_DOM_FAVICONS = `(() => {
  const primary = [];
  const touch = [];
  for (const el of document.querySelectorAll("link[rel]")) {
    const raw = el.getAttribute("rel");
    if (!raw) continue;
    const rel = raw.toLowerCase().trim().split(/\\s+/);
    const href = el.href;
    if (typeof href !== "string" || !href) continue;
    if (rel.includes("icon")) primary.push(href);
    else if (
      rel.includes("apple-touch-icon") ||
      rel.includes("apple-touch-icon-precomposed")
    ) {
      touch.push(href);
    }
  }
  return primary.concat(touch);
})()`;

function originOfHttp(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
    return parsed.origin;
  } catch {
    return "";
  }
}

function putLru(cache: Map<string, string>, key: string, value: string): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > FAVICON_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
}

function resizeFavicon(body: Buffer): Buffer | null {
  const image = nativeImage.createFromBuffer(body);
  if (image.isEmpty()) return null;
  const { width, height } = image.getSize();
  const scaled =
    width > FAVICON_SIZE || height > FAVICON_SIZE
      ? image.resize({ width: FAVICON_SIZE, height: FAVICON_SIZE })
      : image;
  const png = scaled.toPNG();
  return png.byteLength > 0 ? png : null;
}

/**
 * contents에 navigation·활동·키·상태 hook을 건다. <webview> guest와 popup으로 생긴 contents가 모두
 * 이 함수를 지난다.
 */
function hookBrowserContents(
  contents: WebContents,
  hooks: BrowserHooks,
  windowOpen: (details: HandlerDetails) => WindowOpenHandlerResponse,
): void {
  const id = contents.id;
  contents.setWindowOpenHandler(windowOpen);

  // 입력 없이 mailto:로 OS 앱을 열지 못하게 fresh activation일 때만 넘긴다. Electron 44에서 main frame은
  // will-frame-navigate가 먼저 오고, 거기서 막으면 will-navigate는 오지 않는다. 그래서
  // will-navigate는 듣지 않고 will-frame-navigate와 will-redirect에서 넘긴다(external은 main frame에만 선다).
  const guard = (event: NavigationEvent) => {
    const decision = decideNavigation({
      url: event.url,
      isMainFrame: event.isMainFrame,
    });
    if (decision.allow) return;
    event.preventDefault();
    if (
      event.isMainFrame &&
      decision.external &&
      hooks.activation.freshPerson(id)
    ) {
      hooks.openExternal(event.url);
    }
  };
  contents.on("will-frame-navigate", guard);
  contents.on("will-redirect", guard);
  contents.on("will-attach-webview", (event) => event.preventDefault());

  // before-input-event는 keyboard만 준다. mouse는 input-event로 듣는다.
  contents.on("input-event", (_event, input) => {
    if (input.type === "mouseDown") hooks.activation.mark(id);
    else if (
      (input.type === "keyDown" || input.type === "rawKeyDown") &&
      !input.modifiers?.includes("isautorepeat")
    )
      hooks.activation.mark(id);
  });
  // native popup(browserView)의 bookmark key. <webview> guest는 창의 shortcut listener가 표의
  // browser.bookmark 줄(사람이 바꾼 key 포함)로 받아 그 탭에만 알리므로 여기서 보지 않는다.
  // popup은 사람이 바꾼 key를 main이 알 수 없어 표의 기본 key만 본다.
  if (contents.getType() !== "webview") {
    const platform = process.platform === "darwin" ? "mac" : "other";
    contents.on("before-input-event", (event, input) => {
      if (input.type !== "keyDown") return;
      const hit = matchKey(
        {
          key: input.key,
          code: input.code,
          ctrl: input.control,
          meta: input.meta,
          alt: input.alt,
          shift: input.shift,
        },
        platform,
        undefined,
        undefined,
        "browser",
      );
      if (hit?.command !== "browser.bookmark") return;
      event.preventDefault();
      if (!input.isAutoRepeat) hooks.onBookmarkKey();
    });
  }

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
  (contents as unknown as NodeJS.EventEmitter).on("close", () =>
    hooks.onClose(),
  );
  contents.on("render-process-gone", () => hooks.onHealth("gone"));
  contents.on("unresponsive", () => hooks.onHealth("unresponsive"));
  contents.on("responsive", () => hooks.onHealth("responsive"));
  contents.once("destroyed", () => hooks.activation.forget(id));
}

export type ElectronBrowserViews = BrowserViewHost & {
  /** shell 창에 붙은 <webview> guest contents에 hook을 건다. contents는 <webview>가 가진다. */
  guest(contents: WebContents, hooks: BrowserHooks): BrowserContents;
  /** 시작 시 bookmark 등에 저장된 favicon으로 origin cache를 채운다. */
  seedFavicon(url: string, favicon: string): void;
  /** browsing data 삭제 시 메모리 favicon cache를 비운다. */
  clearFaviconCache(): void;
};

export function electronBrowserViews(
  input: ElectronBrowserViewsInput,
): ElectronBrowserViews {
  const native = new Map<NativeViewContents, WebContentsView>();
  // origin별·icon URL별 메모리 cache. 재방문 시 did-navigate에서 바로 보여 주고,
  // dom-ready 뒤 같은 URL로 오는 page-favicon-updated의 중복 fetch를 막는다.
  const byOrigin = new Map<string, string>();
  const byIconUrl = new Map<string, string>();

  function live(ref: string): BrowserWindow | undefined {
    const window = input.windowOf(ref);
    return window === undefined || window.isDestroyed() ? undefined : window;
  }

  // popup은 Electron이 만든 contents를 그대로 감싼다. window.opener가 이어져야 해서 새로 만들지 못한다.
  function wrap(view: WebContentsView, hooks: BrowserHooks): BrowserContents {
    const adapter = adapt(view.webContents, hooks, () => {
      native.delete(adapter);
    });
    native.set(adapter, view);
    return adapter;
  }

  // view가 없으면(guest) contents를 부수는 일은 <webview>를 지우는 renderer 몫이다.
  function adapt(
    contents: WebContents,
    hooks: BrowserHooks,
    release?: () => void,
  ): BrowserContents {
    hookBrowserContents(
      contents,
      hooks,
      windowOpenHandler({
        openerId: contents.id,
        hooks,
        adopt: (popup, popupHooks) =>
          wrap(new WebContentsView({ webContents: popup }), popupHooks),
        // partition을 적지 않는다: Electron은 popup contents를 opener의 session으로 만들어 popup이 연 탭의 profile을 따른다.
        overrides: surfaceOptions(
          {
            webPreferences: {
              ...webPreferences(input.packaged),
              devTools: true,
            },
          },
          input.headless,
        ),
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
    // favicon은 dom-ready(조기 탐색)와 page-favicon-updated에서 그 page의 session으로 받는다.
    // 다른 origin으로 가면 cache를 먼저 보이고, 그 사이 늦게 끝난 받기는 버린다.
    let favicon: string | undefined;
    let faviconSeq = 0;
    let inFlightKey = "";
    let origin = "";

    const applyFavicon = (
      pageUrl: string,
      pageOrigin: string,
      data: string,
    ): void => {
      if (pageOrigin !== "") putLru(byOrigin, pageOrigin, data);
      if (pageUrl !== "") input.onFavicon?.(pageUrl, data);
      if (favicon === data) return;
      favicon = data;
      hooks.onChange();
    };

    const loadFavicons = (rawUrls: readonly string[]): void => {
      const candidates: string[] = [];
      for (const raw of rawUrls) {
        if (
          typeof raw === "string" &&
          raw !== "" &&
          !candidates.includes(raw)
        ) {
          candidates.push(raw);
        }
      }
      if (candidates.length === 0) return;
      const pageUrl = contents.getURL();
      const pageOrigin = originOfHttp(pageUrl);
      const firstCached = byIconUrl.get(candidates[0]!);
      if (firstCached !== undefined) {
        applyFavicon(pageUrl, pageOrigin, firstCached);
        return;
      }
      const key = `${pageOrigin}\n${candidates.join("\n")}`;
      if (inFlightKey === key) return;
      faviconSeq += 1;
      const seq = faviconSeq;
      inFlightKey = key;
      let lastUrl: string | undefined;
      void firstFaviconData(
        candidates,
        (target) => {
          lastUrl = target;
          const referer = faviconReferer(pageUrl, target);
          return contents.session.fetch(
            target,
            referer === undefined
              ? undefined
              : { headers: { Referer: referer } },
          );
        },
        resizeFavicon,
      ).then((data) => {
        if (inFlightKey === key) inFlightKey = "";
        if (data === null || seq !== faviconSeq || contents.isDestroyed()) {
          return;
        }
        if (lastUrl !== undefined) putLru(byIconUrl, lastUrl, data);
        applyFavicon(pageUrl, pageOrigin, data);
      });
    };

    contents.on("did-navigate", (_event, url) => {
      const next = originOfHttp(url);
      if (next === origin) return;
      origin = next;
      faviconSeq += 1;
      inFlightKey = "";
      const cached = next === "" ? undefined : byOrigin.get(next);
      if (favicon !== cached) {
        favicon = cached;
        hooks.onChange();
      }
    });
    contents.on("dom-ready", () => {
      if (contents.isDestroyed()) return;
      const pageUrl = contents.getURL();
      const pageOrigin = originOfHttp(pageUrl);
      if (pageOrigin === "") return;
      const seqAtStart = faviconSeq;
      void contents.mainFrame
        .executeJavaScript(READ_DOM_FAVICONS)
        .then((raw: unknown) => {
          if (contents.isDestroyed() || seqAtStart !== faviconSeq) return;
          const links = Array.isArray(raw)
            ? raw.filter((item): item is string => typeof item === "string")
            : [];
          loadFavicons(
            links.length > 0 ? links : [`${pageOrigin}/favicon.ico`],
          );
        })
        .catch(() => {});
    });
    contents.on("page-favicon-updated", (_event, favicons) => {
      loadFavicons(favicons);
    });
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
            ...(favicon === undefined ? {} : { favicon }),
          };
        }
        return last;
      },
      back: () => contents.navigationHistory.goBack(),
      forward: () => contents.navigationHistory.goForward(),
      reload: () => contents.reload(),
      destroy() {
        if (release === undefined) return;
        release();
        if (contents.isDestroyed()) return;
        // 우리가 닫는 것은 page의 window.close()가 아니다.
        contents.removeAllListeners("close");
        contents.close();
      },
    };
    return adapter;
  }

  return {
    guest: (contents, hooks) => adapt(contents, hooks),
    seedFavicon(url, data) {
      const origin = originOfHttp(url);
      if (origin !== "" && !byOrigin.has(origin)) {
        putLru(byOrigin, origin, data);
      }
    },
    clearFaviconCache() {
      byOrigin.clear();
      byIconUrl.clear();
    },
    hasWindow: (ref) => live(ref) !== undefined,
    devtools(page, gone) {
      const target = electronContents.fromId(page.id);
      if (target === undefined || target.isDestroyed()) return undefined;
      const opened = openDevtoolsView({
        target,
        packaged: input.packaged,
        headless: input.headless,
        onGone: gone,
      });
      const adapter: DevtoolsContents = {
        id: opened.view.webContents.id,
        // DevTools frontend는 Electron이 load한다.
        load: () => Promise.resolve(),
        toWindow: opened.toWindow,
        destroy() {
          native.delete(adapter);
          opened.destroy();
        },
      };
      native.set(adapter, opened.view);
      return adapter;
    },
    create(hooks, partition) {
      // crash한 native popup을 다시 열 때 쓴다. browser view만 packaged에서도 DevTools를 연다.
      return wrap(
        new WebContentsView(
          surfaceOptions(
            {
              webPreferences: {
                ...webPreferences(input.packaged),
                partition,
                devTools: true,
              },
            },
            input.headless,
          ),
        ),
        hooks,
      );
    },
    attach(ref, adapter, bounds, layer) {
      const window = live(ref);
      const view = native.get(adapter);
      if (window === undefined || view === undefined) return false;
      input.orderOf(window).attach(view, layer);
      view.setBounds(bounds);
      return true;
    },
    detach(ref, adapter) {
      const window = live(ref);
      const view = native.get(adapter);
      if (window === undefined || view === undefined) return;
      input.orderOf(window).remove(view);
    },
    focused(adapter) {
      // Electron이 부순 view는 webContents가 비어 있다.
      const contents = native.get(adapter)?.webContents;
      return (
        contents !== undefined &&
        !contents.isDestroyed() &&
        contents.isFocused()
      );
    },
    focusShell(ref) {
      const window = live(ref);
      if (window !== undefined && !window.webContents.isDestroyed()) {
        window.webContents.focus();
      }
    },
  };
}
