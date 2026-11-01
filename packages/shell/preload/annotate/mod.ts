/// <reference lib="dom" />
// 앱 view 페이지 쪽 annotate. 켜져 있는 동안 클릭과 끌기를 가로채 요소나 영역을 고르고,
// 고른 목록을 main에 보낸다. 번호는 여기서 매기고 지워도 다시 매기지 않는다(모두 지우면 1부터).
import {
  ANNOTATE_PAGE_CAPTURE_READY,
  ANNOTATE_PAGE_CLEAR_CAPTURE,
  ANNOTATE_PAGE_EXIT,
  ANNOTATE_PAGE_ITEMS,
  ANNOTATE_PAGE_PREPARE_CAPTURE,
  ANNOTATE_PAGE_REMOVE,
  ANNOTATE_PAGE_SET_MODE,
  annotatePagePrepareCaptureSchema,
  annotatePageRemoveSchema,
  annotatePageSetModeSchema,
} from "../../ipc/annotation.ts";
import { type Box, boxOf, cropOf } from "./geometry.ts";
import { createOverlay } from "./overlay.ts";
import {
  DRAG_THRESHOLD,
  labelOf,
  type Picked,
  pickElement,
  pickRegion,
  targetAt,
  toItem,
  viewOf,
} from "./pick.ts";

interface AnnotateTransport {
  send(channel: string, payload: unknown): void;
  on(channel: string, listener: (payload: unknown) => void): void;
}

// 앱에 닿지 않게 막는 event. 층 안(host로 보이는 target)에서 난 것은 통과시킨다.
const BLOCKED = [
  "pointerdown",
  "pointermove",
  "pointerup",
  "mousedown",
  "mouseup",
  "click",
  "keydown",
] as const;

export function installAnnotate(transport: AnnotateTransport): void {
  const win = globalThis as unknown as Window; // lint가 `window`를 막는다
  const picks = new Map<number, Picked>();
  let next = 1;
  let on = false;
  let drag: { x: number; y: number; box: Box | null } | null = null;

  const sendItems = () =>
    transport.send(ANNOTATE_PAGE_ITEMS, {
      items: [...picks.values()].map(toItem),
    });

  const overlay = createOverlay(
    document,
    (n, note) => {
      const pick = picks.get(n);
      if (pick === undefined) return;
      pick.note = note;
      sendItems();
    },
    (n) => remove(n),
  );

  // 요소가 아직 연결돼 있으면 지금 사각형, 사라졌으면 적어 둔 사각형을 지금 viewport로 옮긴다.
  const boxNow = (pick: Picked): Box => {
    const el = pick.ref?.deref();
    return el?.isConnected
      ? el.getBoundingClientRect()
      : boxOf(pick.rect, viewOf(win));
  };
  const layout = () => {
    const view = viewOf(win);
    for (const [n, pick] of picks) overlay.place(n, boxNow(pick), view);
  };

  const add = (pick: Picked) => {
    picks.set(pick.n, pick);
    overlay.add(pick.n, pick.kind);
    layout();
    overlay.focusNote(pick.n);
    sendItems();
  };

  const pickAt = (x: number, y: number) => {
    const target = targetAt(document, overlay.host, x, y);
    if (target === null) return;
    const same = [...picks.values()].find((p) => p.ref?.deref() === target);
    if (same !== undefined) return overlay.focusNote(same.n);
    add(pickElement(target, next++, win));
  };

  const boxBetween = (x: number, y: number, e: PointerEvent): Box => ({
    x: Math.min(x, e.clientX),
    y: Math.min(y, e.clientY),
    width: Math.abs(e.clientX - x),
    height: Math.abs(e.clientY - y),
  });

  function onEvent(e: Event) {
    if (e.type === "keydown" && (e as KeyboardEvent).key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setMode(false);
      transport.send(ANNOTATE_PAGE_EXIT, {});
      return;
    }
    if (e.target === overlay.host) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "pointerdown") {
      const p = e as PointerEvent;
      if (p.button === 0) drag = { x: p.clientX, y: p.clientY, box: null };
    } else if (e.type === "pointermove") {
      const p = e as PointerEvent;
      if (drag !== null) {
        const box = boxBetween(drag.x, drag.y, p);
        if (
          drag.box !== null ||
          Math.max(box.width, box.height) >= DRAG_THRESHOLD
        ) {
          drag.box = box;
          overlay.hover(null);
          overlay.drag(box);
        }
      } else {
        const target = targetAt(document, overlay.host, p.clientX, p.clientY);
        overlay.hover(
          target && target.getBoundingClientRect(),
          target ? labelOf(target) : "",
        );
      }
    } else if (e.type === "pointerup" && drag !== null) {
      const p = e as PointerEvent;
      const done = drag;
      drag = null;
      overlay.drag(null);
      if (done.box !== null) {
        add(pickRegion(boxBetween(done.x, done.y, p), next++, win));
      } else pickAt(p.clientX, p.clientY);
    }
  }

  const relayout = () => layout();

  function setMode(value: boolean) {
    if (value === on) return;
    on = value;
    const toggle = on ? "addEventListener" : "removeEventListener";
    for (const type of BLOCKED) win[toggle](type, onEvent, true);
    win[toggle]("resize", relayout);
    document[toggle]("scroll", relayout, true);
    drag = null;
    overlay.hover(null);
    overlay.drag(null);
    if (on) {
      overlay.attach();
      layout();
    } else {
      overlay.detach();
    }
  }

  const remove = (n: number | "all") => {
    overlay.remove(n);
    if (n === "all") {
      picks.clear();
      next = 1;
    } else {
      picks.delete(n);
    }
    sendItems();
  };

  const frames = () =>
    new Promise<void>((done) =>
      requestAnimationFrame(() => requestAnimationFrame(() => done())),
    );

  // 보낼 때 main이 부른다. mode가 꺼져 있어도 그 annotation만 그려 자를 범위를 알려 준다.
  async function prepare(n: number) {
    const pick = picks.get(n);
    if (pick === undefined) return;
    overlay.attach();
    overlay.capture(n);
    layout();
    await frames();
    const view = viewOf(win);
    transport.send(ANNOTATE_PAGE_CAPTURE_READY, {
      n,
      crop: cropOf(boxNow(pick), view),
      viewport: { width: view.width, height: view.height },
    });
  }

  transport.on(ANNOTATE_PAGE_SET_MODE, (payload) => {
    const parsed = annotatePageSetModeSchema.safeParse(payload);
    if (parsed.success) setMode(parsed.data.on);
  });
  transport.on(ANNOTATE_PAGE_REMOVE, (payload) => {
    const parsed = annotatePageRemoveSchema.safeParse(payload);
    if (parsed.success) remove(parsed.data.n);
  });
  transport.on(ANNOTATE_PAGE_PREPARE_CAPTURE, (payload) => {
    const parsed = annotatePagePrepareCaptureSchema.safeParse(payload);
    if (parsed.success) void prepare(parsed.data.n);
  });
  transport.on(ANNOTATE_PAGE_CLEAR_CAPTURE, () => {
    overlay.capture(null);
    if (!on) overlay.detach();
  });
}
