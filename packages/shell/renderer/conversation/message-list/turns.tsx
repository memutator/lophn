// 대화 줄의 배치(shell/desktop#R40·R48): 내 메시지는 오른쪽 bubble, agent 메시지는 왼쪽에 avatar·이름·시각을
// 한 번 두고 이어지는 메시지는 그 아래에 묶는다. 기존 message-list.tsx는 그대로 두고 이 파일이 새 배치를 맡는다.
// renderer는 contracts를 type check하지 않으므로 id는 문자열이다.
import type { ReactElement, ReactNode } from "react";
import {
  Avatar,
  type AvatarProfile,
  IconButton,
} from "@lophn/design/components";
import { conversationIcons, editorIcons } from "../../icons/mod.ts";
import { t } from "@lophn/wording";

import styles from "./turns.module.css";

export type TurnActor = "user" | "agent";

export interface TurnMessage {
  readonly kind: "message";
  /** `msg_…` */
  readonly id: string;
  readonly actor: TurnActor;
  /**
   * 보이는 본문. Markdown과 시각 블록을 그리는 일은 부르는 쪽 몫이다(lophn-agent/visuals).
   * 이 component는 bubble(또는 agent 열)에 넣기만 한다.
   */
  readonly body: ReactNode;
  /** 화면에 보일 시각 글(예: "9:05 AM"). 묶음의 첫 agent 메시지의 것만 보인다. */
  readonly time: string;
}

/**
 * agent 쪽 block. tool 줄·편집 카드·질문 카드처럼 메시지가 아닌 것을 부르는 쪽이 그려서 준다.
 * agent 묶음 안에 이름 없이 이어지고 묶음을 나누지 않으며 왼쪽 열의 폭을 다 쓴다(R40).
 */
export interface TurnBlock {
  readonly kind: "block";
  readonly id: string;
  readonly node: ReactNode;
  /** block이 묶음의 첫 항목일 때 묶음 위에 보일 시각 글. 앞에 agent 메시지가 있으면 쓰지 않는다. */
  readonly time?: string;
}

export type TurnItem = TurnMessage | TurnBlock;

export interface TurnAgent {
  /** 메시지 위에 굵게 보이는 이름. 고정 글자가 아니라 그 session의 agent 이름이다. */
  readonly name: string;
  readonly profile: AvatarProfile;
}

export interface MessageTurnsProps {
  agent: TurnAgent;
  /** 시간순. 내 메시지는 `actor: "user"`, agent 쪽은 agent 메시지와 block이다. */
  items: readonly TurnItem[];
  /** closed session이면 true. 내 메시지의 Rewind·Fork 단추가 없다(conversation#R25). */
  sessionClosed: boolean;
  /** "Rewind to here". 되돌리기 menu를 여는 일은 부르는 쪽 몫이다. */
  onRewind: (message: string) => void;
  /** "Fork from here". 그 메시지까지의 확정 메시지를 복사하는 일은 부르는 쪽 몫이다. */
  onFork: (message: string) => void;
}

/**
 * 약속하는 DOM(test가 단언):
 * - 내 메시지 `[data-message=<id>][data-actor=user][data-side=end]`: 본문을 담은 bubble이 있고 `[data-avatar]`와
 *   이름이 없다. 단추 aria-label "Rewind to here"·"Fork from here"(hover 노출은 CSS 몫)가 이 순서로 있다.
 * - agent 묶음 `[data-agent-turn][data-side=start]`: 사이에 내 메시지가 없는 agent 메시지와 block이 한 묶음이다.
 *   묶음 위에 `[data-avatar][data-size=md]` 하나, `[data-agent-name]`(이름) 하나, `[data-turn-time]`
 *   하나가 있다. 시각은 묶음의 첫 항목의 `time`(block이 첫 항목인데 `time`이 없으면 빈 글)이다.
 *   agent 메시지는 `[data-message=<id>][data-actor=agent]`, block은 `[data-turn-block=<id>]`이고
 *   둘 다 묶음 안에 항목 순서대로 있다. block 요소 안은 `node`뿐이다.
 * - 내 메시지가 사이에 끼면 묶음이 나뉘어 그 뒤 묶음 위에 이름·avatar가 다시 한 번 보인다.
 * - `[data-message]` 요소의 내용은 `body`뿐이다(이름·시각은 묶음 위에 있다).
 * - 이름은 `agent.name`뿐이다.
 */
export function MessageTurns(
  { agent, items, sessionClosed, onRewind, onFork }: MessageTurnsProps,
): ReactElement {
  return (
    <div className={styles.turns}>
      {group(items).map((entry) =>
        entry.kind === "user"
          ? (
            <UserMessage
              key={entry.message.id}
              message={entry.message}
              sessionClosed={sessionClosed}
              onRewind={onRewind}
              onFork={onFork}
            />
          )
          : (
            <AgentTurn
              key={entry.items[0].id}
              agent={agent}
              items={entry.items}
            />
          )
      )}
    </div>
  );
}

type AgentItem = TurnMessage | TurnBlock;

type Entry =
  | { readonly kind: "user"; readonly message: TurnMessage }
  | { readonly kind: "agent"; readonly items: AgentItem[] };

/** 내 메시지는 따로 서고, 사이에 내 메시지가 없는 agent 메시지와 block은 한 묶음이다. */
function group(items: readonly TurnItem[]): Entry[] {
  const entries: Entry[] = [];
  let current: AgentItem[] | undefined;
  for (const item of items) {
    if (item.kind === "message" && item.actor === "user") {
      current = undefined;
      entries.push({ kind: "user", message: item });
      continue;
    }
    if (current === undefined) {
      current = [];
      entries.push({ kind: "agent", items: current });
    }
    current.push(item);
  }
  return entries;
}

function UserMessage(
  { message, sessionClosed, onRewind, onFork }: {
    message: TurnMessage;
    sessionClosed: boolean;
    onRewind: (message: string) => void;
    onFork: (message: string) => void;
  },
): ReactElement {
  return (
    <div
      className={styles.userTurn}
      data-message={message.id}
      data-actor="user"
      data-side="end"
    >
      <div className={styles.userRow}>
        {sessionClosed ? null : (
          <span className={styles.actions}>
            <IconButton
              icon={editorIcons.restore}
              label={t("conversation.button.rewind-here")}
              size="sm"
              onClick={() => onRewind(message.id)}
            />
            <IconButton
              icon={conversationIcons.newSession}
              label={t("conversation.button.fork-here")}
              size="sm"
              onClick={() => onFork(message.id)}
            />
          </span>
        )}
        <div className={styles.bubble}>{message.body}</div>
      </div>
    </div>
  );
}

function AgentTurn(
  { agent, items }: { agent: TurnAgent; items: readonly AgentItem[] },
): ReactElement {
  const first = items[0];
  return (
    <div className={styles.agentTurn} data-agent-turn="" data-side="start">
      <div className={styles.agentHead}>
        <Avatar profile={agent.profile} size="md" />
        <span className={styles.agentName} data-agent-name="">
          {agent.name}
        </span>
        <span className={styles.agentTime} data-turn-time="">
          {first.time ?? ""}
        </span>
      </div>
      <div className={styles.agentBody}>
        {items.map((item) =>
          item.kind === "message"
            ? (
              <div
                key={item.id}
                className={styles.said}
                data-message={item.id}
                data-actor="agent"
              >
                {item.body}
              </div>
            )
            : (
              <div
                key={item.id}
                className={styles.block}
                data-turn-block={item.id}
              >
                {item.node}
              </div>
            )
        )}
      </div>
    </div>
  );
}
