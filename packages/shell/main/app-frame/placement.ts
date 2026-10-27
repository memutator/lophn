// 앱 view 하나를 창 본문에 붙이고 떼는 규칙. registry가 view마다
// 부르고, 실제 native 붙이기·떼기는 이 함수들만 한다.
// - 보이라는 요청(빈 bounds가 아닌 bounds)이 있고 지금 contents의 첫 load가 끝났을 때만 붙인다.
//   준비 전에 온 bounds는 마지막 것만 기억한다.
// - 다시 붙일 때만 generation이 오른다. 숨김은 바로 떼고 generation을 올린다.
// - 뗀 view가 키보드 focus를 가졌으면 그 창의 shell renderer로 돌린다.
import { failure, type Outcome } from "./app-connection.ts";
import type { ViewEvent } from "./diagnostics.ts";
import {
  type AppViewContents,
  type AppViewHost,
  boundsEmpty,
  type ViewBounds,
} from "./view-model.ts";

export interface Placed {
  window: string;
  bounds: ViewBounds;
  // 쌓는 층. 0 = pane view, 1.. = floated view. 클수록 위다.
  layer: number;
  contents: AppViewContents;
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
    AppViewHost,
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
