// agent가 일하는 중 보낸 메시지가 composer 바로 위에 쌓이는 줄. 기본은 다음 turn에 들어가고, 줄 오른쪽 끝의
// [Send now]를 누르면 도는 turn에 steer로 들어가 대화에 steer 표시가 붙는다. 보낸 뒤 마음이 바뀌면 줄을 뺀다.
import type { ReactElement } from "react";
import { Button, Icon, IconButton } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { t } from "@lophn/wording";

import { conversationIcons, workspaceIcons } from "../../icons/mod.ts";
import type { QueuedView } from "../agent-tab-source.ts";
import styles from "./queued-messages.module.css";

interface QueuedMessagesProps {
  items: readonly QueuedView[];
  /** 그 줄을 도는 turn에 steer로 올린다. */
  onSendNow: (id: string) => void;
  onRemove: (id: string) => void;
  /** 두 단추를 막는다. 올리기·빼기를 받는 통로가 없는 동안 host가 켠다. */
  disabled?: boolean;
}

export function QueuedMessages({
  items,
  onSendNow,
  onRemove,
  disabled,
}: QueuedMessagesProps): ReactElement | null {
  if (items.length === 0) return null;
  return (
    <ul
      className={styles.queued}
      aria-label={t("conversation.label.queued-messages")}
      data-queued=""
    >
      {items.map((item) => (
        <li key={item.id} className={styles.row} data-queued-row="">
          <Icon
            icon={conversationIcons.request}
            pixels={iconPixels("small")}
            className={styles.icon}
          />
          <span className={styles.tag}>
            {t("conversation.label.next-turn")}
          </span>
          <span className={styles.text}>{item.text}</span>
          <Button
            size="sm"
            disabled={disabled}
            data-send-now=""
            onClick={() => onSendNow(item.id)}
          >
            {t("conversation.button.send-now")}
          </Button>
          <IconButton
            icon={workspaceIcons.close}
            label={t("conversation.button.queued-remove")}
            size="sm"
            disabled={disabled}
            onClick={() => onRemove(item.id)}
          />
        </li>
      ))}
    </ul>
  );
}
