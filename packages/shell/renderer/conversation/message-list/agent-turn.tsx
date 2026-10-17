// 대화 줄의 부품. agent의 말 한 덩어리(AgentTurn과 Said), 한 줄 안내(Quiet), 내 메시지(UserMessage).
// 조립은 부르는 쪽이 한다. 이 부품들은 children을 놓기만 하고 source 값을 읽지 않는다.
import type { ReactElement, ReactNode } from "react";
import { Avatar, type AvatarProfile } from "../../parts/avatar/avatar.tsx";
import { Icon, IconButton } from "@lophn/ui/primitives";
import { iconPixels } from "@lophn/ui/shared";
import { conversationIcons, editorIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import styles from "./turns.module.css";

/**
 * agent의 말 한 덩어리. 왼쪽 열에 avatar·이름·시각이 위에 한 번 있고, 이어지는 말과 tool 줄·카드는 같은 덩어리
 * 안에서 그 아래에 이름 없이 이어진다. 카드는 이 열의 폭을 다 쓴다.
 */
export function AgentTurn(
  { agent, time, children }: {
    agent: { readonly name: string; readonly profile: AvatarProfile };
    time: string;
    children: ReactNode;
  },
): ReactElement {
  return (
    <div className={styles.agentTurn} data-agent-turn="" data-side="start">
      <div className={styles.agentHead}>
        <Avatar profile={agent.profile} size="md" />
        <span className={styles.agentName} data-agent-name="">
          {agent.name}
        </span>
        <span className={styles.agentTime} data-turn-time="">{time}</span>
      </div>
      <div className={styles.agentBody}>{children}</div>
    </div>
  );
}

/** agent의 글. */
export function Said(
  { children, id }: { children: ReactNode; id?: string },
): ReactElement {
  return (
    <div
      className={styles.said}
      data-message={id}
      data-actor={id === undefined ? undefined : "agent"}
    >
      {children}
    </div>
  );
}

/** 내 메시지가 아닌 한 줄 안내(결정을 남기는 말 같은). */
export function Quiet({ children }: { children: ReactNode }): ReactElement {
  return <p className={styles.quiet}>{children}</p>;
}

/**
 * 내 메시지. 오른쪽 bubble이고 이름·avatar는 없다. hover하면 [Rewind to here] 단추가 보이고, 누르면 부르는 쪽이
 * rewind panel을 연다. 도는 turn에 steer로 들어간 메시지는 rewind 시점이 아니라서 단추 대신 steer 표시가 붙는다.
 */
export function UserMessage(
  { children, id, steer = false, rewindOpen = false, onRewind, onFork }: {
    children: ReactNode;
    id?: string;
    steer?: boolean;
    /** rewind panel이 이 메시지를 가리켜 열려 있다. 단추가 계속 보인다. */
    rewindOpen?: boolean;
    onRewind?: () => void;
    /** 이 메시지까지의 확정 메시지를 복사한다. */
    onFork?: () => void;
  },
): ReactElement {
  const rewindable = onRewind !== undefined && !steer;
  return (
    <div
      className={styles.userTurn}
      data-message={id}
      data-actor={id === undefined ? undefined : "user"}
      data-side="end"
      data-open={rewindOpen ? "" : undefined}
    >
      <div className={styles.userRow}>
        {rewindable || onFork !== undefined
          ? (
            <span className={styles.actions}>
              {rewindable
                ? (
                  <IconButton
                    icon={editorIcons.restore}
                    label={t("conversation.button.rewind-here")}
                    size="sm"
                    aria-expanded={rewindOpen}
                    onClick={onRewind}
                  />
                )
                : null}
              {onFork === undefined ? null : (
                <IconButton
                  icon={conversationIcons.newSession}
                  label={t("conversation.button.fork-here")}
                  size="sm"
                  onClick={onFork}
                />
              )}
            </span>
          )
          : null}
        <div className={styles.bubble}>{children}</div>
      </div>
      {steer
        ? (
          <span className={styles.steerMark} data-steer="">
            <Icon
              icon={conversationIcons.steer}
              pixels={iconPixels("small")}
            />
            {t("conversation.label.steer")}
          </span>
        )
        : null}
    </div>
  );
}
