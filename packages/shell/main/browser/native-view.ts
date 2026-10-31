// browser의 native view 하나(크기 준 popup·DevTools). 앱 view·artifact view는 renderer의
// `<webview>`라 위치·보임을 renderer CSS가 정하고, native view는 이 폴더만 쓴다.
// 붙이기·떼기·숨김 규칙은 createPlacement 하나가 정한다:
// - 보이라는 요청(빈 bounds가 아닌 bounds)이 있고 지금 contents의 첫 load가 끝났을 때만 붙인다.
//   준비 전에 온 bounds는 마지막 것만 기억한다.
// - 다시 붙일 때만 generation이 오른다. 숨김은 바로 떼고 generation을 올린다.
// - 뗀 view가 키보드 focus를 가졌으면 그 창의 shell renderer로 돌린다.
import { failure, type Outcome } from "../app-frame/app-connection.ts";
import type { ViewEvent } from "../app-frame/diagnostics.ts";

export interface ViewBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Electron native view 하나. */
export interface NativeViewContents {
  readonly id: number;
  load(url: string): Promise<void>;
  destroy(): void;
}

/** 창과 native view를 다루는 adapter. */
export interface NativeViewHost {
  hasWindow(window: string): boolean;
  /** 창 본문에 붙이거나 bounds를 옮긴다. layer가 클수록 위다(0 = pane view). 창이 없으면 false다. */
  attach(
    window: string,
    view: NativeViewContents,
    bounds: ViewBounds,
    layer: number,
  ): boolean;
  detach(window: string, view: NativeViewContents): void;
  /** 이 view가 지금 키보드 focus를 가졌는가. */
  focused?(view: NativeViewContents): boolean;
  /** 키보드 focus를 그 창의 shell renderer로 돌린다. */
  focusShell?(window: string): void;
}

/** 넓이가 없는 bounds다. 붙일 자리가 없으니 보이지 않는 view로 둔다. */
export function boundsEmpty(bounds: ViewBounds): boolean {
  return bounds.width <= 0 || bounds.height <= 0;
}

export interface Placed {
  window: string;
  bounds: ViewBounds;
  // 쌓는 층. 0 = pane view, 1.. = floated view. 클수록 위다.
  layer: number;
  contents: NativeViewContents;
  generation: number;
  // renderer가 보이라고 한 view다. 숨김 요청이나 빈 bounds면 false다.
  shown: boolean;
  // 지금 contents의 첫 load가 끝났다.
  ready: boolean;
  // 지금 contents를 한 번 붙였다.
  placed: boolean;
  attached: boolean;
}

type Generation = Outcome<{ generation: number }>;

export function createPlacement<T extends Placed>(deps: {
  views: Pick<
    NativeViewHost,
    "hasWindow" | "attach" | "detach" | "focused" | "focusShell"
  >;
  record(entry: T, event: ViewEvent): void;
}) {
  function place(entry: T): void {
    if (!entry.shown || !entry.ready || entry.attached) return;
    if (
      !deps.views.attach(
        entry.window,
        entry.contents,
        entry.bounds,
        entry.layer,
      )
    )
      return;
    entry.attached = true;
    if (entry.placed) entry.generation += 1;
    entry.placed = true;
    deps.record(entry, "attached");
  }

  function detach(entry: T): void {
    if (!entry.attached) return;
    const focused = deps.views.focused?.(entry.contents) === true;
    deps.views.detach(entry.window, entry.contents);
    entry.attached = false;
    if (focused) deps.views.focusShell?.(entry.window);
  }

  function hide(entry: T): Generation {
    entry.shown = false;
    if (entry.attached) {
      detach(entry);
      entry.generation += 1;
      deps.record(entry, "hidden");
    }
    return { ok: true, value: { generation: entry.generation } };
  }

  return {
    place,
    detach,
    hide,
    /** 새 contents를 만들었다. 첫 load가 끝나기 전에는 붙이지 않는다. */
    mounted(entry: T): void {
      entry.ready = false;
      entry.placed = false;
    },
    /** 지금 contents의 첫 load가 끝났다(실패도). */
    loaded(entry: T): void {
      entry.ready = true;
      place(entry);
    },
    /** contents를 부수기 전이다. */
    unmounted(entry: T): void {
      detach(entry);
      entry.ready = false;
    },
    setBounds(entry: T, bounds: ViewBounds, layer: number): Generation {
      if (!deps.views.hasWindow(entry.window)) {
        return failure("unavailable", "window is not open");
      }
      entry.bounds = bounds;
      entry.layer = layer;
      if (boundsEmpty(bounds)) return hide(entry);
      entry.shown = true;
      if (
        entry.attached &&
        !deps.views.attach(entry.window, entry.contents, bounds, layer)
      ) {
        return failure("unavailable", "window is not open");
      }
      place(entry);
      return { ok: true, value: { generation: entry.generation } };
    },
  };
}
