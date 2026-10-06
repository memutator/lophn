// 앱 view 자리의 사각형을 main에 보낸다(shell/app-frame#R25–R29, R35, R36). renderer는 사각형만
// 정하고 붙이기·숨기기·폐기는 main이 한다. 보낼 사각형은 자리를 칸·카드·스크롤 경계로 자르고
// 본문을 덮는 패널(좁은 창의 대화·정보·운영 패널) 영역을 뺀 것이다. 남은 넓이가 없으면 숨긴다.
// 자리·경계·덮개의 크기 변화와 스크롤·창 resize를 animation frame마다 한 번으로 묶는다.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const EMPTY_RECT: Rect = { x: 0, y: 0, width: 0, height: 0 };

export function empty(rect: Rect): boolean {
  return rect.width <= 0 || rect.height <= 0;
}

export function sameRect(a: Rect, b: Rect): boolean {
  return a.x === b.x && a.y === b.y && a.width === b.width &&
    a.height === b.height;
}

/** 가장자리를 반올림한 정수 사각형. 크기를 반올림하면 이웃 칸과 한 pixel 겹칠 수 있다. */
export function rectOf(element: Element): Rect {
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

export function intersect(a: Rect, b: Rect): Rect {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + a.width, b.x + b.width);
  const bottom = Math.min(a.y + a.height, b.y + b.height);
  if (right <= x || bottom <= y) return EMPTY_RECT;
  return { x, y, width: right - x, height: bottom - y };
}

/**
 * 덮인 영역을 뺀다. native view는 사각형이라 남은 네 쪽 중 가장 넓은 쪽으로 줄인다. 옆에서
 * 덮는 패널이면 덮지 않은 옆 폭이 남는다. 다 덮이면 넓이 0이다.
 */
export function subtractCover(rect: Rect, cover: Rect): Rect {
  const overlap = intersect(rect, cover);
  if (empty(overlap)) return rect;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const sides: Rect[] = [
    { ...rect, width: overlap.x - rect.x },
    {
      ...rect,
      x: overlap.x + overlap.width,
      width: right - overlap.x - overlap.width,
    },
    { ...rect, height: overlap.y - rect.y },
    {
      ...rect,
      y: overlap.y + overlap.height,
      height: bottom - overlap.y - overlap.height,
    },
  ];
  let best = EMPTY_RECT;
  for (const side of sides) {
    if (empty(side)) continue;
    if (side.width * side.height > best.width * best.height) best = side;
  }
  return best;
}

/** 자리를 경계들로 자르고 덮개를 뺀 사각형. */
export function visibleRect(
  region: Rect,
  clips: readonly Rect[],
  covers: readonly Rect[],
): Rect {
  let rect = region;
  for (const clip of clips) rect = intersect(rect, clip);
  for (const cover of covers) {
    if (empty(rect)) break;
    rect = subtractCover(rect, cover);
  }
  return empty(rect) ? EMPTY_RECT : rect;
}

const clipping = (overflow: string) => overflow !== "" && overflow !== "visible";

/** 내용을 자르는 조상(칸·카드 목록의 스크롤 영역). 그 밖은 보이지 않는다. */
export function clipAncestors(element: Element): Element[] {
  const view = element.ownerDocument.defaultView;
  const found: Element[] = [];
  for (
    let node = element.parentElement;
    node !== null && view !== null;
    node = node.parentElement
  ) {
    const style = view.getComputedStyle(node);
    if (clipping(style.overflowX) || clipping(style.overflowY)) found.push(node);
  }
  return found;
}

export interface BoundsRelayDeps {
  element: Element;
  /** 지금 본문을 덮는 패널. 없으면 빈 목록이다. */
  covers(): readonly Element[];
  /** 덮개가 열리고 닫힐 때 부른다. 돌려준 함수로 끊는다. */
  onCoversChange(listener: () => void): () => void;
  send(rect: Rect): void;
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
  let last: Rect | undefined;
  let handle: number | undefined;
  let stopped = false;

  function measure(): void {
    handle = undefined;
    if (stopped) return;
    const next = visibleRect(
      rectOf(deps.element),
      clips.map(rectOf),
      deps.covers().map(rectOf),
    );
    if (last !== undefined && sameRect(last, next)) return;
    last = next;
    if (empty(next)) deps.hide();
    else deps.send(next);
  }

  function schedule(): void {
    if (stopped || handle !== undefined) return;
    handle = deps.frame.request(measure);
  }

  const view = deps.element.ownerDocument.defaultView;
  // 크기는 그대로인데 위치만 바뀌는 경우(sidebar 접기, 카드 스크롤, 창 이동)도 본다.
  view?.addEventListener("resize", schedule);
  deps.element.ownerDocument.addEventListener("scroll", schedule, true);
  let unobserveCovers = deps.observe(deps.covers(), schedule);
  const unobserve = deps.observe([deps.element, ...clips], schedule);
  const offCovers = deps.onCoversChange(() => {
    unobserveCovers();
    unobserveCovers = deps.observe(deps.covers(), schedule);
    schedule();
  });
  schedule();
  return {
    refresh: schedule,
    stop() {
      stopped = true;
      if (handle !== undefined) deps.frame.cancel(handle);
      view?.removeEventListener("resize", schedule);
      deps.element.ownerDocument.removeEventListener("scroll", schedule, true);
      unobserve();
      unobserveCovers();
      offCovers();
    },
  };
}

/** 본문을 덮는 패널 목록. 창마다 하나를 만들어 context로 나눈다. */
export interface ViewCovers {
  add(element: Element): () => void;
  list(): readonly Element[];
  subscribe(listener: () => void): () => void;
}

export function createViewCovers(): ViewCovers {
  const covers = new Set<Element>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of [...listeners]) listener();
  };
  return {
    add(element) {
      covers.add(element);
      notify();
      return () => {
        if (covers.delete(element)) notify();
      };
    },
    list: () => [...covers],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
