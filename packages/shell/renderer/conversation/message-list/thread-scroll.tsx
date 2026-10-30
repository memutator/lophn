// 대화 줄을 담는 scroll 틀. 새 말이 와도 사람이 올려 읽던 위치와 입력 focus를 건드리지 않는다.
// 맨 아래를 보고 있을 때만 새 말을 따라 내려간다. 언제 따라가는지는 `follow.ts`가 정한다.
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { conversationIcons } from "../../icons/mod.ts";
import { t } from "@lophn/i18n";

import { followAfterInput, followAfterScroll } from "./follow.ts";
import styles from "./thread-scroll.module.css";

interface ThreadScrollProps {
  /** 줄 수. 늘어나면 새 말이 온 것이다. */
  count: number;
  /** 열 때 돌아갈 읽던 위치. null이면 맨 아래다. */
  initialScroll: number | null;
  onScroll: (position: number | null) => void;
  children: ReactNode;
}

export function ThreadScroll({
  count,
  initialScroll,
  onScroll,
  children,
}: ThreadScrollProps): ReactNode {
  const listRef = useRef<HTMLDivElement>(null);
  const following = useRef(initialScroll === null);
  const seen = useRef(count);
  const lastTop = useRef(0);
  // 마지막으로 알린 읽던 위치. 같으면 다시 알리지 않는다(알릴 때마다 대화 화면 전체가 다시 그려진다).
  const saved = useRef(initialScroll);
  const [unseen, setUnseen] = useState(0);

  // 코드가 옮긴 위치를 바로 기록한다. 기록하지 않으면 같은 frame의 사람 scroll이 옛 위치와 비교돼, 글이 자라
  // 올라간 만큼 위로 올린 wheel이 "아래로 내려옴"으로 읽혀 다시 따라간다.
  const moveTo = (list: HTMLDivElement, top: number) => {
    list.scrollTop = top;
    lastTop.current = list.scrollTop;
  };

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    moveTo(list, initialScroll ?? list.scrollHeight);
    // 처음 위치만 돌려놓는다. 그 뒤는 사람의 scroll이 정한다.
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    const added = count - seen.current;
    const first = seen.current === 0;
    seen.current = count;
    if (!list || added <= 0) return;
    // 탭을 다시 열면 대화가 빈 채로 그려지고 줄이 뒤에 온다. 처음 온 줄은 새 말이 아니라 처음 모습이라 읽던 위치를
    // 이때 돌려놓는다.
    if (first) {
      moveTo(list, initialScroll ?? list.scrollHeight);
      return;
    }
    if (following.current) moveTo(list, list.scrollHeight);
    else setUnseen((current) => current + added);
  }, [count]);

  // 본문은 말보다 늦게 온다. 맨 아래를 따라가는 중이면 본문이 와서 길어져도 맨 아래에 둔다.
  // 위로 올려 읽는 중이면 건드리지 않는다.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && following.current) moveTo(list, list.scrollHeight);
  });

  const input = (event: Parameters<typeof followAfterInput>[1]) => {
    const list = listRef.current;
    if (list)
      following.current = followAfterInput(
        following.current,
        event,
        list.scrollTop,
      );
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
    lastTop.current = scrollTop;
    if (following.current) setUnseen(0);
  };

  // 읽던 위치는 scroll이 멈춘 뒤 한 번만 알린다.
  const handleScrollEnd = () => {
    const list = listRef.current;
    if (!list) return;
    const position = following.current ? null : list.scrollTop;
    if (position === saved.current) return;
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
    moveTo(list, list.scrollHeight);
    following.current = true;
    setUnseen(0);
    saved.current = null;
    onScroll(null);
  };

  return (
    <div className={styles.frame}>
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
        {children}
      </div>
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
