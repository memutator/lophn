import { assertEquals } from "@std/assert";

import {
  createViewCovers,
  EMPTY_RECT,
  type Rect,
  rectOf,
  startBoundsRelay,
  subtractCover,
  visibleRect,
} from "./bounds.ts";

// 자리·경계·덮개 element의 최소 가짜. 사각형과 overflow만 바꾼다.
function fakeDom() {
  const listeners = new Map<string, Set<() => void>>();
  const on = (name: string, listener: () => void) => {
    const set = listeners.get(name) ?? new Set();
    set.add(listener);
    listeners.set(name, set);
  };
  const off = (name: string, listener: () => void) =>
    listeners.get(name)?.delete(listener);
  const styles = new Map<unknown, { overflowX: string; overflowY: string }>();
  const view = {
    getComputedStyle: (node: unknown) =>
      styles.get(node) ?? { overflowX: "visible", overflowY: "visible" },
    addEventListener: on,
    removeEventListener: off,
  };
  const document = {
    defaultView: view,
    addEventListener: on,
    removeEventListener: off,
  };
  function element(
    rect: Rect,
    parent: unknown = null,
    overflow = "visible",
  ) {
    const node = {
      rect,
      parentElement: parent,
      ownerDocument: document,
      getBoundingClientRect: () => ({
        left: node.rect.x,
        top: node.rect.y,
        right: node.rect.x + node.rect.width,
        bottom: node.rect.y + node.rect.height,
      }),
    };
    styles.set(node, { overflowX: overflow, overflowY: overflow });
    return node;
  }
  return {
    element,
    fire(name: string) {
      for (const listener of [...listeners.get(name) ?? []]) listener();
    },
    listening: () =>
      [...listeners.values()].reduce((count, set) => count + set.size, 0),
  };
}

function relayWorld() {
  const dom = fakeDom();
  const sent: (Rect | "hide")[] = [];
  let frames: (() => void)[] = [];
  const observed: (() => void)[] = [];
  const covers = createViewCovers();
  const list = dom.element(
    { x: 0, y: 40, width: 600, height: 400 },
    null,
    "auto",
  );
  const card = dom.element({ x: 20, y: 60, width: 300, height: 200 }, list);
  const relay = startBoundsRelay({
    element: card as unknown as Element,
    covers: covers.list,
    onCoversChange: covers.subscribe,
    send: (rect) => sent.push(rect),
    hide: () => sent.push("hide"),
    frame: {
      request(callback) {
        frames.push(callback);
        return frames.length;
      },
      cancel() {
        frames = [];
      },
    },
    observe(_elements, callback) {
      observed.push(callback);
      return () => {};
    },
  });
  return {
    dom,
    sent,
    covers,
    list,
    card,
    relay,
    observed,
    frame() {
      const due = frames;
      frames = [];
      for (const callback of due) callback();
    },
    pendingFrames: () => frames.length,
  };
}

Deno.test("shell/app-frame#R25: 사각형은 가장자리를 반올림해 이웃 칸과 겹치지 않는다", () => {
  const box = (left: number, right: number) =>
    ({
      getBoundingClientRect: () => ({ left, right, top: 40.4, bottom: 300.6 }),
    }) as unknown as Element;
  const left = rectOf(box(0, 320.5));
  const right = rectOf(box(320.5, 640));
  assertEquals(left.x + left.width, right.x);
  assertEquals(left, { x: 0, y: 40, width: 321, height: 261 });
});

Deno.test("shell/app-frame#R35: 칸·카드 목록 경계 밖은 잘라 내고 경계 밖으로 나간 카드는 넓이 0이다", () => {
  const list: Rect = { x: 0, y: 40, width: 600, height: 400 };
  assertEquals(
    visibleRect({ x: 20, y: 400, width: 300, height: 200 }, [list], []),
    { x: 20, y: 400, width: 300, height: 40 },
  );
  assertEquals(
    visibleRect({ x: 20, y: 500, width: 300, height: 200 }, [list], []),
    EMPTY_RECT,
  );
});

Deno.test("shell/app-frame#R26, shell/app-frame#R36: 옆에서 덮는 패널은 덮지 않은 폭만 남기고 다 덮으면 넓이 0이다", () => {
  const body: Rect = { x: 0, y: 40, width: 900, height: 660 };
  // 좁은 창의 대화 도크(오른쪽 360px).
  assertEquals(
    subtractCover(body, { x: 540, y: 40, width: 360, height: 660 }),
    { x: 0, y: 40, width: 540, height: 660 },
  );
  // 왼쪽 정보 패널.
  assertEquals(
    subtractCover(body, { x: 0, y: 40, width: 320, height: 660 }),
    { x: 320, y: 40, width: 580, height: 660 },
  );
  // 겹치지 않는 덮개는 그대로다.
  assertEquals(
    subtractCover(body, { x: 900, y: 40, width: 100, height: 100 }),
    body,
  );
  assertEquals(
    visibleRect(body, [], [{ x: 0, y: 0, width: 1000, height: 800 }]),
    EMPTY_RECT,
  );
});

Deno.test("shell/app-frame#R29, shell/app-frame#R35: 크기·스크롤·창 resize 변화는 frame마다 한 번 보내고 같은 사각형은 다시 보내지 않으며 경계 밖이면 숨긴다", () => {
  const w = relayWorld();
  assertEquals(w.pendingFrames(), 1);
  w.frame();
  assertEquals(w.sent, [{ x: 20, y: 60, width: 300, height: 200 }]);
  // 같은 frame 안의 여러 변화는 한 번만 잰다.
  w.card.rect = { ...w.card.rect, y: 50 };
  w.dom.fire("scroll");
  w.dom.fire("resize");
  for (const observed of w.observed) observed();
  assertEquals(w.pendingFrames(), 1);
  w.frame();
  assertEquals(w.sent.at(-1), { x: 20, y: 50, width: 300, height: 200 });
  w.dom.fire("scroll");
  w.frame();
  assertEquals(w.sent.length, 2);
  // 목록 밖으로 스크롤하면 숨긴다. 다시 들어오면 보낸다.
  w.card.rect = { ...w.card.rect, y: 600 };
  w.dom.fire("scroll");
  w.frame();
  assertEquals(w.sent.at(-1), "hide");
  w.card.rect = { ...w.card.rect, y: 100 };
  w.dom.fire("scroll");
  w.frame();
  assertEquals(w.sent.at(-1), { x: 20, y: 100, width: 300, height: 200 });
  w.relay.stop();
  assertEquals(w.dom.listening(), 0);
  w.dom.fire("scroll");
  assertEquals(w.pendingFrames(), 0);
});

Deno.test("shell/app-frame#R36: 덮개가 열리면 덮이지 않은 영역으로 줄이고 닫으면 원래 사각형으로 돌아온다", () => {
  const w = relayWorld();
  w.frame();
  const panel = w.dom.element({ x: 220, y: 40, width: 380, height: 400 });
  const remove = w.covers.add(panel as unknown as Element);
  w.frame();
  assertEquals(w.sent.at(-1), { x: 20, y: 60, width: 200, height: 200 });
  remove();
  w.frame();
  assertEquals(w.sent.at(-1), { x: 20, y: 60, width: 300, height: 200 });
  assertEquals(w.sent.includes("hide"), false);
});
