// browser의 native view(크기를 준 popup, DevTools) 자리의 사각형을 main에 보낸다. renderer는 사각형만
// 정하고 붙이기·숨기기·폐기는 main이 한다. 보낼 사각형은 자리를 칸·스크롤 경계로 자른 것이다. 남은
// 넓이가 없으면 숨긴다. 앱·artifact 화면은 <webview> 그릇(app-frame/webview-host.tsx)이 그리므로
// 여기 쓰지 않는다.
import { useEffect, useRef } from "react";

import type { LophnShellViewsApi } from "../../ipc/app-frame.ts";
import { useViewLayer } from "../app-frame/webview-host.tsx";

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

function empty(rect: Rect): boolean {
  return rect.width <= 0 || rect.height <= 0;
}

/** 가장자리를 반올림한 정수 사각형. 크기를 반올림하면 이웃 칸과 한 pixel 겹칠 수 있다. */
function rectOf(element: Element): Rect {
  const box = element.getBoundingClientRect();
  const x = Math.round(box.left);
  const y = Math.round(box.top);
  return {
    x,
    y,
    width: Math.max(0, Math.round(box.right) - x),
    height: Math.max(0, Math.round(box.bottom) - y),
  };
}

function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return EMPTY_RECT;
  return { x, y, width: right - x, height: bottom - y };
}

/** 자리를 경계들로 자른 사각형. */
function visibleRect(region: Rect, clips: readonly Rect[]): Rect {
  let rect = region;
  for (const clip of clips) {
    rect = intersect(rect, clip);
    if (empty(rect)) return EMPTY_RECT;
  }
  return rect;
}

/** 내용을 자르는 조상(칸·스크롤 영역). 그 밖은 보이지 않는다. */
function clipAncestors(element: Element): Element[] {
  const view = element.ownerDocument.defaultView;
  const found: Element[] = [];
  for (
    let node = element.parentElement;
    node !== null && view !== null;
    node = node.parentElement
  ) {
    const style = view.getComputedStyle(node);
    if (
      (style.overflowX !== "" && style.overflowX !== "visible") ||
      (style.overflowY !== "" && style.overflowY !== "visible")
    ) {
      found.push(node);
    }
  }
  return found;
}

interface BoundsRelayDeps {
  element: Element;
  /** 이 자리의 층(0 = pane view, 1.. = floated view). 읽을 때마다 최신 값이다. */
  layer(): number;
  send(rect: Rect, layer: number): void;
  hide(): void;
  frame: {
    request(callback: () => void): number;
    cancel(handle: number): void;
  };
  /** 크기 변화 관찰. 돌려준 함수로 끊는다. */
  observe(elements: readonly Element[], callback: () => void): () => void;
}

/** 자리의 보이는 사각형이 바뀔 때마다 frame마다 한 번 main에 알린다. */
export function startBoundsRelay(deps: BoundsRelayDeps): {
  refresh(): void;
  stop(): void;
} {
  const clips = clipAncestors(deps.element);
  let last: { rect: Rect; layer: number } | undefined;
  let handle: number | undefined;
  let stopped = false;

  function measure(): void {
    handle = undefined;
    if (stopped) return;
    const layer = deps.layer();
    const next = visibleRect(rectOf(deps.element), clips.map(rectOf));
    if (
      last !== undefined &&
      last.layer === layer &&
      last.rect.x === next.x &&
      last.rect.y === next.y &&
      last.rect.width === next.width &&
      last.rect.height === next.height
    )
      return;
    last = { rect: next, layer };
    if (empty(next)) deps.hide();
    else deps.send(next, layer);
  }

  function schedule(): void {
    if (stopped || handle !== undefined) return;
    handle = deps.frame.request(measure);
  }

  const view = deps.element.ownerDocument.defaultView;
  // 크기는 그대로인데 위치만 바뀌는 경우(sidebar 접기, 창 이동)도 본다.
  view?.addEventListener("resize", schedule);
  deps.element.ownerDocument.addEventListener("scroll", schedule, true);
  const unobserve = deps.observe([deps.element, ...clips], schedule);
  schedule();
  return {
    refresh: schedule,
    stop() {
      stopped = true;
      if (handle !== undefined) deps.frame.cancel(handle);
      view?.removeEventListener("resize", schedule);
      deps.element.ownerDocument.removeEventListener("scroll", schedule, true);
      unobserve();
    },
  };
}

/**
 * 보이는 동안만 자리의 사각형을 main에 보낸다. 안 보이게 되면 cleanup에서 바로 숨긴다. main은
 * bounds를 받기 전의 view를 붙이지 않으므로 처음부터 안 보이는 view는 숨길 것이 없다. 층만
 * 바뀌면 view를 숨기지 않고 새 층을 다시 보낸다(effect를 다시 돌리면 hide로 깜빡인다).
 */
export function useViewBounds(input: {
  views: LophnShellViewsApi;
  viewSession: string | null;
  shown: boolean;
  ref: { readonly current: HTMLElement | null };
}): void {
  const { views, viewSession, shown, ref } = input;
  const layer = useViewLayer();
  const layerRef = useRef(layer);
  layerRef.current = layer;
  const relayRef = useRef<{ refresh(): void } | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (viewSession === null || element === null || !shown) return;
    const hide = () =>
      void views
        .setViewsHidden({ view_sessions: [viewSession] })
        .catch(() => {});
    const relay = startBoundsRelay({
      element,
      layer: () => layerRef.current,
      send: (bounds: Rect, nextLayer: number) =>
        void views
          .setViewBounds({
            view_session: viewSession,
            bounds,
            layer: nextLayer,
          })
          .catch(() => {}),
      hide,
      frame: {
        request: (callback) => requestAnimationFrame(callback),
        cancel: (handle) => cancelAnimationFrame(handle),
      },
      observe(elements, callback) {
        const observer = new ResizeObserver(callback);
        for (const target of elements) observer.observe(target);
        return () => observer.disconnect();
      },
    });
    relayRef.current = relay;
    return () => {
      relayRef.current = null;
      relay.stop();
      hide();
    };
  }, [views, viewSession, shown, ref]);

  useEffect(() => {
    relayRef.current?.refresh();
  }, [layer]);
}
