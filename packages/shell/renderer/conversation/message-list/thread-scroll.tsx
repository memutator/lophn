// 대화 줄을 담는 scroll 틀. 새 말이 와도 사람이 올려 읽던 위치와 입력 focus를 건드리지 않는다.
// 맨 아래를 보고 있을 때만 새 말을 따라 내려간다.
import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { IconButton } from "@lophn/ui/primitives";
import { Tooltip } from "@lophn/ui/overlay";
import { conversationIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import styles from "./thread-scroll.module.css";

/** 맨 아래로 보는 여유. 이만큼 안이면 새 말을 따라 내려간다. */
const BOTTOM_SLACK = 24;

function atBottom(
  scrollTop: number,
  scrollHeight: number,
  clientHeight: number,
): boolean {
  return scrollHeight - scrollTop - clientHeight <= BOTTOM_SLACK;
}

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
  const [unseen, setUnseen] = useState(0);

  useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = initialScroll ?? list.scrollHeight;
    // 처음 위치만 돌려놓는다. 그 뒤는 사람의 scroll이 정한다.
  }, []);

  useLayoutEffect(() => {
    const list = listRef.current;
    const added = count - seen.current;
    seen.current = count;
    if (!list || added <= 0) return;
    if (following.current) list.scrollTop = list.scrollHeight;
    else setUnseen((current) => current + added);
  }, [count]);

  // 본문은 말보다 늦게 온다. 맨 아래를 따라가는 중이면 본문이 와서 길어져도 맨 아래에 둔다.
  // 위로 올려 읽는 중이면 건드리지 않는다.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (list && following.current) list.scrollTop = list.scrollHeight;
  });

  const handleScroll = () => {
    const list = listRef.current;
    if (!list) return;
    const { scrollTop, scrollHeight, clientHeight } = list;
    // 위로 올리면 맨 아래 여유 안이어도 따라가기를 멈춘다. 따라가는 채로 두면 이 scroll의 저장이 부른 render가
    // 맨 아래로 되돌려 작은 wheel이 먹힌다. 본문이 줄어 맨 아래에 붙은 채 내려간 것은 올린 것이 아니다.
    const up =
      scrollTop < lastTop.current &&
      scrollHeight - scrollTop - clientHeight > 1;
    lastTop.current = scrollTop;
    const bottom = !up && atBottom(scrollTop, scrollHeight, clientHeight);
    following.current = bottom;
    if (bottom) setUnseen(0);
    onScroll(bottom ? null : scrollTop);
  };

  const jump = () => {
    const list = listRef.current;
    if (!list) return;
    list.scrollTop = list.scrollHeight;
    following.current = true;
    setUnseen(0);
    onScroll(null);
  };

  return (
    <div className={styles.frame}>
      <div
        className={styles.list}
        ref={listRef}
        onScroll={handleScroll}
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
