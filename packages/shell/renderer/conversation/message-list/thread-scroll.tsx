// 대화 줄을 담는 scroll 틀. 새 말이 와도 사람이 올려 읽던 위치와 입력 focus를 건드리지 않는다.
// 맨 아래를 보고 있을 때만 새 말을 따라 내려간다. 언제 따라가는지는 `follow.ts`가 정한다.
// 긴 대화를 위해 화면 근처(위아래 600px)의 행만 그린다. 행 높이는 행 key로 재서 캐시하고(`virtual-rows.ts`), 안
// 그린 행은 그 높이의 합인 빈 칸이 대신한다. 올려 읽는 중에는 화면 맨 위에 걸린 행을 기준으로 잡아, 위쪽 행의 높이가
// 바뀌어도 읽던 글이 밀리지 않게 scrollTop을 고친다. 맨 끝 행(쓰는 중인 글, 일하는 중 줄)은 늘 그린다.
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  memo,
  useContext,
  useLayoutEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import { flushSync } from "react-dom";
import { IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { VisuallyHidden } from "@lophn/ui/shared";
import { tokens } from "@lophn/ui";
import { conversationIcons } from "../../icons/mod.ts";
import { t } from "@lophn/i18n";

import { ThreadIndexContext } from "../thread-index/context.ts";
import { ThreadIndex } from "../thread-index/thread-index.tsx";
import { followAfterInput, followAfterScroll } from "./follow.ts";
import {
  RowHeights,
  offsetsOf,
  rowAt,
  segmentsOf,
  windowOf,
  type ThreadPosition,
} from "./virtual-rows.ts";
import turns from "./turns.module.css";
import styles from "./thread-scroll.module.css";

// 화면 위아래로 이만큼(px) 더 그린다.
const OVERSCAN = 600;
// 끝에서 이만큼의 행은 늘 그린다: 쓰는 중인 글, 보내는 중인 말, 일하는 중 줄.
const PIN = 3;
// css(`--space-6`)의 gap과 list padding. 첫 render 전에는 이 값을 믿고, 그린 뒤에는 computed style을 읽는다.
const SPACE = Number.parseFloat(tokens.space[6]);
// layout effect가 연달아 다시 그리는 한도. 높이가 수렴하지 않는 bug가 화면을 얼리지 않게 한다.
const MAX_PASSES = 12;

interface ThreadScrollProps {
  /** 대화의 행. 위에서 아래 순서이고 key가 있다. 새 말이 오면 늘어난다. */
  rows: readonly ReactElement[];
  /** 행이 없을 때 보일 것. */
  empty: ReactNode;
  /** 열 때 돌아갈 읽던 위치. null이면 맨 아래다. */
  initialPosition: ThreadPosition | null;
  onScroll: (position: ThreadPosition | null) => void;
  /** 화면 밖 행도 다 그린다(대화 안 찾기가 DOM의 글을 훑는 동안). */
  renderAll: boolean;
  /** 새 답이 시작했거나 왔다는 한 줄. log는 읽지 않고 이 줄만 화면 낭독기가 읽는다. */
  announcement: { readonly text: string; readonly id: number } | null;
}

interface Measure {
  attach: (key: string, element: HTMLElement) => void;
  detach: (element: HTMLElement) => void;
}

/** 행 하나의 틀. 높이를 재서 캐시에 알리고, 빈 행(null을 그리는 줄)은 gap도 내지 않게 접는다. */
const Row = memo(function Row({
  id,
  measure,
  all,
  children,
}: {
  id: string;
  measure: Measure;
  all: boolean;
  children: ReactElement;
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    measure.attach(id, element);
    return () => measure.detach(element);
  }, [id, measure]);
  return (
    <div
      ref={ref}
      className={all ? `${styles.row} ${styles.rowAll}` : styles.row}
      data-row={id}
    >
      {children}
    </div>
  );
});

function windowFor(
  offsets: readonly number[],
  gap: number,
  following: boolean,
  top: number,
  height: number,
): { start: number; end: number } {
  const total = Math.max(0, offsets[offsets.length - 1]! - gap);
  const y = following ? Math.max(0, total - height) : top;
  return windowOf(offsets, y - OVERSCAN, y + height + OVERSCAN);
}

export function ThreadScroll({
  rows,
  empty,
  initialPosition,
  onScroll,
  renderAll,
  announcement,
}: ThreadScrollProps): ReactNode {
  const count = rows.length;
  const listRef = useRef<HTMLDivElement>(null);
  const following = useRef(initialPosition === null);
  const seen = useRef(count);
  const lastTop = useRef(0);
  // 마지막으로 알린 읽던 위치. 같으면 다시 알리지 않는다(알릴 때마다 대화 화면 전체가 다시 그려진다).
  const saved = useRef(initialPosition);
  const [unseen, setUnseen] = useState(0);
  const index = useContext(ThreadIndexContext);

  // virtualization. 높이는 행 key로 캐시하고, 화면 근처 행만 그린다.
  const [heights] = useState(() => new RowHeights());
  const [, redraw] = useReducer((tick: number) => tick + 1, 0);
  const gap = useRef(SPACE);
  const pad = useRef(SPACE);
  const view = useRef({ top: 0, height: 0 });
  const layout = useRef<{ keys: string[]; offsets: number[] }>({
    keys: [],
    offsets: [0],
  });
  const shown = useRef({ start: 0, end: 0 });
  // 화면 맨 위에 걸린 행과 그 행 위에서 화면 위까지의 거리. 행 높이가 바뀌어도 이 행을 제자리에 둔다.
  const anchor = useRef<{ row: string; delta: number } | null>(null);
  const restored = useRef(false);
  const stale = useRef(false);
  const passes = useRef(0);
  const arriving = useRef<string | null>(null);

  const keys = rows.map((row) => String(row.key));
  const offsets = offsetsOf(keys, heights, gap.current);

  // 처음 화면: 읽던 행이 있으면 그 근처, 없으면 맨 아래.
  const restoreAt =
    !restored.current && initialPosition !== null
      ? keys.indexOf(initialPosition.row)
      : -1;
  const win = renderAll
    ? { start: 0, end: count }
    : restoreAt >= 0
      ? windowFor(
          offsets,
          gap.current,
          false,
          offsets[restoreAt]! + initialPosition!.offset,
          view.current.height || 800,
        )
      : windowFor(
          offsets,
          gap.current,
          following.current,
          view.current.top,
          view.current.height || 800,
        );

  // 코드가 옮긴 위치를 바로 기록한다. 기록하지 않으면 같은 frame의 사람 scroll이 옛 위치와 비교돼, 글이 자라
  // 올라간 만큼 위로 올린 wheel이 "아래로 내려옴"으로 읽혀 다시 따라간다.
  const moveTo = (list: HTMLDivElement, top: number) => {
    list.scrollTop = top;
    lastTop.current = list.scrollTop;
  };

  // 행 높이 재기. 행이 mount될 때 바로 재고(그 commit 안에서 다시 그려 화면에 어긋난 frame이 없다), 그 뒤의 변화는
  // ResizeObserver가 알린다.
  const [measure] = useState<Measure>(() => {
    const keyOf = new WeakMap<Element, string>();
    let observer: ResizeObserver | null = null;
    const watcher = () => {
      observer ??= new ResizeObserver((entries) => {
        let changed = false;
        for (const entry of entries) {
          const key = keyOf.get(entry.target);
          if (key === undefined) continue;
          const height =
            entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height;
          if (heights.set(key, height)) changed = true;
        }
        const list = listRef.current;
        if (!list || !changed) return;
        if (following.current) moveTo(list, list.scrollHeight);
        else flushSync(redraw);
      });
      return observer;
    };
    return {
      attach(key, element) {
        keyOf.set(element, key);
        if (heights.set(key, element.getBoundingClientRect().height))
          stale.current = true;
        watcher().observe(element);
      },
      detach(element) {
        observer?.unobserve(element);
      },
    };
  });

  // 창 높이가 바뀌면 그릴 범위도 바뀐다.
  useLayoutEffect(() => {
    const list = listRef.current!;
    const observer = new ResizeObserver(() => {
      if (following.current) moveTo(list, list.scrollHeight);
      redraw();
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  // 화면 맨 위에 걸린 행을 기준으로 잡는다.
  const capture = (list: HTMLDivElement) => {
    const current = layout.current;
    if (current.keys.length === 0) return;
    const at = rowAt(current.offsets, list.scrollTop - pad.current);
    anchor.current = {
      row: current.keys[at]!,
      delta: pad.current + current.offsets[at]! - list.scrollTop,
    };
  };

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    layout.current = { keys, offsets };
    shown.current = win;
    const column = list.firstElementChild;
    if (column !== null && count > 0) {
      const nextGap = Number.parseFloat(getComputedStyle(column).rowGap);
      if (Number.isFinite(nextGap)) gap.current = nextGap;
    }
    pad.current = Number.parseFloat(getComputedStyle(list).paddingTop);

    // 탭을 다시 열면 대화가 빈 채로 그려지고 줄이 뒤에 온다. 처음 온 줄은 새 말이 아니라 처음 모습이라 읽던 위치를
    // 이때 돌려놓는다.
    if (!restored.current && count > 0) {
      restored.current = true;
      if (restoreAt >= 0) {
        following.current = false;
        anchor.current = {
          row: initialPosition!.row,
          delta: -initialPosition!.offset,
        };
      } else following.current = true;
    }

    if (following.current) {
      moveTo(list, list.scrollHeight);
      anchor.current = null;
    } else if (anchor.current !== null) {
      const at = keys.indexOf(anchor.current.row);
      if (at >= 0) {
        // 아직 scroll event로 읽지 못한 사람의 움직임은 보태서 지킨다.
        const pending = list.scrollTop - lastTop.current;
        const target =
          pad.current + offsets[at]! - anchor.current.delta + pending;
        if (Math.abs(target - list.scrollTop) > 0.5) moveTo(list, target);
      }
    }
    view.current = {
      top: list.scrollTop - pad.current,
      height: list.clientHeight,
    };

    // 새로 잰 높이나 달라진 화면 범위는 같은 commit 안에서 다시 그린다.
    const wanted = renderAll
      ? win
      : windowFor(
          offsets,
          gap.current,
          following.current,
          view.current.top,
          view.current.height,
        );
    const moved = wanted.start !== win.start || wanted.end !== win.end;
    if ((stale.current || moved) && passes.current < MAX_PASSES) {
      stale.current = false;
      passes.current += 1;
      redraw();
    } else {
      stale.current = false;
      passes.current = 0;
    }
  });

  useLayoutEffect(() => {
    const added = count - seen.current;
    const first = seen.current === 0;
    seen.current = count;
    if (added <= 0 || first) return;
    if (!following.current) setUnseen((current) => current + added);
  }, [count]);

  const input = (event: Parameters<typeof followAfterInput>[1]) => {
    const list = listRef.current;
    if (!list) return;
    const was = following.current;
    following.current = followAfterInput(was, event, list.scrollTop);
    // 올려 읽기 시작한 자리를 바로 기준으로 잡는다(첫 scroll event 전에 다시 그려도 그 자리를 지킨다).
    if (was && !following.current) capture(list);
  };

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const { scrollTop, scrollHeight, clientHeight } = list;
    following.current = followAfterScroll(
      following.current,
      lastTop.current,
      scrollTop,
      scrollHeight - scrollTop - clientHeight,
    );
    // 코드가 옮긴 자리(lastTop과 같다)는 기준을 다시 잡지 않는다. 반올림 오차가 쌓여 읽던 글이 밀린다.
    const moved = scrollTop !== lastTop.current;
    lastTop.current = scrollTop;
    if (following.current) setUnseen(0);
    const current = layout.current;
    if (!following.current && (moved || anchor.current === null)) capture(list);
    view.current = { top: scrollTop - pad.current, height: clientHeight };
    if (renderAll) return;
    const wanted = windowFor(
      current.offsets,
      gap.current,
      following.current,
      view.current.top,
      clientHeight,
    );
    if (
      wanted.start !== shown.current.start ||
      wanted.end !== shown.current.end
    )
      redraw();
  };

  // 읽던 위치는 scroll이 멈춘 뒤 한 번만 알린다.
  const handleScrollEnd = () => {
    const list = listRef.current;
    if (!list) return;
    // 부드럽게 가는 동안 높이가 바뀌어 animation이 끊겼으면 목표 행으로 마저 간다.
    const going = arriving.current;
    arriving.current = null;
    if (going !== null && !following.current) {
      const current = layout.current;
      const at = current.keys.indexOf(going);
      if (at >= 0 && Math.abs(current.offsets[at]! - list.scrollTop) > 2)
        jumpTo(list, going, current.offsets[at]!);
    }
    const at = anchor.current;
    const position: ThreadPosition | null =
      following.current || at === null
        ? null
        : { row: at.row, offset: Math.round(-at.delta) };
    if (
      position?.row === saved.current?.row &&
      position?.offset === saved.current?.offset
    )
      return;
    saved.current = position;
    onScroll(position);
  };

  // scrollbar는 list 요소의 일부라 pointerdown의 target이 list이고 위치가 본문 폭 밖이다.
  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    const list = listRef.current;
    if (
      list &&
      event.target === list &&
      event.nativeEvent.offsetX >= list.clientWidth
    )
      input({ kind: "scrollbar" });
  };

  const jump = () => {
    const list = listRef.current;
    if (!list) return;
    following.current = true;
    moveTo(list, list.scrollHeight);
    redraw();
    setUnseen(0);
    saved.current = null;
    onScroll(null);
  };

  // thread index가 사람 메시지로 간다. 따라가기를 먼저 꺼야 다음 render가 맨 아래로 되돌리지 않는다.
  // 그리지 않은 행은 쌓아 둔 높이로 계산한 자리로 바로 가고, 거기서 그리고 재면서 이 행을 제자리에 둔다.
  const jumpTo = (list: HTMLDivElement, id: string, top: number) => {
    moveTo(list, top);
    anchor.current = { row: id, delta: pad.current };
    view.current = { top: top - pad.current, height: list.clientHeight };
    flushSync(redraw);
  };

  const goTo = (id: string, smooth: boolean) => {
    const list = listRef.current;
    const current = layout.current;
    const at = current.keys.indexOf(id);
    if (!list || at < 0) return;
    following.current = false;
    const top = current.offsets[at]!;
    // 부드럽게 가는 것은 이미 그린 행으로 갈 때뿐이다. 먼 곳은 가는 길의 행이 mount되며 높이가 바뀌어 animation이
    // 끊긴다.
    const near = at >= shown.current.start && at < shown.current.end;
    const calm = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (near && smooth && !calm) {
      arriving.current = id;
      list.scrollTo({ top, behavior: "smooth" });
      return;
    }
    jumpTo(list, id, top);
  };

  // Alt+↑/↓가 쓴다: 그 행의 위가 화면 맨 위(padding 안쪽)에서 얼마나 떨어졌는지. 그리지 않은 행도 계산해 준다.
  const where = (id: string): number | null => {
    const list = listRef.current;
    const current = layout.current;
    const at = current.keys.indexOf(id);
    if (!list || at < 0) return null;
    return current.offsets[at]! - list.scrollTop;
  };

  // list 밖에 있는 rail 위 wheel도 list 위 wheel처럼 따라가기를 끈다.
  const wheelFromIndex = (deltaY: number) => {
    const list = listRef.current;
    if (!list) return;
    input({ kind: "wheel", deltaY });
    list.scrollTop += deltaY;
  };

  const segments = renderAll
    ? ([{ kind: "rows", from: 0, to: count }] as const)
    : segmentsOf(offsets, gap.current, win.start, win.end, PIN);
  const body: ReactNode[] = [];
  segments.forEach((segment, at) => {
    if (segment.kind === "space") {
      body.push(
        <div
          key={`space-${at}`}
          className={styles.space}
          style={{ height: segment.height }}
          aria-hidden="true"
        />,
      );
      return;
    }
    for (let one = segment.from; one < segment.to; one += 1) {
      body.push(
        <Row key={keys[one]} id={keys[one]!} measure={measure} all={renderAll}>
          {rows[one]!}
        </Row>,
      );
    }
  });

  return (
    <div className={styles.frame}>
      {/* 같은 글이 두 번 와도 다시 읽도록 id가 바뀔 때 자식 node를 바꾼다. */}
      <VisuallyHidden>
        {announcement === null ? null : (
          <span key={announcement.id}>{announcement.text}</span>
        )}
      </VisuallyHidden>
      <div
        className={styles.list}
        ref={listRef}
        onScroll={handleScroll}
        onScrollEnd={handleScrollEnd}
        onWheel={(event) => input({ kind: "wheel", deltaY: event.deltaY })}
        onKeyDown={(event: KeyboardEvent<HTMLDivElement>) =>
          input({ kind: "key", key: event.key, shiftKey: event.shiftKey })
        }
        onPointerDown={handlePointerDown}
        data-thread=""
        role="log"
        aria-live="off"
      >
        {count === 0 ? empty : <div className={turns.turns}>{body}</div>}
      </div>
      {index === null ? null : (
        <ThreadIndex
          list={listRef}
          items={index.items}
          bookmarks={index.bookmarks}
          mounted={`${win.start}:${win.end}`}
          goTo={goTo}
          where={where}
          wheel={wheelFromIndex}
        />
      )}
      {unseen > 0 ? (
        <div className={styles.jump}>
          <Tooltip content={t("conversation.button.jump-latest")}>
            <IconButton
              icon={conversationIcons.jumpLatest}
              label={t("conversation.button.jump-latest")}
              variant="secondary"
              size="sm"
              data-jump-latest={unseen}
              onClick={jump}
            />
          </Tooltip>
        </div>
      ) : null}
    </div>
  );
}
