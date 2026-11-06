// 눈금에 hover하면 뜨는 card: 사람 메시지 첫 줄과 bookmark 단추, 그 아래 답 미리보기 2줄.
import { t } from "@lophn/i18n";
import { IconButton } from "@lophn/ui/primitives";
import type { ReactElement } from "react";

import { conversationIcons } from "../../icons/mod.ts";
import { ChatMarkdown } from "../message-list/chat-markdown.tsx";
import type { IndexItem } from "./model.ts";
import styles from "./thread-index.module.css";

export function IndexCard({
  item,
  bookmarked,
  onBookmark,
  onPointerEnter,
  onPointerLeave,
}: {
  item: IndexItem;
  bookmarked: boolean;
  /** 없으면 bookmark 단추가 없다. */
  onBookmark: (() => void) | null;
  onPointerEnter: () => void;
  onPointerLeave: () => void;
}): ReactElement {
  const label = t(
    bookmarked
      ? "conversation.button.bookmark-remove"
      : "conversation.button.bookmark-turn",
  );
  return (
    <div
      className={styles.card}
      data-thread-index-card=""
      onPointerEnter={onPointerEnter}
      onPointerLeave={onPointerLeave}
    >
      <div className={styles.cardHead}>
        <span className={styles.cardTitle}>{item.title}</span>
        {onBookmark === null ? null : (
          <IconButton
            icon={
              bookmarked
                ? conversationIcons.bookmarked
                : conversationIcons.bookmark
            }
            label={label}
            size="sm"
            aria-pressed={bookmarked}
            data-thread-bookmark=""
            onClick={onBookmark}
          />
        )}
      </div>
      {item.reply === null ? null : (
        <div className={styles.cardReply}>
          <ChatMarkdown text={item.reply} />
        </div>
      )}
    </div>
  );
}
