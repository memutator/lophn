// tab을 끄는 pointer drag. tab 줄의 칸과 group 칸의 머리 줄이 start로 시작하고, 끄는 동안 이 provider가 놓을 자리를 좌표로
// 찾는다(요소 위의 event가 아니라 칸·줄의 사각형으로 찾아서 <webview> 위에서도 같다). 모양은 셋이다: 커서를 따라가는 알약,
// 칸 위의 놓을 구역 미리보기, 줄이 쓰는 자리 비우기(TabStrip이 drag 값으로 그린다). 알약과 미리보기는 portal이라 webview
// 그릇보다 위에 선다. 어디에 놓으면 무엇이 되는지는 provider 밖(desk model의 tabDropState·applyTabDrop)이 정한다.
import {
  createContext,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { t } from "@lophn/i18n";

import type {
  PaneZone,
  TabDragItem,
  TabDropHit,
  TabDropState,
} from "./desk-model.ts";
import styles from "./tab-drag.module.css";

/** 이만큼 움직여야 drag가 시작된다. 그 전에는 click이다. */
const THRESHOLD = 4;
/** 칸의 가장자리 구역 폭(칸 크기의 몫). 안쪽은 가운데(swap)다. */
const EDGE = 0.28;
/** 놓은 알약이 자리에 앉는 시간. motion token의 short와 맞춘다. */
const SETTLE_MS = 140;
/** 알약이 커서에서 떨어진 거리. */
const PILL_OFFSET = 14;

export interface Rect {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

export interface TabDragSpec {
  /** 알약에 보일 이름과 아이콘. */
  describe: (key: string) => { title: string; icon: ReactNode } | undefined;
  state: (item: TabDragItem, hit: TabDropHit) => TabDropState;
  onDrop: (item: TabDragItem, hit: TabDropHit) => void;
}

export interface ActiveDrag {
  readonly item: TabDragItem;
  /** 끌기가 시작된 곳. strip이면 그 칸이 자리 표시로 남는다. */
  readonly origin: "strip" | "pane";
  readonly x: number;
  readonly y: number;
  readonly hit: TabDropHit | null;
  readonly state: TabDropState;
  /** 칸 위의 미리보기 사각형(viewport 좌표). */
  readonly preview: Rect | null;
  /** 끌기 시작 때 잰 tab 줄 칸들의 사각형. 줄이 자리를 비우는 계산에 쓴다. */
  readonly strip: readonly (Rect & { readonly key: string })[];
  /** 놓았고 알약이 앉는 중이다. */
  readonly settling: boolean;
}

interface Drag {
  active: ActiveDrag | null;
  start: (
    event: ReactPointerEvent<HTMLElement>,
    item: TabDragItem,
    origin: "strip" | "pane",
  ) => void;
}

const NONE: Drag = { active: null, start: () => {} };
const DragContext = createContext<Drag>(NONE);

/** provider 밖이면 끌 수 없다(Settings 같은 곳). */
export function useTabDrag(): Drag {
  return useContext(DragContext);
}

const rectOf = (element: Element): Rect => {
  const box = element.getBoundingClientRect();
  return {
    left: box.left,
    top: box.top,
    width: box.width,
    height: box.height,
  };
};

const inside = (box: Rect, x: number, y: number) =>
  x >= box.left &&
  x <= box.left + box.width &&
  y >= box.top &&
  y <= box.top + box.height;

/** 칸 안의 좌표가 놓는 구역. 가장자리 중 가장 가까운 쪽이 EDGE 안이면 그 쪽, 아니면 가운데다. */
export function zoneAt(box: Rect, x: number, y: number): PaneZone {
  const fx = (x - box.left) / box.width;
  const fy = (y - box.top) / box.height;
  const near: [PaneZone, number][] = [
    ["left", fx],
    ["right", 1 - fx],
    ["top", fy],
    ["bottom", 1 - fy],
  ];
  near.sort((a, b) => a[1] - b[1]);
  return near[0]![1] < EDGE ? near[0]![0] : "center";
}

/** 구역이 덮는 칸의 부분. 가장자리는 그쪽 절반이다(나누면 몫이 반반이다). */
export function previewOf(box: Rect, zone: PaneZone): Rect {
  const w = box.width / 2;
  const h = box.height / 2;
  switch (zone) {
    case "left":
      return { ...box, width: w };
    case "right":
      return { ...box, left: box.left + w, width: w };
    case "top":
      return { ...box, height: h };
    case "bottom":
      return { ...box, top: box.top + h, height: h };
    default:
      return box;
  }
}

function stripEntries(): (Rect & { key: string })[] {
  return [
    ...document.querySelectorAll<HTMLElement>(
      "[data-tab-strip] [data-entry-key]",
    ),
  ].map((element) => ({ key: element.dataset.entryKey!, ...rectOf(element) }));
}

export function TabDragProvider({
  describe,
  state,
  onDrop,
  children,
}: TabDragSpec & { children: ReactNode }) {
  const [active, setActive] = useState<ActiveDrag | null>(null);
  const spec = useRef<TabDragSpec>({ describe, state, onDrop });
  spec.current = { describe, state, onDrop };
  // 끌기 하나가 도는 동안의 정리. 새 끌기는 앞의 것을 끝낸다.
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);

  const start = useCallback<Drag["start"]>((event, item, origin) => {
    if (event.button !== 0) return;
    stop.current?.();
    const from = { x: event.clientX, y: event.clientY };
    const source = event.currentTarget;
    const doc = source.ownerDocument;
    let strip: ActiveDrag["strip"] = [];
    let live: ActiveDrag | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const resolve = (x: number, y: number) => {
      // title bar의 tab 구역 전체(줄 위의 빈 곳도)가 줄이다.
      const bar = doc.querySelector("[data-tab-strip]")?.parentElement;
      if (bar && inside(rectOf(bar), x, y)) {
        const others = strip.filter(
          (entry) => !(origin === "strip" && entry.key === item.key),
        );
        const next = others.find((entry) => x < entry.left + entry.width / 2);
        return { hit: { kind: "strip", before: next?.key ?? null } as const };
      }
      // 떠 있는 패널 위는 칸이 아니다.
      if (doc.elementFromPoint(x, y)?.closest("[data-float-panel]")) {
        return { hit: null };
      }
      for (const pane of doc.querySelectorAll<HTMLElement>("[data-pane]")) {
        const box = rectOf(pane);
        if (!inside(box, x, y)) continue;
        const zone = zoneAt(box, x, y);
        return {
          hit: { kind: "pane", target: pane.dataset.pane!, zone } as const,
          box,
        };
      }
      return { hit: null };
    };

    const measure = (x: number, y: number) => {
      const { hit, box } = resolve(x, y) as {
        hit: TabDropHit | null;
        box?: Rect;
      };
      const verdict = hit === null ? "none" : spec.current.state(item, hit);
      const preview =
        hit?.kind === "pane" && box !== undefined && verdict !== "none"
          ? verdict === "full"
            ? box
            : previewOf(box, hit.zone)
          : null;
      live = {
        item,
        origin,
        x,
        y,
        hit,
        state: verdict,
        preview,
        strip,
        settling: false,
      };
      setActive(live);
    };

    const finish = () => {
      clearTimeout(timer);
      doc.removeEventListener("pointermove", move);
      doc.removeEventListener("pointerup", up);
      doc.removeEventListener("pointercancel", cancel);
      doc.removeEventListener("keydown", escape, true);
      try {
        source.releasePointerCapture(event.pointerId);
      } catch {
        // 잡은 적이 없으면 던진다.
      }
      delete doc.documentElement.dataset.tabDragging;
      stop.current = null;
      setActive(null);
    };
    const cancel = () => finish();
    const escape = (key: KeyboardEvent) => {
      if (key.key !== "Escape") return;
      key.preventDefault();
      key.stopPropagation();
      finish();
    };
    const move = (next: PointerEvent) => {
      if (live === null) {
        if (
          Math.hypot(next.clientX - from.x, next.clientY - from.y) < THRESHOLD
        ) {
          return;
        }
        // 끌기가 시작됐다. 놓은 뒤의 click이 tab을 고르지 않게 한 번 삼킨다.
        strip = stripEntries();
        doc.documentElement.dataset.tabDragging = "";
        try {
          source.setPointerCapture(event.pointerId);
        } catch {
          // 합성 event처럼 활성 pointer가 없으면 doc의 listener로 충분하다.
        }
      }
      measure(next.clientX, next.clientY);
    };
    const up = () => {
      if (live === null) {
        finish();
        return;
      }
      const { hit, state } = live;
      doc.removeEventListener("pointermove", move);
      const swallow = (click: MouseEvent) => click.stopPropagation();
      doc.addEventListener("click", swallow, { capture: true, once: true });
      setTimeout(() => doc.removeEventListener("click", swallow, true), 0);
      if (hit === null || state !== "ok") {
        finish();
        return;
      }
      const done = () => {
        finish();
        spec.current.onDrop(item, hit);
      };
      // 줄에 놓으면 알약이 비워 둔 자리로 앉은 뒤 순서가 바뀐다.
      const slot =
        origin === "strip" && hit.kind === "strip"
          ? doc.querySelector<HTMLElement>(
              `[data-tab-strip] [data-entry-key="${CSS.escape(item.key)}"]`,
            )
          : null;
      if (slot === null) {
        done();
        return;
      }
      const box = rectOf(slot);
      live = {
        ...live,
        x: box.left - PILL_OFFSET,
        y: box.top - PILL_OFFSET,
        settling: true,
      };
      setActive(live);
      timer = setTimeout(done, SETTLE_MS);
    };
    doc.addEventListener("pointermove", move);
    doc.addEventListener("pointerup", up);
    doc.addEventListener("pointercancel", cancel);
    doc.addEventListener("keydown", escape, true);
    stop.current = finish;
  }, []);

  const value = useMemo(() => ({ active, start }), [active, start]);
  return (
    <DragContext.Provider value={value}>
      {children}
      {active === null ? null : (
        <DragLayer active={active} describe={describe} />
      )}
    </DragContext.Provider>
  );
}

function DragLayer({
  active,
  describe,
}: {
  active: ActiveDrag;
  describe: TabDragSpec["describe"];
}) {
  const info = describe(active.item.key);
  const { preview } = active;
  return createPortal(
    <>
      {preview === null ? null : (
        <div
          className={styles.preview}
          data-state={active.state}
          data-drop-preview={active.hit?.kind === "pane" ? active.hit.zone : ""}
          style={{
            left: preview.left,
            top: preview.top,
            width: preview.width,
            height: preview.height,
          }}
        >
          {active.state === "full" ? (
            <span className={styles.full}>{t("shell.label.drop-full")}</span>
          ) : null}
        </div>
      )}
      <div
        className={styles.pillPosition}
        data-settling={active.settling || undefined}
        data-drag-pill=""
        style={{
          transform: `translate(${active.x + PILL_OFFSET}px, ${active.y + PILL_OFFSET}px)`,
        }}
      >
        <div className={styles.pill}>
          {info?.icon === undefined ? null : (
            <span className={styles.pillIcon}>{info.icon}</span>
          )}
          <span className={styles.pillTitle}>
            {info?.title ?? active.item.key}
          </span>
        </div>
      </div>
    </>,
    document.body,
  );
}
