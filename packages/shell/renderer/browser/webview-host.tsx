// browser 탭 page를 그리는 <webview>의 그릇. <webview>를 DOM에서 다른 부모로 옮기면 guest가 다시
// 만들어져 page가 다시 load되므로, 창마다 그릇 하나에 탭 key당 한 번만 만들고 옮기지 않는다. 탭을
// 그리는 자리(pane 칸, floated 패널 몸통)는 자기 사각형만 알리고, 여기서 위치·크기·z-index·보임만 바꾼다.
// 그릇은 floats 층과 같은 stacking context 안에 있어 pane 탭은 모든 패널 아래, floated 탭은 자기 패널
// 바로 위에 온다(floats.tsx가 패널 층을 2배로 둔다).
import { createContext, useContext, useEffect, useRef } from "react";

import styles from "./webview-host.module.css";

// main의 BROWSER_PARTITION(main/browser/session.ts)과 같은 이름이다. 다르면 main이 attach를 거절한다.
const PARTITION = "persist:lophn-browser";

/** guest 탭의 view_session. main이 같은 규칙으로 guest를 부른다(`bt-webview-main`). */
export function guestSession(contentsId: number): string {
  return `wv-${contentsId}`;
}

/** <webview>의 renderer 쪽 method 가운데 여기서 쓰는 것. */
interface WebviewElement extends HTMLElement {
  getWebContentsId(): number;
  getURL(): string;
  getTitle(): string;
  isLoading(): boolean;
  canGoBack(): boolean;
  canGoForward(): boolean;
}

/** 붙기 전에도 읽을 수 있게 물어볼 때마다 실패를 삼킨다. */
export interface GuestPage {
  url: string;
  title: string;
  loading: boolean;
  canGoBack: boolean;
  canGoForward: boolean;
}

interface Entry {
  element: HTMLElement;
  session: string | null;
  listeners: Set<(session: string) => void>;
  /** 이 탭을 그리는 자리. focus가 page로 들어오면 그 자리에 focusin을 보내 칸·패널이 focus를 안다. */
  slot: HTMLElement | null;
}

export interface WebviewHost {
  /** key의 <webview>를 만든다(이미 있으면 그대로). url은 처음 만들 때만 쓴다. */
  ensure(key: string, url: string): void;
  /** guest가 붙으면 session을 알린다. 이미 붙었으면 바로 부른다. */
  onSession(key: string, listener: (session: string) => void): () => void;
  /** 자리 사각형(그릇 기준이 아닌 화면 좌표)과 층. null이면 숨긴다. */
  place(
    key: string,
    slot: HTMLElement | null,
    rect: DOMRect | null,
    layer: number,
  ): void;
  page(key: string): GuestPage | null;
  release(key: string): void;
  keys(): readonly string[];
  /** 그릇 요소. WebviewLayer가 붙인다. */
  attach(container: HTMLElement | null): void;
}

// pane 탭(층 0)은 pane의 경계 잡는 띠(--z-sticky) 아래이고, 층 L의 패널은 --z-sticky + 2L, floated 탭은
// 자기 패널 바로 위다. floats 층이 stacking context가 아니라서 이 값들이 pane 요소와 직접 겹쳐 쌓인다.
function zOf(layer: number): string {
  return layer === 0 ? "1" : `calc(var(--z-sticky) + ${layer * 2 + 1})`;
}

// Electron 창에서 webviewTag가 켜져 있을 때만 <webview>가 정의된다. dev mock·gallery는 빈 자리를 그린다.
function webviewSupported(): boolean {
  return globalThis.customElements?.get("webview") !== undefined;
}

export function createWebviewHost(): WebviewHost {
  const entries = new Map<string, Entry>();
  let container: HTMLElement | null = null;

  function make(key: string, url: string): Entry {
    const supported = webviewSupported();
    const element = document.createElement(supported ? "webview" : "div");
    element.className = styles.page!;
    element.dataset.browserWebview = key;
    const entry: Entry = {
      element,
      session: null,
      listeners: new Set(),
      slot: null,
    };
    if (supported) {
      element.setAttribute("partition", PARTITION);
      element.setAttribute("allowpopups", "");
      // 빈 주소 칸도 guest가 붙도록 about:blank로 연다. 첫 주소는 main이 attach 때 다시 검사한다.
      element.setAttribute("src", url === "" ? "about:blank" : url);
      // Electron 44의 getWebContentsId는 did-attach 때 throw한다("dom-ready event emitted before this method").
      // 그러면 session이 생기지 않아 toolbar가 모두 꺼진 채였다. dom-ready부터 읽는다. page를 옮길 때마다
      // dom-ready가 오고 guest가 다시 붙으면 id가 바뀌므로, 바뀐 때만 알린다.
      element.addEventListener("dom-ready", () => {
        const session = guestSession(
          (element as WebviewElement).getWebContentsId(),
        );
        if (session === entry.session) return;
        entry.session = session;
        for (const listener of entry.listeners) listener(session);
      });
    } else {
      entry.session = `fake-wv-${key}`;
    }
    // page 안 click은 embedder DOM으로 올라오지 않는다. focus만 오므로 자리에 대신 알린다.
    element.addEventListener("focus", () => {
      entry.slot?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    element.style.visibility = "hidden";
    container?.append(element);
    return entry;
  }

  return {
    ensure(key, url) {
      if (!entries.has(key)) entries.set(key, make(key, url));
    },
    onSession(key, listener) {
      const entry = entries.get(key);
      if (entry === undefined) return () => {};
      if (entry.session !== null) listener(entry.session);
      entry.listeners.add(listener);
      return () => entry.listeners.delete(listener);
    },
    place(key, slot, rect, layer) {
      const entry = entries.get(key);
      if (entry === undefined) return;
      entry.slot = slot;
      const style = entry.element.style;
      if (rect === null || container === null) {
        style.visibility = "hidden";
        return;
      }
      const box = container.getBoundingClientRect();
      style.left = `${Math.round(rect.left - box.left)}px`;
      style.top = `${Math.round(rect.top - box.top)}px`;
      style.width = `${Math.round(rect.width)}px`;
      style.height = `${Math.round(rect.height)}px`;
      style.zIndex = zOf(layer);
      style.visibility = "visible";
    },
    page(key) {
      const entry = entries.get(key);
      if (entry === undefined || entry.session === null) return null;
      const element = entry.element as WebviewElement;
      try {
        return {
          url: element.getURL(),
          title: element.getTitle(),
          loading: element.isLoading(),
          canGoBack: element.canGoBack(),
          canGoForward: element.canGoForward(),
        };
      } catch {
        return null;
      }
    },
    release(key) {
      const entry = entries.get(key);
      if (entry === undefined) return;
      entries.delete(key);
      entry.element.remove();
    },
    keys: () => [...entries.keys()],
    attach(next) {
      container = next;
      if (next === null) return;
      for (const entry of entries.values()) {
        if (entry.element.parentElement !== next) next.append(entry.element);
      }
    },
  };
}

const WebviewHostContext = createContext<WebviewHost | null>(null);
export const WebviewHostProvider = WebviewHostContext.Provider;

export function useWebviewHost(): WebviewHost | null {
  return useContext(WebviewHostContext);
}

/** floats 층 안에 한 번 놓는 그릇. 다시 mount되지 않는 자리여야 한다(옮기면 page가 다시 load된다). */
export function WebviewLayer(props: { host: WebviewHost }) {
  const { host } = props;
  return <div className={styles.layer} ref={(node) => host.attach(node)} />;
}

/**
 * 탭을 그리는 자리가 부른다. 보이는 동안 자리의 사각형을 따라 그 탭의 <webview>를 옮긴다. 패널을
 * 옮기면 크기가 같아도 자리가 움직이므로 frame마다 잰다. 안 보이면 숨기기만 하고 지우지 않는다(탭이
 * layout에서 사라질 때 Workspace가 지운다).
 */
export function useWebviewSlot(input: {
  host: WebviewHost;
  /** false면 아무것도 만들지 않는다(native popup 탭). */
  enabled: boolean;
  key: string;
  url: string;
  ref: { readonly current: HTMLElement | null };
  shown: boolean;
  layer: number;
  onSession(session: string): void;
}): void {
  const { host, enabled, key, ref, shown, layer } = input;
  const firstUrl = useRef(input.url);
  const onSession = useRef(input.onSession);
  onSession.current = input.onSession;

  useEffect(() => {
    if (!enabled) return;
    host.ensure(key, firstUrl.current);
    return host.onSession(key, (session) => onSession.current(session));
  }, [host, enabled, key]);

  useEffect(() => {
    if (!enabled) return;
    const element = ref.current;
    if (!shown || element === null) {
      host.place(key, element, null, layer);
      return;
    }
    let last = "";
    let frame = 0;
    const tick = () => {
      const rect = element.getBoundingClientRect();
      const next = `${rect.left},${rect.top},${rect.width},${rect.height}`;
      if (next !== last) {
        last = next;
        host.place(
          key,
          element,
          rect.width > 0 && rect.height > 0 ? rect : null,
          layer,
        );
      }
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      host.place(key, element, null, layer);
    };
  }, [host, enabled, key, ref, shown, layer]);
}
