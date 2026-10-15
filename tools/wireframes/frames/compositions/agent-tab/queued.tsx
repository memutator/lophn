// agent가 일하는 중에 보낸 메시지가 composer 바로 위에 쌓이는 줄. 기본은 다음 turn에 들어가고, 줄 오른쪽 끝의
// [Send now]를 누르면 도는 turn에 steer로 들어가 대화에 steer 표시가 붙는다. 보낸 뒤 마음이 바뀌면 줄을 뺀다.
import { Button, Icon, IconButton, iconPixels } from "@lophn/design/components";
import {
  conversationIcons,
  workspaceIcons,
} from "../../../../../packages/shell/renderer/icons/mod.ts";

import t from "./agent-tab.module.css";

export function QueuedMessages(
  { items, onSendNow, onRemove }: {
    items: readonly string[];
    onSendNow: (text: string) => void;
    onRemove: (text: string) => void;
  },
) {
  if (items.length === 0) return null;
  return (
    <ul className={t.queued} aria-label="Waiting for the next turn">
      {items.map((text) => (
        <li key={text} className={t.queuedRow}>
          <Icon
            icon={conversationIcons.request}
            pixels={iconPixels("small")}
            className={t.queuedIcon}
          />
          <span className={t.queuedTag}>Next turn</span>
          <span className={t.queuedText}>{text}</span>
          <Button size="sm" onClick={() => onSendNow(text)}>Send now</Button>
          <IconButton
            icon={workspaceIcons.close}
            label="Remove from the queue"
            size="sm"
            onClick={() => onRemove(text)}
          />
        </li>
      ))}
    </ul>
  );
}
