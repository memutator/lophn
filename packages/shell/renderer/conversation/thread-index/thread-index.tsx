// 대화 왼쪽 가장자리의 turn 눈금(Codex의 thread user message navigation rail). 사람 메시지가 4개 이상이고 대화 기둥 왼쪽
// 여백이 눈금이 들어갈 만큼 넓을 때만 그린다. 누르거나 끌면 그 사람 메시지로 가고, Alt+↑/↓는 대화 화면 어디서든 앞뒤
// 사람 메시지로 간다. 가는 일(`goTo`)은 ThreadScroll이 한다: 끝 따라가기를 먼저 꺼야 다음 render가 맨 아래로 되돌리지 않는다.
import { t } from "@lophn/i18n";
import { Popover } from "@lophn/ui/overlay";
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

import { type FocusRoutes, useFocusRoutes } from "../agent-keys.ts";
import type { Bookmarks } from "./bookmarks.ts";
import { IndexCard } from "./index-card.tsx";
import {
  type IndexItem,
  RAIL_HEADER,
  RAIL_MIN_MARGIN,
  RAIL_PITCH,
  sampleIndexes,
} from "./model.ts";
import styles from "./thread-index.module.css";

const MIN_MESSAGES = 4;
// 눈금이 화면 높이의 이만큼을 넘으면 고르게 줄인다.
const MAX_HEIGHT_SHARE = 0.7;
// 눈금에서 card로 건너가는 동안 닫히지 않는 틈.
const CLOSE_MS = 150;
// 이 안의 어긋남은 같은 위치로 본다.
const EPSILON = 2;
const USER = '[data-message][data-actor="user"]';

interface ThreadIndexProps {
  list: RefObject<HTMLDivElement | null>;
  items: readonly IndexItem[];
  bookmarks: Bookmarks | null;
  /** 그리는 행 범위. 바뀌면 화면에 보이는지 보는 observer를 새 node에 다시 건다. */
  mounted: string;
  /** 그 사람 메시지의 머리가 대화 맨 위에 오게 간다. 그리지 않은 행에도 간다. */
  goTo: (id: string, smooth: boolean) => void;
  /** 그 사람 메시지의 위가 대화 맨 위에서 얼마나 떨어졌는지(위쪽이면 음수). 없으면 null이다. */
  where: (id: string) => number | null;
  /** rail 위 wheel을 대화 scroll로 넘긴다. */
  wheel: (deltaY: number) => void;
}

/** 대화 기둥 왼쪽 여백과 대화 높이. 기둥은 list의 첫 자식이다. */
function useRailSpace(list: RefObject<HTMLDivElement | null>, count: number) {
  const [space, setSpace] = useState({ margin: 0, height: 0 });
  useLayoutEffect(() => {
    const element = list.current;
    if (!element) return;
    const measure = () => {
      const column = element.firstElementChild;
      const margin = column
        ? column.getBoundingClientRect().left -
          element.getBoundingClientRect().left
        : 0;
      const height = element.clientHeight;
      setSpace((one) =>
        one.margin === margin && one.height === height
          ? one
          : { margin, height },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
    // 기둥은 메시지가 오면 생긴다.
  }, [list, count]);
  return space;
}

/** 화면에 보이는 사람 메시지 id 전부(Codex는 이것을 "현재"로 본다). */
function useVisible(
  list: RefObject<HTMLDivElement | null>,
  ids: string,
  mounted: string,
) {
  const [visible, setVisible] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    const element = list.current;
    if (!element) return;
    const seen = new Map<Element, boolean>();
    const observer = new IntersectionObserver(
      (records) => {
        for (const record of records)
          seen.set(record.target, record.isIntersecting);
        setVisible(
          new Set(
            [...seen].flatMap(([node, on]) =>
              on ? [(node as HTMLElement).dataset.message!] : [],
            ),
          ),
        );
      },
      { root: element, rootMargin: `-${RAIL_HEADER}px 0px 0px 0px` },
    );
    for (const node of element.querySelectorAll(USER)) observer.observe(node);
    return () => observer.disconnect();
  }, [list, ids, mounted]);
  return visible;
}

export function ThreadIndex({
  list,
  items,
  bookmarks,
  mounted,
  goTo,
  where,
  wheel,
}: ThreadIndexProps): ReactElement | null {
  const space = useRailSpace(list, items.length);
  const ids = items.map((item) => item.id).join("\n");
  const visible = useVisible(list, ids, mounted);
  const [hover, setHover] = useState<string | null>(null);
  const rail = useRef<HTMLDivElement>(null);
  const closer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const dragging = useRef(false);
  const lastDrag = useRef(-1);

  useEffect(() => () => clearTimeout(closer.current), []);

  // Alt+↑/↓: 대화 화면 어디서든 앞뒤 사람 메시지로. 눈금이 숨어도(여백이 좁아도) 동작한다. 창의 agent command로 걸고,
  // 화면 안에 focus가 들어올 때 올린다(AgentView와 같은 때).
  const jumps = useRef<FocusRoutes>({});
  const jumpTo = (direction: 1 | -1): string | null => {
    // 그리지 않은 행도 자리를 계산해 준다.
    const tops = items.flatMap((item) => {
      const top = where(item.id);
      return top === null ? [] : [{ id: item.id, top }];
    });
    const target =
      direction === 1
        ? tops.find((one) => one.top > EPSILON)
        : (tops.findLast((one) => one.top < -EPSILON) ?? tops[0]);
    return target?.id ?? null;
  };
  jumps.current = {
    "agent.jump-previous": {
      run: () => {
        const id = jumpTo(-1);
        if (id !== null) goTo(id, true);
      },
      when: () => jumpTo(-1) !== null,
    },
    "agent.jump-next": {
      run: () => {
        const id = jumpTo(1);
        if (id !== null) goTo(id, true);
      },
      when: () => jumpTo(1) !== null,
    },
  };
  const claimJump = useFocusRoutes(jumps);
  useEffect(() => {
    const view = list.current?.closest("[data-agent-view]");
    if (!view) return;
    view.addEventListener("focusin", claimJump);
    return () => view.removeEventListener("focusin", claimJump);
  }, [list, claimJump]);

  if (items.length < MIN_MESSAGES || space.margin < RAIL_MIN_MARGIN)
    return null;

  const keep = new Set<number>();
  items.forEach((item, index) => {
    if (visible.has(item.id) || item.id === hover) keep.add(index);
  });
  const max = Math.max(
    2,
    Math.floor((space.height * MAX_HEIGHT_SHARE) / RAIL_PITCH),
  );
  const shown = sampleIndexes(items.length, max, keep).map(
    (index) => items[index]!,
  );
  const hoverAt = shown.findIndex((item) => item.id === hover);
  const hovered = hoverAt < 0 ? null : shown[hoverAt]!;
  const firstVisible = shown.find((item) => visible.has(item.id));
  const stop = (hovered ?? firstVisible ?? shown.at(-1)!).id;

  const cancelClose = () => clearTimeout(closer.current);
  const closeLater = () => {
    cancelClose();
    closer.current = setTimeout(() => setHover(null), CLOSE_MS);
  };
  const go = (item: IndexItem, smooth: boolean) => {
    setHover(item.id);
    goTo(item.id, smooth);
  };
  const positionAt = (y: number) => {
    const top = rail.current!.getBoundingClientRect().top;
    return Math.min(
      shown.length - 1,
      Math.max(0, Math.floor((y - top) / RAIL_PITCH)),
    );
  };

  // IndexCard는 portal로 그려져도 React event는 rail로 올라온다. rail 안에서 난 것만 받는다.
  const inRail = (event: {
    currentTarget: Element;
    target: EventTarget;
  }): boolean => event.currentTarget.contains(event.target as Node);

  // 누른 채 끌면 지나가는 메시지로 바로 간다. 누르기만 하면 부드럽게 간다.
  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (!inRail(event) || event.button !== 0) return;
    dragging.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    lastDrag.current = positionAt(event.clientY);
    go(shown[lastDrag.current]!, true);
  };
  const move = (event: PointerEvent<HTMLDivElement>) => {
    if (!inRail(event) || !dragging.current) return;
    const at = positionAt(event.clientY);
    if (at === lastDrag.current) return;
    lastDrag.current = at;
    go(shown[at]!, false);
  };
  const up = (event: PointerEvent<HTMLDivElement>) => {
    if (!inRail(event)) return;
    dragging.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  };

  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!inRail(event)) return;
    const at =
      hoverAt >= 0 ? hoverAt : shown.findIndex((item) => item.id === stop);
    const next =
      event.key === "ArrowUp"
        ? at - 1
        : event.key === "ArrowDown"
          ? at + 1
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? shown.length - 1
              : null;
    if (next === null) return;
    event.preventDefault();
    const item = shown[Math.min(shown.length - 1, Math.max(0, next))]!;
    // focus가 옮겨 가면 Popover가 옛 card를 닫으니 그 뒤에 새 card를 연다.
    rail.current?.querySelectorAll("button")[shown.indexOf(item)]?.focus();
    setHover(item.id);
  };

  return (
    <div
      className={styles.rail}
      ref={rail}
      role="group"
      aria-label={t("conversation.label.thread-index")}
      data-thread-index=""
      onWheel={(event) => inRail(event) && wheel(event.deltaY)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
      data-key-context="modal"
      onBlur={(event) => {
        const next = event.relatedTarget as Element | null;
        if (
          !event.currentTarget.contains(next) &&
          !next?.closest("[data-thread-index-card]")
        )
          closeLater();
      }}
    >
      <Popover
        open={hovered !== null}
        onOpenChange={(open) => {
          if (!open) setHover(null);
        }}
        card
        returnFocus={false}
        trigger={
          <span
            className={styles.anchor}
            style={{ top: Math.max(0, hoverAt) * RAIL_PITCH }}
            aria-hidden="true"
          />
        }
      >
        {hovered === null ? null : (
          <IndexCard
            item={hovered}
            bookmarked={
              hovered.bookmark !== null &&
              (bookmarks?.keys.has(hovered.bookmark) ?? false)
            }
            onBookmark={
              bookmarks === null || hovered.bookmark === null
                ? null
                : () => bookmarks.toggle(hovered.bookmark!)
            }
            onPointerEnter={cancelClose}
            onPointerLeave={closeLater}
          />
        )}
      </Popover>
      {shown.map((item, position) => {
        const marked =
          item.bookmark !== null &&
          (bookmarks?.keys.has(item.bookmark) ?? false);
        return (
          <button
            key={item.id}
            type="button"
            className={styles.tick}
            tabIndex={item.id === stop ? 0 : -1}
            aria-label={
              marked
                ? t("conversation.label.thread-index-tick-bookmarked", {
                    title: item.title,
                  })
                : item.title
            }
            data-visible={visible.has(item.id) ? "" : undefined}
            data-bookmarked={marked ? "" : undefined}
            data-distance={
              hoverAt < 0 || Math.abs(position - hoverAt) > 3
                ? undefined
                : Math.abs(position - hoverAt)
            }
            onPointerEnter={() => {
              cancelClose();
              setHover(item.id);
            }}
            onPointerLeave={closeLater}
            onFocus={() => setHover(item.id)}
            // Enter가 만든 click만 받는다. 누르기는 pointerdown이 이미 갔다.
            onClick={(event) => event.detail === 0 && go(item, true)}
          >
            <span className={styles.bar} />
            {marked ? <span className={styles.dot} /> : null}
          </button>
        );
      })}
    </div>
  );
}
