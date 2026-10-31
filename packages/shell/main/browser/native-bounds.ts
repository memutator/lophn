// browser native view(크기 준 popup·DevTools)의 배치. renderer가 ResizeObserver로 보낸 칸 사각형
// (CSS pixel)을 창 DIP로 바꾸고 창 본문과 교차한 영역에만 붙인다. 앱 view·artifact view는
// `<webview>`라 위치를 renderer CSS가 정한다.
// - bounds 적용은 모든 view를 함께 16ms마다 한 번으로 묶는다(drag·resize·스크롤).
// - 숨김은 묶지 않고 바로 한다. 탭 전환은 옛 view를 먼저 숨기고 새 view는 bounds가 오고
//   준비된 뒤에 붙는다. 그래서 두 view가 같은 칸에 겹친 frame이 없다.
// - 본문과 교차가 없으면(스크롤 밖) 뗀다.
// - view는 연 창의 renderer만 다룬다. 다른 창의 view는 없는 view와 같은 답이다.
import { failure, type Outcome } from "../app-frame/app-connection.ts";
import type { FrameTimer } from "../app-frame/frame.ts";
import type { BrowserViews } from "./registry.ts";
import type { ViewBounds } from "./native-view.ts";

const EMPTY_BOUNDS: ViewBounds = { x: 0, y: 0, width: 0, height: 0 };

// renderer가 몇 번을 보내도 main은 이 간격마다 한 번만 bounds를 적용한다.
const BOUNDS_FRAME_MS = 16;

interface WindowGeometry {
  /** native view가 놓일 수 있는 창 본문(DIP, 상단 바 아래). 창이 없으면 undefined다. */
  body(window: string): ViewBounds | undefined;
  /** shell renderer의 page zoom. CSS pixel과 창 DIP의 비율이다. */
  zoom(window: string): number;
}

type Generation = Outcome<{ generation: number }>;

type FramePort = Pick<
  BrowserViews,
  "has" | "owner" | "setBounds" | "hide" | "move"
>;

/**
 * renderer는 page의 CSS pixel로 보내고 view bounds는 창 DIP다. page zoom만큼 다르므로 곱한다.
 * 크기가 아니라 가장자리를 반올림해 view가 자리에서 한 pixel도 밀리지 않는다.
 */
function toDip(css: ViewBounds, zoom: number): ViewBounds {
  if (!Number.isFinite(zoom) || zoom <= 0 || zoom === 1) return css;
  const x = Math.round(css.x * zoom);
  const y = Math.round(css.y * zoom);
  return {
    x,
    y,
    width: Math.max(0, Math.round((css.x + css.width) * zoom) - x),
    height: Math.max(0, Math.round((css.y + css.height) * zoom) - y),
  };
}

/** 두 사각형의 교차. 없으면 넓이 0이다. */
function intersect(a: ViewBounds, b: ViewBounds): ViewBounds {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return { x, y, width: 0, height: 0 };
  return { x, y, width: right - x, height: bottom - y };
}

interface Pending {
  window: string;
  bounds: ViewBounds;
  layer: number;
  waiters: ((result: Generation) => void)[];
}

/** browser native view의 위치·숨김·창 옮기기. browser 탭의 native popup·DevTools만 쓴다. */
export interface NativeBounds {
  /** 이 frame의 마지막 bounds로 둔다. 적용한 뒤의 generation으로 끝난다. */
  setBounds(
    window: string,
    view_session: string,
    bounds: ViewBounds,
    layer: number,
  ): Promise<Generation>;
  /** 바로 뗀다. 하나라도 이 창의 view가 아니면 아무것도 하지 않는다. */
  hide(window: string, view_sessions: readonly string[]): Generation;
  /** 모두 window의 native view인가. */
  owns(window: string, view_sessions: readonly string[]): boolean;
  /** 모두 from 창의 view이고 to 창이 열려 있을 때만 옮긴다. */
  move(
    from: string,
    to: string,
    view_sessions: readonly string[],
  ): Outcome<null>;
  /** 닫힌 창의 기다리던 bounds를 버린다. view 폐기는 registry.closeWindow가 한다. */
  closeWindow(window: string): void;
  dispose(): void;
}

export function createNativeBounds(deps: {
  frame: FramePort;
  geometry: WindowGeometry;
  timer: FrameTimer;
}): NativeBounds {
  const pending = new Map<string, Pending>();
  let handle: unknown;

  const notOpen = () => failure("invalid_input", "view is not open");
  const owned = (window: string, view_session: string) =>
    deps.frame.owner(view_session) === window;

  function apply(view_session: string, item: Pending): Generation {
    const body = deps.geometry.body(item.window);
    if (body === undefined) return failure("unavailable", "window is not open");
    const dip = toDip(item.bounds, deps.geometry.zoom(item.window));
    return deps.frame.setBounds(view_session, intersect(dip, body), item.layer);
  }

  // 한 frame에 모인 모든 view의 마지막 bounds를 함께 적용한다.
  function flush(): void {
    handle = undefined;
    const batch = [...pending];
    pending.clear();
    for (const [view_session, item] of batch) {
      const result = apply(view_session, item);
      for (const resolve of item.waiters) resolve(result);
    }
  }

  // 기다리던 bounds를 버린다. 숨김·폐기가 늦은 bounds보다 앞선다.
  function cancel(view_session: string, result: () => Generation): void {
    const item = pending.get(view_session);
    if (item === undefined) return;
    pending.delete(view_session);
    const settled = result();
    for (const resolve of item.waiters) resolve(settled);
    if (pending.size === 0 && handle !== undefined) {
      deps.timer.clear(handle);
      handle = undefined;
    }
  }

  return {
    setBounds(window, view_session, bounds, layer) {
      if (!owned(window, view_session)) return Promise.resolve(notOpen());
      return new Promise((resolve) => {
        const item = pending.get(view_session) ?? {
          window,
          bounds: EMPTY_BOUNDS,
          layer: 0,
          waiters: [],
        };
        item.bounds = bounds;
        item.layer = layer;
        item.waiters.push(resolve);
        pending.set(view_session, item);
        handle ??= deps.timer.set(flush, BOUNDS_FRAME_MS);
      });
    },

    hide(window, view_sessions) {
      if (!view_sessions.every((view) => owned(window, view))) {
        return notOpen();
      }
      let generation = 0;
      for (const view_session of view_sessions) {
        const result = deps.frame.hide(view_session);
        cancel(view_session, () => result);
        if (!result.ok) return result;
        generation = Math.max(generation, result.value.generation);
      }
      return { ok: true, value: { generation } };
    },

    owns(window, view_sessions) {
      return view_sessions.every((view) => owned(window, view));
    },

    move(from, to, view_sessions) {
      if (!view_sessions.every((view) => owned(from, view))) return notOpen();
      if (deps.geometry.body(to) === undefined) {
        return failure("invalid_input", "window is not open");
      }
      for (const view_session of view_sessions) {
        cancel(view_session, notOpen);
        const result = deps.frame.move(view_session, from, to);
        if (!result.ok) return result;
      }
      return { ok: true, value: null };
    },

    closeWindow(window) {
      for (const [view_session, item] of [...pending]) {
        if (item.window === window) cancel(view_session, notOpen);
      }
    },

    dispose() {
      for (const view_session of [...pending.keys()]) {
        cancel(view_session, notOpen);
      }
    },
  };
}
