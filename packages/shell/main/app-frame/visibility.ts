// 앱 native view 배치. renderer가 ResizeObserver로 보낸 칸·카드 사각형(CSS pixel)을 창 DIP로
// 바꾸고 창 본문과 교차한 영역에만 붙인다. 붙이기·숨기기·폐기는 registry 한 곳이 하고 이
// 모듈은 그 앞의 순서를 정한다:
// - bounds 적용은 모든 view를 함께 16ms마다 한 번으로 묶는다(drag·resize·스크롤).
// - 숨김·폐기는 묶지 않고 바로 한다. 탭 전환은 옛 view를 먼저 숨기고 새 view는 bounds가 오고
//   준비된 뒤에 붙는다. 그래서 두 view가 같은 칸에 겹친 frame이 없다.
// - 본문과 교차가 없으면(스크롤 밖 카드) 뗀다. 숨긴 view의 키보드 focus는 shell로 돌린다.
// - view는 연 창의 renderer만 다룬다. 다른 창의 view는 없는 view와 같은 답이다.
import { failure, type Outcome } from "./app-connection.ts";
import type { FrameTimer } from "./frame.ts";
import type {
  AppFrameService,
  AppFrameViewState,
  CardDisplay,
  ViewBounds,
} from "./registry.ts";

const EMPTY_BOUNDS: ViewBounds = { x: 0, y: 0, width: 0, height: 0 };

// renderer가 몇 번을 보내도 main은 이 간격마다 한 번만 bounds를 적용한다.
const BOUNDS_FRAME_MS = 16;

interface WindowGeometry {
  /** 앱 view가 놓일 수 있는 창 본문(DIP, 상단 바 아래). 창이 없으면 undefined다. */
  body(window: string): ViewBounds | undefined;
  /** shell renderer의 page zoom. CSS pixel과 창 DIP의 비율이다. */
  zoom(window: string): number;
}

interface AppViewOpenRequest {
  app: string;
  mode: "live" | "preview";
  release?: string;
  screen: string;
  size: "full" | "panel" | "card";
  /** 카드의 message·block 표시 참조. 카드만 싣는다. */
  card?: CardDisplay;
}

type Generation = Outcome<{ generation: number }>;

/**
 * renderer는 page의 CSS pixel로 보내고 WebContentsView bounds는 창 DIP다. page zoom만큼
 * 다르므로 곱한다. 크기가 아니라 가장자리를 반올림해 view가 자리에서 한 pixel도 밀리지 않는다.
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

export function createViewVisibility(deps: {
  frame: Pick<
    AppFrameService,
    | "open"
    | "setBounds"
    | "hide"
    | "close"
    | "reopen"
    | "owner"
    | "move"
  >;
  geometry: WindowGeometry;
  timer: FrameTimer;
}) {
  const pending = new Map<string, Pending>();
  let handle: unknown;

  const notOpen = () => failure("invalid_input", "view is not open");
  const owned = (window: string, view_session: string) =>
    deps.frame.owner(view_session) === window;

  function apply(view_session: string, item: Pending): Generation {
    const body = deps.geometry.body(item.window);
    if (body === undefined) return failure("unavailable", "window is not open");
    const dip = toDip(item.bounds, deps.geometry.zoom(item.window));
    return deps.frame.setBounds(
      view_session,
      intersect(dip, body),
      item.layer,
    );
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
    /** 창에 앱 view를 연다. bounds가 오기 전에는 붙이지 않는다. */
    openApp(
      window: string,
      input: AppViewOpenRequest,
    ): Promise<Outcome<AppFrameViewState>> {
      return deps.frame.open({
        app: input.app,
        mode: input.mode,
        release: input.release ?? null,
        screen: input.screen,
        size: input.size,
        parentWindow: window,
        bounds: EMPTY_BOUNDS,
      }, input.card);
    },

    /** 이 frame의 마지막 bounds로 둔다. 적용한 뒤의 generation으로 끝난다. */
    setBounds(
      window: string,
      view_session: string,
      bounds: ViewBounds,
      layer: number,
    ): Promise<Generation> {
      if (!owned(window, view_session)) return Promise.resolve(notOpen());
      return new Promise((resolve) => {
        const item = pending.get(view_session) ??
          { window, bounds, layer, waiters: [] };
        item.bounds = bounds;
        item.layer = layer;
        item.waiters.push(resolve);
        pending.set(view_session, item);
        handle ??= deps.timer.set(flush, BOUNDS_FRAME_MS);
      });
    },

    /** 바로 뗀다. 하나라도 이 창의 view가 아니면 아무것도 하지 않는다. */
    hide(window: string, view_sessions: readonly string[]): Generation {
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

    /** 모두 window의 view인가. */
    owns(window: string, view_sessions: readonly string[]): boolean {
      return view_sessions.every((view) => owned(window, view));
    },

    /**
     * 모두 from 창의 view이고 to 창이 열려 있을 때만 옮긴다(아니면 아무것도 옮기지 않는다).
     * 기다리던 bounds는 옛 창 기준이라 버린다. 옮긴 view는 새 창 renderer가 bounds를 보내면 붙는다.
     */
    move(
      from: string,
      to: string,
      view_sessions: readonly string[],
    ): Outcome<null> {
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

    /** 바로 폐기한다. */
    close(window: string, view_session: string): Outcome<null> {
      if (!owned(window, view_session)) return notOpen();
      cancel(view_session, notOpen);
      deps.frame.close(view_session);
      return { ok: true, value: null };
    },

    /**
     * crash·멈춘 view를 지금 연결로 새로 연다(crash.ts). 기다리던 bounds는 그대로 두고 마지막
     * 자리에 새 contents가 준비되면 붙는다.
     */
    reopen(window: string, view_session: string): Outcome<AppFrameViewState> {
      if (!owned(window, view_session)) return notOpen();
      return deps.frame.reopen(view_session);
    },

    /** 닫힌 창의 기다리던 bounds를 버린다. view 폐기는 registry.closeWindow가 한다. */
    closeWindow(window: string): void {
      for (const [view_session, item] of [...pending]) {
        if (item.window === window) cancel(view_session, notOpen);
      }
    },

    dispose(): void {
      for (const view_session of [...pending.keys()]) {
        cancel(view_session, notOpen);
      }
    },
  };
}

export type ViewVisibility = ReturnType<typeof createViewVisibility>;
