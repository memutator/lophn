// 받은 메시지 한 개. 왼쪽에 놓이고(내 메시지는 오른쪽 bubble) 위에 보낸 쪽 chip이 붙는다. chip을 누르면 그 아래로
// panel이 열린다. `replyTo`는 어느 부탁에 대한 답인지 한 줄로 잇는 글이다.
import { type ReactElement, type ReactNode, useState } from "react";
import { t } from "@lophn/i18n";

import type {
  AgentTabSource,
  EvidenceRef,
  Sender,
} from "../agent-tab-source.ts";
import { SenderChip, SenderPanel } from "./sender-chip.tsx";
import styles from "./thread.module.css";

interface ReceivedMessageProps {
  /** 받은 메시지 id. */
  message: string;
  sender: Sender;
  /** 화면에 보일 시각 글. */
  time: string;
  /** 이 메시지가 답하는 부탁의 맡긴 글. 호출한 쪽이 `replyTo`의 call에서 찾아 준다. */
  replyTo?: string | undefined;
  source: Pick<AgentTabSource, "envelope">;
  onOpenRef?: ((ref: EvidenceRef) => void) | undefined;
  onOpenSession?: ((session: string) => void) | undefined;
  defaultOpen?: boolean;
  children: ReactNode;
}

export function ReceivedMessage({
  message,
  sender,
  time,
  replyTo,
  source,
  onOpenRef,
  onOpenSession,
  defaultOpen = false,
  children,
}: ReceivedMessageProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={styles.received}
      data-message={message}
      data-actor="received"
    >
      <div className={styles.receivedHead}>
        <SenderChip
          sender={sender}
          open={open}
          onToggle={
            source.envelope === undefined ? undefined : () => setOpen(!open)
          }
        />
        <span className={styles.time}>{time}</span>
      </div>
      {open ? (
        <SenderPanel
          message={message}
          sender={sender}
          source={source}
          onOpenRef={onOpenRef}
          onOpenSession={onOpenSession}
        />
      ) : null}
      {replyTo === undefined ? null : (
        <p className={styles.replyTo} data-reply-to="">
          {t("conversation.label.reply-to", { task: replyTo })}
        </p>
      )}
      <div className={styles.receivedBody}>{children}</div>
    </div>
  );
}
