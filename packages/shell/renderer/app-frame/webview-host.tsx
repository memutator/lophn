// 창마다 하나인 <webview> 그릇. browser 탭 page, 앱 화면, artifact 화면이 모두 이 그릇에 산다.
// <webview>를 DOM에서 다른 부모로 옮기면 guest가 다시 만들어져 page가 다시 load되므로, key당 한 번만
// 만들고 옮기지 않는다. 화면을 그리는 자리(pane 칸, floated 패널 몸통, 카드, 앱 공간 본문)는 자기
// 사각형만 알리고, 여기서 위치·크기·z-index·보임만 바꾼다. 그릇은 floats 층과 같은 stacking context
// 안에 있어 pane 화면은 모든 패널 아래, floated 화면은 자기 패널 바로 위에 온다(floats.tsx가 패널
// 층을 2배로 둔다).
import { createContext, useContext, useEffect, useRef } from "react";

import styles from "./webview-host.module.css";

// main의 BROWSER_PARTITION(main/browser/session.ts)과 같은 이름이다. 다르면 main이 attach를 거절한다.
const PARTITION = "persist:lophn-browser";

/** guest 탭의 view_session. main이 같은 규칙으로 guest를 부른다(`bt-webview-main`). */
export function guestSession(contentsId: number): string {
  return `wv-${contentsId}`;
}

/** 이 그릇이 담는 화면의 종류. browser만 붙일 때 값을 직접 적고, 앱·artifact는 main이 정한다. */
export type WebviewKind = "browser" | "app" | "artifact";

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

/** 자리의 사각형(화면 좌표). 자리 밖으로 잘린 뒤의 값이다. */
export interface SlotRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

interface Entry {
  element: HTMLElement;
  kind: WebviewKind;
  /** 지금 element가 만들어진 src. 다르면 element를 새로 만든다(앱·artifact). */
  src: string;
  session: string | null;
  listeners: Set<(session: string) => void>;
  /** 이 화면을 그리는 자리. focus가 page로 들어오면 그 자리에 focusin을 보내 칸·패널이 focus를 안다. */
  slot: HTMLElement | null;
  rect: SlotRect | null;
  layer: number;
  /** 앱·artifact는 첫 load가 끝날 때까지 보이지 않는다(예전 native view의 "첫 load 전 attach 없음"). */
  loaded: boolean;
}

export interface WebviewHost {
  /**
   * key의 <webview>를 만든다(이미 있으면 그대로). 앱·artifact의 src가 element를 만든 값과 다르면
   * 그 자리에서 element를 새로 만든다. browser의 src는 처음 만들 때만 쓴다.
   */
  ensure(key: string, src: string, kind: WebviewKind): void;
  /** guest가 붙으면 session을 알린다. 이미 붙었으면 바로 부른다. */
  onSession(key: string, listener: (session: string) => void): () => void;
  /** 자리 사각형(그릇 기준이 아닌 화면 좌표)과 층. null이면 숨긴다. */
  place(
    key: string,
    slot: HTMLElement | null,
    rect: SlotRect | null,
    layer: number,
  ): void;
  page(key: string): GuestPage | null;
  release(key: string): void;
  keys(): readonly string[];
  /** 그릇 요소. WebviewLayer가 붙인다. */
  attach(container: HTMLElement | null): void;
}

// pane 화면(층 0)은 pane의 경계 잡는 띠(--z-sticky) 아래이고, 층 L의 패널은 --z-sticky + 2L, floated
// 화면은 자기 패널 바로 위다. floats 층이 stacking context가 아니라서 이 값들이 pane 요소와 직접 겹쳐 쌓인다.
function zOf(layer: number): string {
  return layer === 0 ? "1" : `calc(var(--z-sticky) + ${layer * 2 + 1})`;
}

// Electron 창에서 webviewTag가 켜져 있을 때만 <webview>가 정의된다. dev mock·gallery는 빈 자리를 그린다.
function webviewSupported(): boolean {
  return globalThis.customElements?.get("webview") !== undefined;
}

function createElement(key: string, kind: WebviewKind): HTMLElement {
  const element = document.createElement(
    webviewSupported() ? "webview" : "div",
  );
  element.className = styles.page!;
  element.dataset.webviewKey = key;
  element.dataset.webviewKind = kind;
  element.style.visibility = "hidden";
  return element;
}

/** 화면 자리를 자르는 조상(칸·카드 목록의 스크롤 영역). 그 밖은 보이지 않는다. */
function clipAncestors(
  element: HTMLElement,
): { readonly element: Element; readonly x: boolean; readonly y: boolean }[] {
  const view = element.ownerDocument.defaultView;
  const found: { element: Element; x: boolean; y: boolean }[] = [];
  for (
    let node = element.parentElement;
    node !== null;
    node = node.parentElement
  ) {
    if (view === null) break;
    const style = view.getComputedStyle(node);
    const x = style.overflowX !== "" && style.overflowX !== "visible";
    const y = style.overflowY !== "" && style.overflowY !== "visible";
    if (x || y) found.push({ element: node, x, y });
  }
  return found;
}

/** 자리 사각형을 스크롤 경계 안으로 자른 값. 다 가려졌으면 null이다. */
function visibleRect(
  element: HTMLElement,
  clips: readonly {
    readonly element: Element;
    readonly x: boolean;
    readonly y: boolean;
  }[],
  output: SlotRect,
): SlotRect | null {
  const box = element.getBoundingClientRect();
  let left = box.left;
  let top = box.top;
  let right = box.right;
  let bottom = box.bottom;
  for (const clip of clips) {
    const edge = clip.element.getBoundingClientRect();
    if (clip.x) {
      left = Math.max(left, edge.left);
      right = Math.min(right, edge.right);
    }
    if (clip.y) {
      top = Math.max(top, edge.top);
      bottom = Math.min(bottom, edge.bottom);
    }
  }
  if (right <= left || bottom <= top) return null;
  output.left = left;
  output.top = top;
  output.width = right - left;
  output.height = bottom - top;
  return output;
}

export function createWebviewHost(): WebviewHost {
  const entries = new Map<string, Entry>();
  let container: HTMLElement | null = null;

  function apply(entry: Entry): void {
    const style = entry.element.style;
    if (
      entry.rect === null ||
      container === null ||
      (entry.kind !== "browser" && !entry.loaded)
    ) {
      style.visibility = "hidden";
      return;
    }
    const box = container.getBoundingClientRect();
    style.left = `${Math.round(entry.rect.left - box.left)}px`;
    style.top = `${Math.round(entry.rect.top - box.top)}px`;
    style.width = `${Math.round(entry.rect.width)}px`;
    style.height = `${Math.round(entry.rect.height)}px`;
    style.zIndex = zOf(entry.layer);
    style.visibility = "visible";
  }

  // element에 거는 listener. 앱·artifact는 마지막 load(실패 포함) 전까지 숨긴 채 둔다.
  function bind(entry: Entry, element: HTMLElement): void {
    // page 안 click은 embedder DOM으로 올라오지 않는다. focus만 오므로 자리에 대신 알린다.
    element.addEventListener("focus", () => {
      entry.slot?.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    });
    if (entry.kind !== "browser") {
      const loaded = () => {
        if (entry.element !== element) return;
        entry.loaded = true;
        apply(entry);
      };
      element.addEventListener("did-finish-load", loaded);
      element.addEventListener("did-fail-load", loaded);
      return;
    }
    if (!webviewSupported()) {
      entry.session = `fake-wv-${element.dataset.webviewKey ?? ""}`;
      return;
    }
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
  }

  function make(key: string, src: string, kind: WebviewKind): Entry {
    const entry: Entry = {
      element: createElement(key, kind),
      kind,
      src,
      session: null,
      listeners: new Set(),
      slot: null,
      rect: null,
      layer: 0,
      // webviewTag가 없는 환경(dev mock·gallery)은 빈 div가 곧 화면이라 load를 기다리지 않는다.
      loaded: kind === "browser" || !webviewSupported(),
    };
    bind(entry, entry.element);
    if (kind === "browser") {
      entry.element.setAttribute("partition", PARTITION);
      entry.element.setAttribute("allowpopups", "");
      // 빈 주소 칸도 guest가 붙도록 about:blank로 연다. 첫 주소는 main이 attach 때 다시 검사한다.
      entry.element.setAttribute("src", src === "" ? "about:blank" : src);
    } else {
      // 앱·artifact는 주소만 적는다. partition·preload·allowpopups는 main이 붙일 때 정한다.
      entry.element.setAttribute("src", src);
    }
    container?.append(entry.element);
    return entry;
  }

  // main이 새 화면을 만들었다(열기, crash 뒤 다시 열기). 같은 key 자리에서 element만 새로 만든다.
  function replace(entry: Entry, key: string, src: string): void {
    const next = createElement(key, entry.kind);
    bind(entry, next);
    next.setAttribute("src", src);
    entry.element.remove();
    entry.element = next;
    entry.src = src;
    entry.session = null;
    entry.loaded = !webviewSupported();
    if (container !== null) container.append(next);
    apply(entry);
  }

  return {
    ensure(key, src, kind) {
      const existing = entries.get(key);
      if (existing === undefined) {
        entries.set(key, make(key, src, kind));
        return;
      }
      if (existing.kind !== kind) {
        existing.element.remove();
        entries.set(key, make(key, src, kind));
        return;
      }
      // browser element는 tab마다 하나이고 주소는 main이 민다. 앱·artifact는 주소가 곧 신원이다.
      if (kind !== "browser" && existing.src !== src) {
        replace(existing, key, src);
      }
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
      entry.rect = rect;
      entry.layer = layer;
      apply(entry);
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

const ViewLayerContext = createContext(0);

/** 이 아래 화면의 층. 0 = pane 화면, 1.. = floated 화면(floats 배열 index + 1). 기본 0. */
export const ViewLayerProvider = ViewLayerContext.Provider;

export function useViewLayer(): number {
  return useContext(ViewLayerContext);
}

/** floats 층 안에 한 번 놓는 그릇. 다시 mount되지 않는 자리여야 한다(옮기면 page가 다시 load된다). */
export function WebviewLayer(props: { host: WebviewHost }) {
  const { host } = props;
  return <div className={styles.layer} ref={(node) => host.attach(node)} />;
}

/**
 * 화면을 그리는 자리가 부른다. 보이는 동안 자리의 사각형을 따라 그 화면의 <webview>를 옮긴다. 패널을
 * 옮기면 크기가 같아도 자리가 움직이므로 frame마다 잰다. 안 보이면 숨기기만 하고 지우지 않는다(화면이
 * layout에서 사라질 때 Workspace가 지운다).
 */
export function useWebviewSlot(input: {
  host: WebviewHost | null;
  kind: WebviewKind;
  /** false면 아무것도 만들지 않는다(native popup 탭, 아직 view가 없는 자리). */
  enabled: boolean;
  key: string;
  /** element를 만들 주소. 앱·artifact는 이 값이 바뀌면 element를 새로 만든다. */
  src: string;
  ref: { readonly current: HTMLElement | null };
  shown: boolean;
  layer: number;
  onSession?(session: string): void;
}): void {
  const { host, kind, enabled, key, ref, shown, layer, src } = input;
  const onSession = useRef(input.onSession);
  onSession.current = input.onSession;
  const wantsSession = input.onSession !== undefined;

  useEffect(() => {
    if (host === null || !enabled) return;
    host.ensure(key, src, kind);
    if (!wantsSession) return;
    return host.onSession(key, (session) => onSession.current?.(session));
  }, [host, kind, enabled, key, src, wantsSession]);

  useEffect(() => {
    if (host === null || !enabled) return;
    const element = ref.current;
    if (!shown || element === null) {
      host.place(key, element, null, layer);
      return;
    }
    const clips = clipAncestors(element);
    const rect: SlotRect = { left: 0, top: 0, width: 0, height: 0 };
    let last = "";
    let frame = 0;
    const tick = () => {
      const visible = visibleRect(element, clips, rect);
      const next =
        visible === null
          ? ""
          : `${Math.round(visible.left)},${Math.round(
              visible.top,
            )},${Math.round(visible.width)},${Math.round(visible.height)}`;
      if (next !== last) {
        last = next;
        host.place(key, element, visible, layer);
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
